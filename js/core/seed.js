import * as store from './store.js';
import { obligations } from './domain.js';
import { today } from '../lib/clock.js';
import { addDays, addMonths, ymOf } from '../lib/util.js';

const C = ['#7C8CFF', '#5FE3B5', '#F2C14E', '#F2716B', '#59C3F0', '#C08CF5', '#F59AC0', '#9BD16A', '#F0995A', '#8FA3B8'];

export const DEFAULT_CATS = [
  ['Moradia', 'saida', C[0]],
  ['Contas da casa', 'saida', C[4]],
  ['Mercado', 'saida', C[7]],
  ['Alimentação fora', 'saida', C[8]],
  ['Transporte', 'saida', C[2]],
  ['Saúde', 'saida', C[1]],
  ['Educação', 'saida', C[5]],
  ['Família', 'saida', C[6]],
  ['Lazer', 'saida', C[5]],
  ['Assinaturas', 'saida', C[9]],
  ['Dívidas e acordos', 'saida', C[3]],
  ['Juros e tarifas', 'saida', C[3]],
  ['Outros', 'saida', C[9]],
  ['Salário', 'entrada', C[1]],
  ['Benefícios', 'entrada', C[7]],
  ['Renda extra', 'entrada', C[2]],
  ['Rendimentos', 'entrada', C[4]],
  ['Outros', 'entrada', C[9]],
];

export async function seedCategories() {
  const ids = {};
  for (const [name, kind, color] of DEFAULT_CATS) ids[`${kind}:${name}`] = await store.save('cat', { name, kind, color });
  return ids;
}

const r = (a, b) => Math.round(a + Math.random() * (b - a));

// Dados fictícios só para o modo de teste.
export async function seedDemo() {
  const td = today();
  const start = addDays(td, -45);
  const ym = ymOf(td);
  const cat = await seedCategories();
  const azul = await store.save('inst', { name: 'Banco Azul', color: C[0] });
  const verde = await store.save('inst', { name: 'Banco Verde', color: C[1] });
  const cc = await store.save('acct', { kind: 'corrente', name: 'Conta corrente', institutionId: azul, opening: -185000, openingDate: start, overdraftLimit: 250000 });
  const cv = await store.save('acct', { kind: 'corrente', name: 'Conta digital', institutionId: verde, opening: 32000, openingDate: start, overdraftLimit: 0 });
  const va = await store.save('acct', { kind: 'voucher', name: 'Vale-alimentação', voucherKind: 'alimentacao', opening: 41000, openingDate: start });
  await store.save('acct', { kind: 'investimento', name: 'FGTS', investKind: 'fgts', opening: 530000, openingDate: start });
  const pig = await store.save('acct', { kind: 'cofrinho', name: 'Reserva de emergência', institutionId: verde, goal: 500000, targetDate: `${addMonths(ym, 10)}-01`, opening: 45000, openingDate: start, archived: false });
  await store.save('tx', { type: 'transf', amount: 20000, date: addDays(td, -12), from: { k: 'a', id: cv }, to: { k: 'a', id: pig }, desc: 'Guardar em Reserva de emergência' });
  const deb = await store.save('card', { kind: 'debito', name: 'Débito Azul', institutionId: azul, accountId: cc });
  const cr = await store.save('card', { kind: 'credito', name: 'Cartão Azul', institutionId: azul, limit: 300000, closingDay: 3, dueDay: 10, openInv: 64000, openRest: 120000, openRestN: 4, openingDate: start });
  await store.save('card', { kind: 'credito', name: 'Cartão Verde', institutionId: verde, limit: 150000, closingDay: 20, dueDay: 28, openInv: 23000, openRest: 0, openRestN: 1, openingDate: start });

  const m0 = ymOf(start);
  await store.save('bill', { dir: 'in', name: 'Salário', amount: 430000, day: 5, startMonth: m0, categoryId: cat['entrada:Salário'], source: { k: 'a', id: cc }, method: 'ted', active: true });
  await store.save('bill', { dir: 'in', name: 'Recarga vale-alimentação', amount: 60000, day: 1, startMonth: m0, categoryId: cat['entrada:Benefícios'], source: { k: 'a', id: va }, active: true });
  await store.save('bill', { dir: 'out', name: 'Aluguel', amount: 140000, day: 5, startMonth: m0, categoryId: cat['saida:Moradia'], source: { k: 'a', id: cc }, method: 'pix', active: true });
  await store.save('bill', { dir: 'out', name: 'Condomínio', amount: 45000, day: 5, startMonth: m0, categoryId: cat['saida:Moradia'], source: { k: 'a', id: cc }, method: 'boleto', active: true });
  await store.save('bill', { dir: 'out', name: 'Internet', amount: 9990, day: 15, startMonth: m0, categoryId: cat['saida:Contas da casa'], source: { k: 'a', id: cv }, method: 'auto', active: true });
  await store.save('bill', { dir: 'out', name: 'Luz', amount: 18000, day: 20, variable: true, startMonth: m0, categoryId: cat['saida:Contas da casa'], source: { k: 'a', id: cc }, method: 'boleto', active: true });
  const gas = await store.save('bill', { dir: 'out', name: 'Gás', amount: 7500, day: 12, variable: true, startMonth: m0, categoryId: cat['saida:Contas da casa'], source: { k: 'a', id: cc }, method: 'boleto', active: true });
  await store.save('plan', { name: 'Débito de gás parcelado', kind: 'conta', amount: 5800, n: 5, paidBefore: 0, day: 12, startMonth: addMonths(ym, 0), billId: gas, categoryId: cat['saida:Contas da casa'], source: { k: 'a', id: cc }, openingDate: start });
  await store.save('plan', { name: 'Acordo Banco Azul', kind: 'acordo', institutionId: azul, amount: 43750, n: 24, paidBefore: 3, day: 18, startMonth: m0, categoryId: cat['saida:Dívidas e acordos'], source: { k: 'a', id: cc }, method: 'boleto', openingDate: start });

  // Histórico fictício para o gráfico ter forma.
  for (let d = start; d < td; d = addDays(d, 1)) await simulateDay(d, { cat, cc, cv, va, deb, cr }, 0.9);
}

