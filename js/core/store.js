// Repositório de registros.
// Cada entidade (conta, cartão, lançamento...) é um registro independente, versionado por HLC.
// Conflitos entre dispositivos: vence a versão mais nova (last-writer-wins por registro).
// Exclusões viram tombstones (registro marcado del=1 sem conteúdo) até que todas as réplicas
// as tenham visto; depois são coletadas.
import { seal, unseal } from '../lib/crypto.js';
import { tick, observe, hlcMs } from '../lib/hlc.js';
import { uid } from '../lib/util.js';
import { nowMs } from '../lib/clock.js';

let db = null;
let key = null;
let me = 'local';
const recs = new Map();
let version = 0;
const subs = new Set();
let queued = false;
let kick = () => {};
let snap = null;
let snapV = -1;

const aad = (r) => `${r.id}|${r.u}|${r.del ? 1 : 0}`;

function notify() {
  version++;
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    subs.forEach((f) => f());
  });
}

export const subscribe = (f) => (subs.add(f), () => subs.delete(f));
export const setKick = (f) => (kick = f);
export const setMe = (u) => (me = u);
export const getMe = () => me;
export const getVersion = () => version;
export const getDB = () => db;

export async function initStore(_db, _key) {
  db = _db;
  key = _key;
  recs.clear();
  const rows = await db.all('records');
  const bad = [];
  await Promise.all(
    rows.map(async (row) => {
      try {
        const p = await unseal(key, row.iv, row.ct, aad(row));
        recs.set(row.id, { id: row.id, u: row.u, by: row.by, del: !!row.del, ...p });
        observe(row.u);
      } catch {
        bad.push(row.id);
      }
    }),
  );
  if (bad.length) {
    // Registros adulterados ou corrompidos são descartados; a nuvem (se houver) os repõe.
    await db.removeRecords(bad);
    await db.put('meta', 0, 'cursor');
  }
  notify();
  return { count: rows.length, rejected: bad.length };
}

async function persist(rec, outbox = true) {
  const payload = rec.del ? { type: rec.type } : { type: rec.type, data: rec.data, cb: rec.cb, ca: rec.ca };
  const { iv, ct } = await seal(key, payload, aad(rec), rec.type === 'archive');
  const row = { id: rec.id, u: rec.u, by: rec.by, del: rec.del ? 1 : 0, iv, ct };
  await db.write([row], outbox ? [rec.id] : []);
  return row;
}

export async function save(type, data, id) {
  const prev = id ? recs.get(id) : null;
  id = id || uid();
  const clean = { ...data };
  for (const k of Object.keys(clean)) if (k === 'id' || k.startsWith('_')) delete clean[k];
  const rec = {
    id,
    type,
    data: clean,
    u: tick(),
    by: me,
    cb: prev && !prev.del ? prev.cb : me,
    ca: prev && !prev.del ? prev.ca : nowMs(),
    del: false,
  };
  await persist(rec);
  recs.set(id, rec);
  notify();
  kick();
  return id;
}

export async function remove(id) {
  const prev = recs.get(id);
  if (!prev || prev.del) return;
  const rec = { id, type: prev.type, u: tick(), by: me, del: true };
  await persist(rec);
  recs.set(id, rec);
  notify();
  kick();
}

// Aplica versões vindas de outra réplica (nuvem ou backup). Ignora as mais antigas.
export async function applyRemoteMany(rows) {
  const accepted = [];
  const views = [];
  await Promise.all(
    rows.map(async (row) => {
      const cur = recs.get(row.id);
      if (cur && cur.u >= row.u) return;
      try {
        const p = await unseal(key, row.iv, row.ct, aad(row));
        observe(row.u);
        accepted.push({ id: row.id, u: row.u, by: row.by, del: row.del ? 1 : 0, iv: row.iv, ct: row.ct });
        views.push({ id: row.id, u: row.u, by: row.by, del: !!row.del, ...p });
      } catch {
        /* cifrado com outra chave ou adulterado: ignora */
      }
    }),
  );
  if (!accepted.length) return 0;
  await db.write(accepted, [], accepted.map((r) => r.id));
  for (const v of views) recs.set(v.id, v);
  notify();
  return accepted.length;
}

