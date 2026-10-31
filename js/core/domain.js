// Regras de negócio puras. Nada aqui toca em DOM ou armazenamento.
//
// Princípio: dívida não é cadastrada à parte, ela é DERIVADA.
//   - Conta com saldo negativo  -> cheque especial em uso
//   - Cartão de crédito         -> tudo o que foi comprado e ainda não pago (inclui parcelas futuras)
//   - Parcelamentos e acordos   -> parcelas restantes (renegociações, empréstimos, contas parceladas)
// Assim, todo lançamento do diário altera a dívida automaticamente: um salário que cai numa
// conta negativa abate o cheque especial sem nenhum passo extra.
import { addMonths, ymOf, clampDay, addDays, monthsBetween, splitParts, daysBetween, sum } from '../lib/util.js';

export const ACCOUNT_KINDS = {
  corrente: 'Conta corrente',
  poupanca: 'Poupança',
  carteira: 'Dinheiro',
  voucher: 'Voucher',
  investimento: 'Investimento',
};
export const VOUCHER_KINDS = { alimentacao: 'Alimentação', refeicao: 'Refeição', multi: 'Multibenefício', outro: 'Outro' };
export const INVEST_KINDS = {
  fgts: 'FGTS',
  poupanca: 'Poupança',
  cdb: 'CDB / RDB',
  tesouro: 'Tesouro Direto',
  fundos: 'Fundos',
  acoes: 'Ações',
  previdencia: 'Previdência',
  outro: 'Outro',
};
export const PLAN_KINDS = {
  acordo: 'Acordo / renegociação',
  emprestimo: 'Empréstimo',
  financiamento: 'Financiamento',
  conta: 'Conta parcelada',
  outro: 'Outro',
};
export const isLiquid = (k) => k === 'corrente' || k === 'poupanca' || k === 'carteira';

/* ---------- Efeitos de um lançamento sobre carteiras ----------
   Chave "a:ID" = saldo de conta (positivo = dinheiro disponível)
   Chave "c:ID" = dívida no cartão de crédito (positivo = devendo) */
const wk = (ref) => (ref.k === 'c' ? 'c:' : 'a:') + ref.id;

export function effects(t) {
  const e = [];
  const A = t.amount || 0;
  const out = (ref) => ref && e.push([wk(ref), ref.k === 'c' ? A : -A]);
  const inn = (ref) => ref && e.push([wk(ref), ref.k === 'c' ? -A : A]);
  if (t.type === 'saida') out(t.from);
  else if (t.type === 'entrada') inn(t.to);
  else if (t.type === 'transf') {
    out(t.from);
    inn(t.to);
  } else if (t.type === 'ajuste' && t.to) e.push([wk(t.to), A]);
  return e;
}

function openings(S) {
  const m = new Map();
  for (const a of S.acct) m.set('a:' + a.id, { date: a.openingDate, amount: a.opening || 0 });
  for (const c of S.card)
    if (c.kind === 'credito') m.set('c:' + c.id, { date: c.openingDate, amount: (c.openInv || 0) + (c.openRest || 0) });
  return m;
}

// Saldo inicial = saldo no começo do dia informado. Lançamentos a partir desse dia o alteram.
export function balances(S, upto = '9999-12-31') {
  const op = openings(S);
  const bal = new Map();
  for (const [k, o] of op) if (o.date <= upto) bal.set(k, o.amount);
  for (const t of S.tx) {
    if (t.date > upto) continue;
    for (const [k, d] of effects(t)) {
      const o = op.get(k);
      if (!o || t.date < o.date) continue;
      bal.set(k, (bal.get(k) || 0) + d);
    }
  }
  return bal;
}