let ctxCache = null;
async function ctx() {
  if (ctxCache) return ctxCache;
  const S = store.snapshot();
  const find = (f) => S.acct.find(f)?.id;
  const cat = {};
  for (const c of S.cat) cat[`${c.kind}:${c.name}`] = c.id;
  ctxCache = {
    cat,
    cc: find((a) => a.kind === 'corrente'),
    cv: S.acct.filter((a) => a.kind === 'corrente')[1]?.id,
    va: find((a) => a.kind === 'voucher'),
    deb: S.card.find((c) => c.kind === 'debito')?.id,
    cr: S.card.find((c) => c.kind === 'credito')?.id,
  };
  return ctxCache;
}

// Simula um dia de uso: pequenos gastos e quitação da maior parte dos compromissos do dia.
export async function simulateDay(d, k, payChance = 0.85) {
  k = k || (await ctx());
  const spends = [
    ['Mercado', () => r(3000, 18000), k.va ? { k: 'a', id: k.va } : null],
    ['Alimentação fora', () => r(1500, 6000), k.cr ? { k: 'c', id: k.cr } : null],
    ['Transporte', () => r(500, 2500), k.cc ? { k: 'a', id: k.cc } : null],
    ['Lazer', () => r(2000, 9000), k.cr ? { k: 'c', id: k.cr } : null],
    ['Outros', () => r(800, 4000), k.cv ? { k: 'a', id: k.cv } : null],
  ];
  const people = ['Padaria do bairro', 'Feira', 'Ana', 'Marcos', 'Lanchonete', 'Mercadinho'];
  const n = r(0, 3);
  for (let i = 0; i < n; i++) {
    const [name, amt, from] = spends[r(0, spends.length - 1)];
    if (!from) continue;
    const tx = { type: 'saida', amount: amt(), date: d, categoryId: k.cat[`saida:${name}`] || '', from, desc: '' };
    if (from.k === 'c') tx.method = 'credito';
    else if (from.id === k.va) tx.method = 'voucher';
    else if (Math.random() < 0.7) {
      tx.method = 'pix';
      tx.contact = people[r(0, people.length - 1)];
    } else tx.method = 'debito';
    await store.save('tx', tx);
  }
  if (k.cv && Math.random() < 0.08)
    await store.save('tx', { type: 'entrada', amount: r(5000, 30000), date: d, categoryId: k.cat['entrada:Renda extra'] || '', to: { k: 'a', id: k.cv }, method: 'pix', contact: 'Cliente', desc: '' });
  const S = store.snapshot();
  for (const o of obligations(S, ymOf(d), ymOf(d), d)) {
    if (o.paid || o.date !== d || Math.random() > payChance) continue;
    if (o.kind === 'invoice') {
      if (k.cc) await store.save('tx', { type: 'transf', amount: o.remaining, date: d, desc: `Pagamento ${o.title.toLowerCase()}`, from: { k: 'a', id: k.cc }, to: { k: 'c', id: o.src.id }, method: 'boleto' });
      continue;
    }
    const ref = o.ref || (k.cc ? { k: 'a', id: k.cc } : null);
    if (!ref) continue;
    const amount = o.src.variable ? Math.round(o.amount * (0.85 + Math.random() * 0.3)) : o.amount;
    const data = { type: o.dir === 'in' ? 'entrada' : 'saida', amount, date: d, desc: o.title, categoryId: o.categoryId || '', ob: o.parts.map((p) => p.key) };
    if (o.src.method) data.method = o.src.method;
    if (o.dir === 'in') data.to = ref;
    else data.from = ref;
    await store.save('tx', data);
  }
}

export const resetSimCache = () => (ctxCache = null);