// Importa registros já decifrados (backup JSON): regrava cifrado se for mais novo.
export async function importPlain(list) {
  let n = 0;
  for (const r of list) {
    const cur = recs.get(r.id);
    if (cur && cur.u >= r.u) continue;
    observe(r.u);
    const rec = r.del
      ? { id: r.id, type: r.type, u: r.u, by: r.by || me, del: true }
      : { id: r.id, type: r.type, data: r.data, u: r.u, by: r.by || me, cb: r.cb || me, ca: r.ca || nowMs(), del: false };
    await persist(rec);
    recs.set(r.id, rec);
    n++;
  }
  if (n) {
    notify();
    kick();
  }
  return n;
}

// Ao conectar a nuvem pela primeira vez: registros criados como "local" passam a ter o autor real.
export async function claimLocal(newMe) {
  me = newMe;
  for (const rec of [...recs.values()]) {
    const next = { ...rec, u: tick(), by: newMe };
    if (!rec.del && rec.cb === 'local') next.cb = newMe;
    if (rec.type === 'member' && rec.id === 'm_local') continue;
    await persist(next);
    recs.set(rec.id, next);
  }
  notify();
  kick();
}

// Coleta de lixo local: tombstones mais antigos que o horizonte e já enviados.
export async function gcLocal(horizonMs) {
  const pending = new Set(await db.keys('outbox'));
  const drop = [];
  for (const r of recs.values()) if (r.del && hlcMs(r.u) < horizonMs && !pending.has(r.id)) drop.push(r.id);
  if (!drop.length) return 0;
  await db.removeRecords(drop);
  drop.forEach((id) => recs.delete(id));
  return drop.length;
}

// Remove localmente registros que a nuvem não tem mais (reconciliação completa).
export async function dropMissing(serverIds) {
  const pending = new Set(await db.keys('outbox'));
  const drop = [...recs.keys()].filter((id) => !serverIds.has(id) && !pending.has(id));
  if (!drop.length) return 0;
  await db.removeRecords(drop);
  drop.forEach((id) => recs.delete(id));
  notify();
  return drop.length;
}

export const get = (id) => {
  const r = recs.get(id);
  return r && !r.del ? view(r) : null;
};
export const allRecords = () => [...recs.values()];
export const stats = () => {
  let live = 0,
    tomb = 0;
  for (const r of recs.values()) r.del ? tomb++ : live++;
  return { live, tomb };
};

const view = (r) => ({ id: r.id, ...r.data, _by: r.by, _cb: r.cb, _ca: r.ca, _u: r.u });

const TYPES = ['inst', 'acct', 'card', 'cat', 'tx', 'bill', 'plan', 'member', 'archive', 'occ', 'cinv'];

// Fotografia imutável do estado, reconstruída só quando algo muda.
export function snapshot() {
  if (snapV === version && snap) return snap;
  const S = Object.fromEntries(TYPES.map((t) => [t, []]));
  const byId = new Map();
  for (const r of recs.values()) {
    if (r.del || !S[r.type]) continue;
    const v = view(r);
    S[r.type].push(v);
    byId.set(v.id, v);
  }
  for (const a of S.archive) {
    for (const t of a.txs || []) {
      const v = { ...t, _ar: a.month };
      S.tx.push(v);
      byId.set(v.id, v);
    }
  }
  S.tx.sort((a, b) => (a.date === b.date ? (a._ca || 0) - (b._ca || 0) : a.date < b.date ? -1 : 1));
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR');
  S.inst.sort(byName);
  S.acct.sort(byName);
  S.card.sort(byName);
  S.cat.sort(byName);
  S.bill.sort((a, b) => (a.day || 0) - (b.day || 0));
  S.plan.sort(byName);
  // Datas ajustadas de faturas específicas ficam acessíveis no próprio cartão (_inv[ref]).
  const inv = {};
  for (const r of S.cinv) (inv[r.cardId] ||= {})[r.ref] = r;
  for (const c of S.card) c._inv = inv[c.id] || null;
  S.byId = byId;
  snap = Object.freeze(S);
  snapV = version;
  return snap;
}
