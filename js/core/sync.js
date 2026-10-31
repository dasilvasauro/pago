// Sincronização em tempo real com o Firestore.
//
// Modelo:
//   households/{hid}                  dono, código de convite, chave do espaço embrulhada pela senha
//   households/{hid}/members/{uid}    quem participa + último momento em que sincronizou
//   households/{hid}/records/{id}     { u, by, del, iv, ct, ts }  (conteúdo sempre cifrado)
//   users/{uid}                       { hid }  (qual espaço abrir ao entrar)
//
// Envio: fila local (outbox) -> writeBatch. As regras do Firestore só aceitam uma versão
// se ela for mais nova que a gravada (u > atual), então uma escrita atrasada nunca sobrescreve
// uma mais recente; nesse caso a versão do servidor é baixada e aplicada.
// Recebimento: listener por "ts > cursor" (só o que mudou desde a última vez).
// Tombstones: apagados do servidor apenas quando todos os membros ativos já sincronizaram
// depois da exclusão (estabilidade causal) e passaram 30 dias. Uma réplica que ficou fora
// além desse horizonte faz uma reconciliação completa ao voltar.
import * as store from './store.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';
const DAY = 86400000;
const HORIZON = 30 * DAY;

let fb = null;
let idb = null;
let hid = null;
let me = null;
let unsub = null;
let pushing = false;
let again = false;
let timer = null;
let status = 'local';
let lastPresence = 0;
const listeners = new Set();

let cloudConfig = null;
let configError = '';

// A configuração é carregada à parte: um erro em firebase-config.js não pode derrubar o app inteiro.
export async function loadConfig() {
  try {
    const m = await import('../firebase-config.js');
    cloudConfig = m.cloudConfig || m.firebaseConfig || m.default || null;
    if (!cloudConfig) configError = 'O arquivo js/firebase-config.js precisa exportar "cloudConfig".';
  } catch (e) {
    configError = /module specifier|firebase\//i.test(String(e?.message))
      ? 'O arquivo js/firebase-config.js tem linhas de import (como "firebase/app"). Ele deve conter só o objeto de configuração; veja o README.'
      : `O arquivo js/firebase-config.js tem um erro: ${e?.message || e}`;
  }
}
export const getConfigError = () => configError;
export const cloudConfigured = () => !!(cloudConfig && cloudConfig.apiKey && !/^COLE/.test(cloudConfig.apiKey));
export const onStatus = (f) => (listeners.add(f), f(status), () => listeners.delete(f));
export const getStatus = () => status;
function setStatus(s) {
  status = s;
  listeners.forEach((f) => f(s));
}

export async function loadFirebase() {
  if (fb) return fb;
  const [appM, A, F] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = appM.initializeApp(cloudConfig);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  fb = { app, auth, db, A, F };
  return fb;
}

const B = (u8) => fb.F.Bytes.fromUint8Array(u8);
const U = (b) => b.toUint8Array();
const wrapOut = (w) => ({ v: w.v, iter: w.iter, salt: B(w.salt), iv: B(w.iv), ct: B(w.ct) });
const wrapIn = (w) => ({ v: w.v, iter: w.iter, salt: U(w.salt), iv: U(w.iv), ct: U(w.ct) });
const code = () => [...crypto.getRandomValues(new Uint8Array(9))].map((x) => 'abcdefghjkmnpqrstuvwxyz23456789'[x % 31]).join('');

/* ---------- Autenticação ---------- */
export async function currentUser() {
  const { auth, A } = await loadFirebase();
  try {
    await A.getRedirectResult(auth);
  } catch {
    /* sem redirect pendente */
  }
  await auth.authStateReady();
  return auth.currentUser;
}

export async function signIn() {
  const { auth, A } = await loadFirebase();
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return (await A.signInWithPopup(auth, provider)).user;
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await A.signInWithRedirect(auth, provider);
      return null;
    }
    throw e;
  }
}

export async function signOut() {
  stopSync();
  if (!fb) return;
  await fb.A.signOut(fb.auth);
}

/* ---------- Espaço (household) ---------- */
export async function userHome(uid) {
  const { db, F } = await loadFirebase();
  const s = await F.getDoc(F.doc(db, 'users', uid));
  return s.exists() ? s.data().hid : null;
}