/* ---------- Parcelamentos e acordos ---------- */
// startMonth = mês da próxima parcela a pagar no momento do cadastro (parcela paidBefore+1).
export const planMonthOf = (p, k) => addMonths(p.startMonth, k - (p.paidBefore || 0) - 1);
export function planParcelIn(p, ym) {
  const k = (p.paidBefore || 0) + 1 + monthsBetween(p.startMonth, ym);
  return k > (p.paidBefore || 0) && k <= p.n ? k : 0;
}
export function paidKeys(S, upto = '9999-12-31') {
  const m = new Map();
  for (const t of S.tx) if (t.ob && t.date <= upto) for (const k of t.ob) if (!m.has(k)) m.set(k, t);
  return m;
}
export function planStatus(p, paid) {
  let count = p.paidBefore || 0;
  for (let k = (p.paidBefore || 0) + 1; k <= p.n; k++) if (paid.has(`p:${p.id}:${planMonthOf(p, k)}`)) count++;
  const remainingN = Math.max(0, p.n - count);
  return { paid: count, remainingN, remaining: remainingN * p.amount, total: p.n * p.amount };
}

/* ---------- Cartões de crédito ----------
   ref = mês de fechamento da fatura. Compras a partir do dia de fechamento vão para a próxima. */
export function cardRef(card, date) {
  const ym = ymOf(date);
  return date < clampDay(ym, card.closingDay) ? ym : addMonths(ym, 1);
}
export const cardClose = (card, ref) => clampDay(ref, card.closingDay);
export const cardDue = (card, ref) =>
  card.dueDay > card.closingDay ? clampDay(ref, card.dueDay) : clampDay(addMonths(ref, 1), card.dueDay);
// Próxima fatura a pagar numa data (pode ser uma já fechada e ainda não vencida).
export function payRefAt(card, date) {
  const r = cardRef(card, date);
  const prev = addMonths(r, -1);
  return cardDue(card, prev) >= date ? prev : r;
}

export function cardInvoices(S, card, today) {
  const charges = new Map();
  const add = (ref, amount, item) => {
    const c = charges.get(ref) || { amount: 0, items: [] };
    c.amount += amount;
    c.items.push(item);
    charges.set(ref, c);
  };
  const od = card.openingDate;
  if (card.openInv) add(payRefAt(card, od), card.openInv, { label: 'Saldo inicial', amount: card.openInv, date: od });
  if (card.openRest) {
    const n = Math.max(1, card.openRestN || 1);
    const r0 = addMonths(payRefAt(card, od), 1);
    splitParts(card.openRest, n).forEach((a, i) =>
      add(addMonths(r0, i), a, { label: `Saldo parcelado ${i + 1}/${n}`, amount: a, date: od }),
    );
  }
  let credits = 0;
  const key = 'c:' + card.id;
  for (const t of S.tx) {
    if (t.date < od) continue;
    for (const [k, d] of effects(t)) {
      if (k !== key) continue;
      if (d > 0) {
        const n = t.type === 'saida' ? Math.max(1, t.installments || 1) : 1;
        const r0 = cardRef(card, t.date);
        splitParts(d, n).forEach((a, i) => add(addMonths(r0, i), a, { tx: t, i: i + 1, n, amount: a, date: t.date }));
      } else if (t.date <= today) credits += -d;
    }
  }
  let pool = credits;
  const list = [...charges.keys()].sort().map((ref) => {
    const c = charges.get(ref);
    const paid = Math.min(c.amount, pool);
    pool -= paid;
    const close = cardClose(card, ref);
    const due = cardDue(card, ref);
    const remaining = c.amount - paid;
    const status = remaining <= 0 ? 'paga' : today < close ? 'aberta' : today > due ? 'vencida' : 'fechada';
    return { ref, close, due, amount: c.amount, paid, remaining, items: c.items, status };
  });
  list.credit = pool; // pagamentos acima do devido
  return list;
}

export function cardInfo(S, card, today, bal = balances(S, today)) {
  const outstanding = bal.get('c:' + card.id) || 0;
  const invs = cardInvoices(S, card, today);
  const current = invs.find((i) => i.remaining > 0 && i.status !== 'aberta') || invs.find((i) => i.status === 'aberta') || null;
  const open = invs.find((i) => i.status === 'aberta') || null;
  return { outstanding, available: (card.limit || 0) - outstanding, current, open, invoices: invs };
}

