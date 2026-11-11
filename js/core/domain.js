// Regras de negócio puras. Nada aqui toca em DOM ou armazenamento.
//
// Princípio: dívida não é cadastrada à parte, ela é DERIVADA.
//   - Conta com saldo negativo  -> cheque especial em uso
//   - Cartão de crédito         -> tudo o que foi comprado e ainda não pago (inclui parcelas futuras)
//   - Parcelamentos e acordos   -> parcelas restantes e entrada não paga
//   - Outras dívidas            -> contas do tipo "dívida": saldo devedor sem parcelas definidas
//                                  (ex.: cheque especial que o banco transferiu para uma conta à parte)
//   - Contas em atraso          -> contas recorrentes vencidas e não pagas (luz, água, internet...)
// Assim, todo lançamento do diário altera a dívida automaticamente: um salário que cai numa
// conta negativa abate o cheque especial sem nenhum passo extra.
import { addMonths, ymOf, clampDay, addDays, monthsBetween, splitParts, daysBetween, sum, isoOf, MONTHS } from '../lib/util.js';

export const ACCOUNT_KINDS = {
  corrente: 'Conta corrente',
  poupanca: 'Poupança',
  carteira: 'Dinheiro',
  voucher: 'Voucher',
  investimento: 'Investimento',
  cofrinho: 'Cofrinho',
  divida: 'Dívida',
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
    if (c.kind === 'credito') m.set('c:' + c.id, { date: c.openingDate, amount: (c.openInv || 0) + (c.openRest || 0) + Math.max(0, (c.prevAmount || 0) - (c.prevPaid || 0)) * (c.prevRef ? 1 : 0) });
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
export const downKey = (p) => `p:${p.id}:entrada`;

// Ajustes de um mês específico de uma conta recorrente: valor, data ou "sem cobrança".
export const occId = (billId, ym) => `oc_${billId}_${ym}`;
export function occMap(S) {
  const m = new Map();
  for (const o of S.occ || []) m.set(`${o.billId}:${o.month}`, o);
  return m;
}

/* ---------- Cofrinhos ----------
   Conta do tipo "cofrinho" com meta. Depósitos são transferências (ou entradas) para ela;
   rendimentos entram em Atualizar saldo e não contam como depósito. */
export function piggyInfo(S, a, today, bal = balances(S, today)) {
  const balance = Math.max(0, bal.get('a:' + a.id) || 0);
  const goal = a.goal || 0;
  let last = null;
  for (const t of S.tx) if ((t.type === 'transf' || t.type === 'entrada') && t.to?.k === 'a' && t.to.id === a.id && t.date <= today && (!last || t.date > last)) last = t.date;
  const since = last || a.openingDate || today;
  const remaining = Math.max(0, goal - balance);
  let perMonth = 0;
  let monthsLeft = null;
  if (a.targetDate && remaining > 0) {
    monthsLeft = monthsBetween(ymOf(today), ymOf(a.targetDate));
    if (monthsLeft >= 0) perMonth = Math.ceil(remaining / Math.max(1, monthsLeft + (a.targetDate.slice(8) >= today.slice(8) ? 1 : 0)));
  }
  return {
    balance,
    goal,
    pct: goal ? Math.min(100, (balance / goal) * 100) : 0,
    remaining,
    done: goal > 0 && balance >= goal,
    lastDeposit: last,
    daysWithout: Math.max(0, daysBetween(since, today)),
    perMonth,
    monthsLeft,
  };
}
export function planStatus(p, paid) {
  let count = p.paidBefore || 0;
  for (let k = (p.paidBefore || 0) + 1; k <= p.n; k++) if (paid.has(`p:${p.id}:${planMonthOf(p, k)}`)) count++;
  const remainingN = Math.max(0, p.n - count);
  const downOpen = p.down > 0 && !paid.has(downKey(p));
  return {
    paid: count,
    remainingN,
    downOpen,
    remaining: remainingN * p.amount + (downOpen ? p.down : 0),
    total: p.n * p.amount + (p.down || 0),
  };
}

// Compromissos renegociados (cobertos por um acordo) deixam de contar como atrasados.
export function coveredKeys(S, upto = '9999-12-31') {
  const s = new Set();
  for (const p of S.plan) if ((p.openingDate || '') <= upto) for (const k of p.covers || []) s.add(k);
  return s;
}

// Contas recorrentes vencidas e não pagas até a data, a partir do mês de início de cada conta.
// Meses pagos fora do app podem ser marcados como "já pago" (ajuste do mês com settled).
export function lateBills(S, date, paid = paidKeys(S, date), covered = coveredKeys(S, date)) {
  const out = [];
  const occ = occMap(S);
  const ym = ymOf(date);
  for (const b of S.bill) {
    if (b.dir === 'in' || !b.startMonth) continue;
    for (let m = b.startMonth; m <= ym; m = addMonths(m, 1)) {
      if (!billActive(b, m)) continue;
      const ov = occ.get(`${b.id}:${m}`);
      if (ov?.skip || ov?.settled) continue;
      const due = ov?.date || clampDay(m, b.day);
      if (due >= date) continue;
      const key = `b:${b.id}:${m}`;
      if (paid.has(key) || covered.has(key)) continue;
      out.push({ key, bill: b, month: m, date: due, amount: ov?.amount ?? (b.amount || 0) });
    }
  }
  return out;
}

/* ---------- Cartões de crédito ----------
   ref = mês de fechamento da fatura. Compras a partir do dia de fechamento vão para a próxima. */
// Datas padrão vêm dos dias do cartão; uma fatura específica pode ter fechamento e vencimento
// ajustados (registro "cinv"), por exemplo quando o banco muda a data por feriado.
const invOv = (card, ref) => card._inv?.[ref] || null;
export const defaultClose = (card, ref) => clampDay(ref, card.closingDay);
export const defaultDue = (card, ref) =>
  card.dueDay > card.closingDay ? clampDay(ref, card.dueDay) : clampDay(addMonths(ref, 1), card.dueDay);
export const cardClose = (card, ref) => invOv(card, ref)?.close || defaultClose(card, ref);
export const cardDue = (card, ref) => invOv(card, ref)?.due || defaultDue(card, ref);
// Fatura em que uma compra entra: a primeira que fecha depois da data da compra.
export function cardRef(card, date) {
  let r = addMonths(ymOf(date), -1);
  for (let i = 0; i < 24 && date >= cardClose(card, r); i++) r = addMonths(r, 1);
  return r;
}
// Faturas são chamadas pelo mês de vencimento, como nos bancos ("fatura de dezembro" vence em dezembro).
export const invMonth = (card, ref) => ymOf(cardDue(card, ref));
// Fatura cujo vencimento cai no mês informado.
export function refByDueMonth(card, ym) {
  for (const r of [addMonths(ym, -1), ym, addMonths(ym, -2)]) if (ymOf(cardDue(card, r)) === ym) return r;
  return card.dueDay > card.closingDay ? ym : addMonths(ym, -1);
}
// Próxima fatura a pagar numa data (pode ser uma já fechada e ainda não vencida).
export function payRefAt(card, date) {
  const r = cardRef(card, date);
  const prev = addMonths(r, -1);
  return cardDue(card, prev) >= date ? prev : r;
}

// Fatura registrada no cadastro (histórico): a última fatura fechada, com quanto foi pago.
// Entra só no cartão, sem mexer em nenhuma conta, porque o pagamento já está no saldo delas.
export const histRef = (card) => (card.prevAmount > 0 && card.prevRef ? card.prevRef : null);
function currentRef(card) {
  const pay = payRefAt(card, card.openingDate);
  const h = histRef(card);
  return h && pay <= h ? addMonths(h, 1) : pay;
}

// Regras das faturas:
// - cada pagamento vale para as faturas que vencem a partir da data dele (as mais antigas primeiro);
// - fatura vencida e paga EM PARTE: o restante vai para a fatura seguinte ("Saldo da fatura de ...");
// - fatura vencida sem nenhum pagamento continua em aberto, como atrasada;
// - pagamento feito depois do vencimento quita primeiro as faturas atrasadas.
export function cardInvoices(S, card, today) {
  const charges = new Map();
  const add = (ref, amount, item) => {
    const c = charges.get(ref) || { amount: 0, items: [] };
    c.amount += amount;
    c.items.push(item);
    charges.set(ref, c);
  };
  const od = card.openingDate;
  const credits = [];
  const h = histRef(card);
  if (h) {
    add(h, card.prevAmount, { label: 'Fatura registrada no cadastro', amount: card.prevAmount, date: cardClose(card, h), hist: true });
    if (card.prevPaid > 0) credits.push({ date: cardDue(card, h), amount: Math.min(card.prevPaid, card.prevAmount), hist: true });
  }
  const cur = currentRef(card);
  if (card.openInv) add(cur, card.openInv, { label: 'Saldo inicial', amount: card.openInv, date: od });
  if (card.openRest) {
    const n = Math.max(1, card.openRestN || 1);
    splitParts(card.openRest, n).forEach((a, i) =>
      add(addMonths(cur, i + 1), a, { label: `Saldo parcelado ${i + 1}/${n}`, amount: a, date: od }),
    );
  }
  const key = 'c:' + card.id;
  for (const t of S.tx) {
    if (t.date < od) continue;
    for (const [k, d] of effects(t)) {
      if (k !== key) continue;
      if (d > 0) {
        const n = t.type === 'saida' ? Math.max(1, t.installments || 1) : 1;
        const r0 = cardRef(card, t.date);
        splitParts(d, n).forEach((a, i) => add(addMonths(r0, i), a, { tx: t, i: i + 1, n, amount: a, date: t.date }));
      } else if (t.date <= today) credits.push({ date: t.date, amount: -d });
    }
  }
  credits.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let ci = 0;
  let cleft = credits[0]?.amount || 0;
  // Consome pagamentos com data até "limit" e devolve quanto foi usado (até "need").
  const take = (need, limit) => {
    let got = 0;
    while (ci < credits.length && got < need && credits[ci].date <= limit) {
      const x = Math.min(cleft, need - got);
      got += x;
      cleft -= x;
      if (cleft <= 0) {
        ci++;
        cleft = credits[ci]?.amount || 0;
      }
    }
    return got;
  };

  const refs = [...charges.keys()].sort();
  const list = [];
  const overdue = [];
  let carry = 0;
  let carryFrom = null;
  for (let i = 0; i < refs.length || carry > 0; i++) {
    const ref = refs[i] || addMonths(list[list.length - 1].ref, 1);
    const close = cardClose(card, ref);
    const due = cardDue(card, ref);
    // Pagamentos atrasados quitam primeiro as faturas vencidas.
    for (const o of overdue) {
      if (o.remaining <= 0) continue;
      const got = take(o.remaining, due);
      o.paid += got;
      o.remaining -= got;
      if (o.remaining <= 0) o.status = 'paga';
    }
    const c = charges.get(ref) || { amount: 0, items: [] };
    const items = carry > 0 ? [{ label: `Saldo da fatura de ${MONTHS[Number(invMonth(card, carryFrom).slice(5)) - 1]}`, amount: carry, date: cardDue(card, carryFrom), carry: true }, ...c.items] : c.items;
    const amount = c.amount + carry;
    carry = 0;
    const paid = take(amount, due);
    let remaining = amount - paid;
    let carried = 0;
    let status;
    if (remaining <= 0) status = 'paga';
    else if (today < close) status = 'aberta';
    else if (today <= due) status = 'fechada';
    else if (paid > 0) {
      status = 'parcial';
      carried = carry = remaining;
      carryFrom = ref;
      remaining = 0;
    } else status = 'vencida';
    const inv = { ref, close, due, amount, paid, remaining, carried, items, status };
    list.push(inv);
    if (status === 'vencida') overdue.push(inv);
  }
  // Pagamentos que ainda sobraram vão para atrasadas e, depois, viram crédito no cartão.
  for (const o of overdue) {
    if (o.remaining <= 0) continue;
    const got = take(o.remaining, '9999-12-31');
    o.paid += got;
    o.remaining -= got;
    if (o.remaining <= 0) o.status = 'paga';
  }
  let credit = cleft;
  for (let j = ci + 1; j < credits.length; j++) credit += credits[j].amount;
  list.credit = ci < credits.length ? credit : 0;
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
  const p = { overdraft: 0, cards: 0, plans: 0, other: 0, late: 0, liquid: 0, bank: 0, cash: 0, invested: 0, savings: 0, vouchers: 0, credit: 0 };
  for (const a of S.acct) {
    if (a.openingDate > date) continue;
    const b = bal.get('a:' + a.id) || 0;
    if (a.kind === 'divida') {
      if (b < 0) p.other -= b;
      else p.credit += b;
    } else if (a.kind === 'investimento') p.invested += b;
    else if (a.kind === 'cofrinho') p.savings += Math.max(0, b);
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
  p.late = sum(lateBills(S, date, paid), (x) => x.amount);
  p.debt = p.overdraft + p.cards + p.plans + p.other + p.late;
  p.assets = p.liquid + p.invested + p.savings + p.vouchers + p.credit;
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
  const covered = coveredKeys(S);
  const occ = occMap(S);
  const out = [];
  for (const p of S.plan) {
    if (!(p.down > 0) || !p.downDate) continue;
    const m = ymOf(p.downDate);
    if (m < fromYM || m > toYM) continue;
    const key = downKey(p);
    out.push({ id: key, kind: 'plan', dir: 'out', title: p.name, date: p.downDate, month: m, parts: [{ key, label: 'Entrada', amount: p.down }], amount: p.down, paid: paid.has(key), tx: paid.get(key), src: p, categoryId: p.categoryId, ref: p.source || null });
  }
  for (let m = fromYM; m <= toYM; m = addMonths(m, 1)) {
    const merged = new Set();
    for (const b of S.bill) {
      if (!billActive(b, m)) continue;
      const ov = occ.get(`${b.id}:${m}`);
      if (ov?.skip) continue; // sem cobrança neste mês (parcelas vinculadas seguem separadas)
      const key = `b:${b.id}:${m}`;
      const parts = [{ key, label: ov && ov.amount != null ? 'Valor ajustado' : b.variable ? 'Valor estimado' : 'Mensal', amount: ov?.amount ?? (b.amount || 0) }];
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
        date: ov?.date || clampDay(m, b.day),
        month: m,
        parts,
        edited: !!ov,
        occ: ov || null,
        amount: sum(parts, (x) => x.amount),
        paid: !!ov?.settled || parts.every((x) => paid.has(x.key) || covered.has(x.key)),
        settled: !!ov?.settled && !paid.has(key),
        reneg: parts.some((x) => covered.has(x.key) && !paid.has(x.key)),
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
        carried: inv.carried,
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

/* ---------- Prioridade e sugestão de pagamento ----------
   Regras simples e explicáveis (sem IA). Cada compromisso pendente ganha uma pontuação:
   - prioridade marcada (essencial > importante > normal);
   - tipo: parcela de acordo (atrasar pode desfazer o acordo) e fatura (o saldo vai para o rotativo);
   - atraso (quanto mais atrasada, mais urgente; essencial atrasada há 15+ dias pode ter corte);
   - proximidade do vencimento.
   Depois, o dinheiro disponível é distribuído na ordem da pontuação até o próximo recebimento. */
export const PRIORITY = { normal: 'Normal', importante: 'Importante', essencial: 'Essencial' };
const PW = { essencial: 3, importante: 2, normal: 1 };

export function prioOf(o) {
  if (o.src?.priority) return o.src.priority;
  return o.kind === 'plan' && o.src?.kind === 'acordo' ? 'importante' : 'normal';
}

export function nextIncome(S, today) {
  const ym = ymOf(today);
  return obligations(S, ym, addMonths(ym, 2), today).find((o) => o.dir === 'in' && !o.paid && o.date >= today) || null;
}

export function paymentPlan(S, today, available) {
  const ni = nextIncome(S, today);
  const horizon = ni ? ni.date : addDays(today, 15);
  const ym = ymOf(today);
  const items = obligations(S, addMonths(ym, -24), ymOf(horizon), today)
    .filter((o) => o.dir === 'out' && !o.paid && o.date <= horizon && dueAmount(o) > 0 && o.ref?.k !== 'c')
    .map((o) => {
      const prio = prioOf(o);
      const late = daysBetween(o.date, today);
      const reasons = [];
      let score = PW[prio] * 100;
      if (prio === 'essencial') reasons.push('Serviço essencial');
      if (o.kind === 'plan') {
        score += 60;
        reasons.push(o.src?.kind === 'acordo' ? 'Parcela de acordo: atrasar pode desfazer o acordo' : 'Parcela: atraso gera multa e juros');
      }
      if (o.kind === 'invoice') {
        score += 50;
        reasons.push('Fatura: o que ficar sem pagar vai para o rotativo, com juros altos');
      }
      if (late > 0) {
        score += Math.min(60, late);
        reasons.push(`Atrasada há ${late} ${late === 1 ? 'dia' : 'dias'}`);
        if (prio === 'essencial' && late >= 15) {
          score += 40;
          reasons.push('Pode haver corte do serviço');
        }
      } else {
        const until = -late;
        score += Math.max(0, 30 - until);
        reasons.push(until === 0 ? 'Vence hoje' : until === 1 ? 'Vence amanhã' : `Vence em ${until} dias`);
      }
      return { o, prio, score, amount: dueAmount(o), late, reasons, partialOk: o.kind === 'invoice' };
    })
    .sort((a, b) => b.score - a.score || a.o.date.localeCompare(b.o.date));
  let left = Math.max(0, available);
  const now = [];
  const later = [];
  for (const it of items) {
    if (it.amount <= left) {
      now.push({ ...it, pay: it.amount });
      left -= it.amount;
    } else if (it.partialOk && left > 0) {
      now.push({ ...it, pay: left, partial: true });
      later.push({ ...it, amount: it.amount - left, rest: true });
      left = 0;
    } else later.push(it);
  }
  return { horizon, nextIncome: ni, available, now, later, totalNow: sum(now, (x) => x.pay), totalLater: sum(later, (x) => x.amount), left };
}