export async function getHousehold(id) {
  const { db, F } = await loadFirebase();
  const s = await F.getDoc(F.doc(db, 'households', id));
  if (!s.exists()) return null;
  const d = s.data();
  return { owner: d.owner, joinCode: d.joinCode, wrap: wrapIn(d.wrap) };
}

export async function createHousehold(id, wrap, uid) {
  const { db, F } = await loadFirebase();
  const joinCode = code();
  await F.setDoc(F.doc(db, 'households', id), { owner: uid, joinCode, wrap: wrapOut(wrap), createdAt: F.serverTimestamp() });
  await F.setDoc(F.doc(db, 'households', id, 'members', uid), { code: joinCode, joinedAt: F.serverTimestamp(), lastSync: F.serverTimestamp() });
  await F.setDoc(F.doc(db, 'users', uid), { hid: id });
}

// Convite no formato "<hid>.<codigo>". A senha do espaço é combinada à parte.
export async function joinHousehold(invite, uid) {
  const { db, F } = await loadFirebase();
  const [id, joinCode] = invite.trim().split('.');
  if (!id || !joinCode) throw Object.assign(new Error('Convite inválido.'), { code: 'bad-invite' });
  try {
    await F.setDoc(F.doc(db, 'households', id, 'members', uid), { code: joinCode, joinedAt: F.serverTimestamp(), lastSync: F.serverTimestamp() });
  } catch {
    throw Object.assign(new Error('Convite inválido ou expirado.'), { code: 'bad-invite' });
  }
  await F.setDoc(F.doc(db, 'users', uid), { hid: id });
  const h = await getHousehold(id);
  return { hid: id, ...h };
}

export async function rotateInvite(id) {
  const { db, F } = await loadFirebase();
  const joinCode = code();
  await F.updateDoc(F.doc(db, 'households', id), { joinCode });
  return joinCode;
}

export async function updateWrap(id, wrap) {
  const { db, F } = await loadFirebase();
  await F.updateDoc(F.doc(db, 'households', id), { wrap: wrapOut(wrap) });
}

export async function listMembers(id = hid) {
  const { db, F } = await loadFirebase();
  const s = await F.getDocs(F.collection(db, 'households', id, 'members'));
  return s.docs.map((d) => ({ uid: d.id, joinedAt: d.data().joinedAt?.toMillis?.() || 0, lastSync: d.data().lastSync?.toMillis?.() || 0 }));
}

export async function removeMember(uid, id = hid) {
  const { db, F } = await loadFirebase();
  await F.deleteDoc(F.doc(db, 'households', id, 'members', uid));
}

export async function leaveHousehold(uid, id = hid) {
  const { db, F } = await loadFirebase();
  await F.deleteDoc(F.doc(db, 'users', uid));
  await F.deleteDoc(F.doc(db, 'households', id, 'members', uid));
}

/* ---------- Motor de sincronização ---------- */
const recDoc = (id) => fb.F.doc(fb.db, 'households', hid, 'records', id);
const recCol = () => fb.F.collection(fb.db, 'households', hid, 'records');

export async function startSync(opts) {
  ({ hid, uid: me, idb } = opts);
  await loadFirebase();
  const { F } = fb;
  store.setKick(() => schedule(700));
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('offline', () => setStatus('offline'));

  const lastPull = (await idb.get('meta', 'lastPull')) || 0;
  if (lastPull && Date.now() - lastPull > HORIZON - 5 * DAY) await reconcile();

  let cursor = (await idb.get('meta', 'cursor')) || 0;
  const q = F.query(recCol(), F.where('ts', '>', F.Timestamp.fromMillis(Math.max(0, cursor - 120000))));
  setStatus(navigator.onLine ? 'syncing' : 'offline');
  unsub = F.onSnapshot(
    q,
    async (snap) => {
      const rows = [];
      let max = cursor;
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') continue;
        const d = ch.doc;
        if (d.metadata.hasPendingWrites) continue;
        const x = d.data();
        if (!x.ts) continue;
        max = Math.max(max, x.ts.toMillis());
        rows.push({ id: d.id, u: x.u, by: x.by, del: !!x.del, iv: U(x.iv), ct: U(x.ct) });
      }
      if (rows.length) await store.applyRemoteMany(rows);
      if (max > cursor) {
        cursor = max;
        await idb.put('meta', cursor, 'cursor');
      }
      await idb.put('meta', Date.now(), 'lastPull');
      presence();
      if (!pushing) setStatus('synced');
    },
    (err) => setStatus(err.code === 'permission-denied' ? 'denied' : 'error'),
  );
  schedule(0);
  setTimeout(collectGarbage, 15000);
}