/* ---------- Posição (fotografia num dia) ---------- */
export function position(S, date) {
  const bal = balances(S, date);
  const paid = paidKeys(S, date);
  const p = { overdraft: 0, cards: 0, plans: 0, liquid: 0, bank: 0, cash: 0, invested: 0, vouchers: 0, credit: 0 };
  for (const a of S.acct) {
    if (a.openingDate > date) continue;
    const b = bal.get('a:' + a.id) || 0;
    if (a.kind === 'investimento') p.invested += b;
    else if (a.kind === 'voucher') p.vouchers += Math.max(0, b);
    else if (b < 0) p.overdraft -= b;
    else {
      p.liquid += b; // saldo total: valores positivos em contas e dinheiro
      if (a.kind === 'carteira') p.cash += b;
      else p.bank += b;
    }
  }
  for (const c of S.card) {
    if (c.kind !== 'credito' || c.openingDate > date) continue;
    const o = bal.get('c:' + c.id) || 0;
    if (o > 0) p.cards += o;
    else p.credit -= o;
  }
  for (const pl of S.plan) {
    if ((pl.openingDate || '') > date) continue;
    p.plans += planStatus(pl, paid).remaining;
  }
  p.debt = p.overdraft + p.cards + p.plans;
  p.assets = p.liquid + p.invested + p.vouchers + p.credit;
  p.net = p.assets - p.debt;
  return p;
}

export function firstDate(S) {
  const ds = [...S.acct.map((a) => a.openingDate), ...S.card.filter((c) => c.kind === 'credito').map((c) => c.openingDate), ...S.plan.map((p) => p.openingDate)].filter(Boolean);
  if (S.tx.length) ds.push(S.tx[0].date);
  return ds.sort()[0] || null;
}

// Série diária (amostrada para no máximo ~140 pontos) de dívida e patrimônio líquido.
export function series(S, from, to) {
  const days = daysBetween(from, to);
  if (days < 0) return [];
  const step = Math.max(1, Math.ceil(days / 140));
  const out = [];
  for (let i = 0; i <= days; i += step) {
    const d = addDays(from, i);
    const p = position(S, d);
    out.push({ d, debt: p.debt, net: p.net, liquid: p.liquid });
  }
  if (out[out.length - 1]?.d !== to) {
    const p = position(S, to);
    out.push({ d: to, debt: p.debt, net: p.net, liquid: p.liquid });
  }
  return out;
}

/* ---------- Compromissos do mês (contas fixas, parcelas, faturas) ---------- */
const billActive = (b, m) => b.active !== false && b.startMonth <= m && (!b.endMonth || m <= b.endMonth);

