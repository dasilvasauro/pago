import * as store from '../core/store.js';
import { monthStats } from '../core/domain.js';
import { today } from '../lib/clock.js';
import { esc, money, moneySigned, ymOf, addMonths, fmtMonth, fmtDayLong, relDay } from '../lib/util.js';
import { icon, tip, opt } from '../ui/ui.js';
import { openTx, txRow, walletOptions, decodeWallet } from './txform.js';
import { METHODS } from '../core/methods.js';

export const title = 'Diário';

let month = null;
let base = null;
let filter = 'all';
let wallet = '';
let q = '';

export function render(el) {
  const S = store.snapshot();
  const td = today();
  // Acompanha a virada do mês: se a tela estava no mês corrente, passa para o novo.
  if (!month || (month === base && base !== ymOf(td))) month = ymOf(td);
  base = ymOf(td);
  const ms = monthStats(S, month);
  const w = wallet ? decodeWallet(S, wallet) : null;
  const matchW = (t) => {
    if (!w) return true;
    if (wallet.startsWith('d:')) return t.via === w.via;
    const same = (r) => r && r.k === w.ref.k && r.id === w.ref.id;
    return same(t.from) || same(t.to);
  };
  const ql = q.toLowerCase();
  const list = S.tx
    .filter((t) => t.date.startsWith(month))
    .filter((t) => filter === 'all' || (filter === 'pix' ? t.method === 'pix' : t.type === filter || (filter === 'transf' && t.type === 'ajuste')))
    .filter(matchW)
    .filter((t) => !ql || [t.desc, t.contact, S.byId.get(t.categoryId)?.name, METHODS[t.method]].some((x) => (x || '').toLowerCase().includes(ql)))
    .reverse();

  const days = new Map();
  for (const t of list) (days.get(t.date) || days.set(t.date, []).get(t.date)).push(t);
  const archived = S.archive.some((a) => a.month === month);

  el.innerHTML = `
  <div class="month-nav">
    <button type="button" class="icon-btn" data-m="-1" aria-label="Mês anterior">${icon('left')}</button>
    <h2>${fmtMonth(month)}</h2>
    <button type="button" class="icon-btn" data-m="1" aria-label="Próximo mês">${icon('right')}</button>
  </div>
  ${
    filter === 'pix'
      ? (() => {
          const px = S.tx.filter((t) => t.date.startsWith(month) && t.method === 'pix');
          const sent = px.filter((t) => t.type === 'saida').reduce((a, t) => a + t.amount, 0);
          const got = px.filter((t) => t.type === 'entrada').reduce((a, t) => a + t.amount, 0);
          return `<div class="kpis strip">
            <div><span>Pix enviados</span><b class="neg">${money(sent)}</b></div>
            <div><span>Pix recebidos</span><b class="pos">${money(got)}</b></div>
            <div><span>Saldo do Pix</span><b class="${got - sent < 0 ? 'neg' : 'pos'}">${moneySigned(got - sent)}</b></div></div>`;
        })()
      : `<div class="kpis strip">
    <div><span>Entradas</span><b class="pos">${money(ms.income)}</b></div>
    <div><span>Saídas</span><b class="neg">${money(ms.expense)}</b></div>
    <div><span>Resultado</span><b class="${ms.result < 0 ? 'neg' : 'pos'}">${moneySigned(ms.result)}</b></div>
  </div>`
  }
  <div class="filters">
    <div class="chips">
      ${[['all', 'Tudo'], ['saida', 'Saídas'], ['entrada', 'Entradas'], ['transf', 'Transferências'], ['pix', 'Pix']].map(([v, l]) => `<button type="button" class="chip ${filter === v ? 'on' : ''}" data-f="${v}">${l}</button>`).join('')}
    </div>
    <div class="filter-row">
      <select data-w aria-label="Filtrar por conta ou cartão">${walletOptions(S, 'out', wallet).replace('<option value="" data-ph>Selecionar</option>', '<option value="">Todas as contas e cartões</option>')}</select>
      <input type="search" data-q placeholder="Buscar" value="${esc(q)}" aria-label="Buscar no diário">
    </div>
  </div>
  ${archived ? `<p class="note">${icon('archive')}Mês arquivado. Os lançamentos ficam disponíveis para consulta e relatórios.${tip('Meses antigos são compactados para economizar espaço na nuvem. Veja Ajustes, Dados.')}</p>` : ''}
  ${
    days.size
      ? [...days.entries()]
          .map(([d, ts]) => {
            const net = ts.reduce((a, t) => a + (t.type === 'entrada' ? t.amount : t.type === 'saida' ? -t.amount : 0), 0);
            return `<section class="day">
              <header><h3>${fmtDayLong(d)}${d === td ? ' <em>hoje</em>' : ''}</h3><span class="${net < 0 ? 'neg' : net > 0 ? 'pos' : ''}">${net ? moneySigned(net) : ''}</span></header>
              ${ts.map((t) => txRow(S, t)).join('')}
            </section>`;
          })
          .join('')
      : `<div class="empty-block">${icon('diary')}<p>${month === ymOf(td) ? 'Nenhum lançamento neste mês ainda. Use o botão + para registrar o primeiro.' : 'Nenhum lançamento encontrado.'}</p></div>`
  }`;

  el.querySelectorAll('[data-m]').forEach((b) =>
    b.addEventListener('click', () => {
      month = addMonths(month, Number(b.dataset.m));
      render(el);
    }),
  );
  el.querySelectorAll('[data-f]').forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.f;
      render(el);
    }),
  );
  el.querySelector('[data-w]').addEventListener('change', (e) => {
    wallet = e.target.value;
    render(el);
  });
  const qi = el.querySelector('[data-q]');
  qi.addEventListener('input', () => {
    q = qi.value;
    clearTimeout(qi._t);
    qi._t = setTimeout(() => {
      render(el);
      const n = el.querySelector('[data-q]');
      n.focus();
      n.setSelectionRange(n.value.length, n.value.length);
    }, 250);
  });
  el.querySelectorAll('[data-tx]').forEach((b) => b.addEventListener('click', () => openTx({ id: b.dataset.tx })));
}

export function setMonth(ym) {
  month = ym;
}
export { relDay };