export function stopSync() {
  unsub?.();
  unsub = null;
  clearTimeout(timer);
  store.setKick(() => {});
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(push, ms);
}

export const syncNow = () => schedule(0);

async function ack(row) {
  const cur = await idb.get('records', row.id);
  if (cur && cur.u === row.u) await idb.del('outbox', row.id);
}

const toDoc = (r) => ({ u: r.u, by: me, del: !!r.del, iv: B(r.iv), ct: B(r.ct), ts: fb.F.serverTimestamp() });

async function push() {
  if (!fb || !hid) return;
  if (pushing) {
    again = true;
    return;
  }
  if (!navigator.onLine) {
    setStatus('offline');
    return;
  }
  pushing = true;
  const { F } = fb;
  try {
    const ids = await idb.keys('outbox');
    if (ids.length) setStatus('syncing');
    for (let i = 0; i < ids.length; i += 400) {
      const rows = (await Promise.all(ids.slice(i, i + 400).map((id) => idb.get('records', id)))).filter(Boolean);
      const batch = F.writeBatch(fb.db);
      for (const r of rows) batch.set(recDoc(r.id), toDoc(r));
      try {
        await batch.commit();
        for (const r of rows) await ack(r);
      } catch (e) {
        if (e.code !== 'permission-denied') throw e;
        // Algum registro tem versão mais nova no servidor: resolve um a um.
        for (const r of rows) {
          try {
            await F.setDoc(recDoc(r.id), toDoc(r));
            await ack(r);
          } catch (e2) {
            if (e2.code !== 'permission-denied') throw e2;
            const s = await F.getDoc(recDoc(r.id)); // falha aqui = não é mais membro
            if (s.exists()) {
              const x = s.data();
              await store.applyRemoteMany([{ id: s.id, u: x.u, by: x.by, del: !!x.del, iv: U(x.iv), ct: U(x.ct) }]);
            }
            await idb.del('outbox', r.id);
          }
        }
      }
    }
    setStatus('synced');
  } catch (e) {
    setStatus(!navigator.onLine ? 'offline' : e.code === 'permission-denied' ? 'denied' : 'error');
  } finally {
    pushing = false;
    if (again) {
      again = false;
      schedule(400);
    }
  }
}

async function presence() {
  if (Date.now() - lastPresence < 10 * 60000) return;
  lastPresence = Date.now();
  try {
    const { db, F } = fb;
    await F.setDoc(F.doc(db, 'households', hid, 'members', me), { lastSync: F.serverTimestamp() }, { merge: true });
  } catch {
    /* tenta de novo depois */
  }
}

async function reconcile() {
  const { F } = fb;
  const s = await F.getDocs(recCol());
  const ids = new Set(s.docs.map((d) => d.id));
  await store.dropMissing(ids);
  await idb.put('meta', 0, 'cursor');
}

// Coleta de lixo dos tombstones (no máximo uma vez por dia por dispositivo).
async function collectGarbage() {
  try {
    const last = (await idb.get('meta', 'gcAt')) || 0;
    if (Date.now() - last < DAY) return;
    await idb.put('meta', Date.now(), 'gcAt');
    const members = (await listMembers()).filter((m) => Date.now() - m.lastSync < 90 * DAY);
    const stable = members.length ? Math.min(...members.map((m) => m.lastSync)) : 0;
    const horizon = Math.min(stable, Date.now() - HORIZON);
    if (horizon <= 0) return;
    await store.gcLocal(horizon);
    const { F } = fb;
    const q = F.query(recCol(), F.where('del', '==', true), F.where('ts', '<', F.Timestamp.fromMillis(horizon)), F.limit(400));
    const snap = await F.getDocs(q);
    if (snap.empty) return;
    const batch = F.writeBatch(fb.db);
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch {
    /* índice ausente ou offline: tenta amanhã */
  }
}