export function obligations(S, fromYM, toYM, today) {
  const paid = paidKeys(S);
  const out = [];
  for (let m = fromYM; m <= toYM; m = addMonths(m, 1)) {
    const merged = new Set();
    for (const b of S.bill) {
      if (!billActive(b, m)) continue;
      const key = `b:${b.id}:${m}`;
      const parts = [{ key, label: b.variable ? 'Valor estimado' : 'Mensal', amount: b.amount || 0 }];
      for (const p of S.plan) {
        if (p.billId !== b.id) continue;
        const k = planParcelIn(p, m);
        if (!k) continue;
        parts.push({ key: `p:${p.id}:${m}`, label: `${p.name} ${k}/${p.n}`, amount: p.amount });
        merged.add(p.id);
      }
      out.push({
        id: key,
        kind: 'bill',
        dir: b.dir || 'out',
        title: b.name,
        date: clampDay(m, b.day),
        month: m,
        parts,
        amount: sum(parts, (x) => x.amount),
        paid: parts.every((x) => paid.has(x.key)),
        tx: paid.get(key) || paid.get(parts[1]?.key),
        src: b,
        categoryId: b.categoryId,
        ref: b.source || null,
      });
    }
    for (const p of S.plan) {
      if (merged.has(p.id)) continue;
      const k = planParcelIn(p, m);
      if (!k) continue;
      const key = `p:${p.id}:${m}`;
      out.push({
        id: key,
        kind: 'plan',
        dir: 'out',
        title: p.name,
        date: clampDay(m, p.day),
        month: m,
        parts: [{ key, label: `Parcela ${k}/${p.n}`, amount: p.amount }],
        amount: p.amount,
        paid: paid.has(key),
        tx: paid.get(key),
        src: p,
        categoryId: p.categoryId,
        ref: p.source || null,
      });
    }
  }
  for (const c of S.card) {
    if (c.kind !== 'credito' || c.archived) continue;
    for (const inv of cardInvoices(S, c, today)) {
      const m = ymOf(inv.due);
      if (m < fromYM || m > toYM || inv.amount <= 0) continue;
      out.push({
        id: `i:${c.id}:${inv.ref}`,
        kind: 'invoice',
        dir: 'out',
        title: `Fatura ${c.name}`,
        date: inv.due,
        month: m,
        parts: [],
        amount: inv.amount,
        remaining: inv.remaining,
        paid: inv.remaining <= 0,
        partial: inv.paid > 0 && inv.remaining > 0,
        src: c,
        inv,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

export const dueAmount = (o) => (o.kind === 'invoice' ? o.remaining : o.amount);

/* ---------- Estatísticas ---------- */
export function rangeStats(S, from, to) {
  let income = 0,
    expense = 0,
    count = 0;
  const byCat = new Map();
  for (const t of S.tx) {
    if (t.date < from || t.date > to) continue;
    count++;
    if (t.type === 'entrada') {
      if (t.to?.k === 'c') expense -= t.amount; // estorno
      else income += t.amount;
    } else if (t.type === 'saida') {
      expense += t.amount;
      const k = t.categoryId || '';
      byCat.set(k, (byCat.get(k) || 0) + t.amount);
    }
  }
  return { income, expense, result: income - expense, byCat, count };
}
export const monthStats = (S, ym) => rangeStats(S, `${ym}-01`, `${ym}-31`);

// Saldo líquido projetado para o fim do mês, considerando o que ainda falta entrar e sair.
export function projection(S, today) {
  const ym = ymOf(today);
  const pos = position(S, today);
  const obs = obligations(S, addMonths(ym, -2), ym, today).filter((o) => !o.paid);
  let pin = 0,
    pout = 0;
  for (const o of obs) {
    if (o.dir === 'in') {
      if (o.month === ym) pin += o.amount;
    } else if (o.kind === 'invoice') pout += o.remaining;
    else if (o.ref?.k !== 'c') pout += o.amount; // contas pagas no cartão já entram pela fatura
  }
  const now = pos.liquid - pos.overdraft;
  return { now, pin, pout, end: now + pin - pout };
}

export function periodSummary(S, from, to, today) {
  const before = position(S, addDays(from, -1));
  const after = position(S, to);
  const st = rangeStats(S, from, to);
  const obs = obligations(S, ymOf(from), ymOf(to), today).filter((o) => o.date >= from && o.date <= to);
  const withTx = new Set(S.tx.filter((t) => t.date >= from && t.date <= to).map((t) => t.date));
  const days = daysBetween(from, to) + 1;
  return { from, to, days, before, after, ...st, obs, daysWithout: days - withTx.size };
}

/* ---------- Rótulos ---------- */
export function walletName(S, ref) {
  if (!ref) return '';
  const w = S.byId.get(ref.id);
  if (!w) return 'Removido';
  const inst = w.institutionId ? S.byId.get(w.institutionId) : null;
  return inst && !w.name.toLowerCase().includes(inst.name.toLowerCase()) ? `${w.name} ${inst.name}` : w.name;
}
