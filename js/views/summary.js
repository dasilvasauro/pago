import * as store from '../core/store.js';
import { periodSummary, obligations, dueAmount } from '../core/domain.js';
import { today } from '../lib/clock.js';
import { esc, money, moneySigned, addDays, fmtDayLong, fmtDay, ymOf } from '../lib/util.js';
import { sheet, icon } from '../ui/ui.js';
import { openPay } from './txform.js';

// Mostra o resumo quando o dia virou desde a última abertura neste dispositivo.
export async function maybeSummary(idb, { force = false } = {}) {
  const td = today();
  const last = await idb.get('meta', 'lastSeen');
  await idb.put('meta', td, 'lastSeen');
  if (!force && (!last || last >= td)) return;
  const S = store.snapshot();
  if (!S.acct.length && !S.card.length) return;
  showSummary(last || addDays(td, -1), addDays(td, -1));
}

export function showSummary(from, to) {
  const S = store.snapshot();
  const td = today();
  const r = periodSummary(S, from, to, td);
  const away = r.days > 1;
  const dDebt = r.after.debt - r.before.debt;
  const late = r.obs.filter((o) => !o.paid && o.date < td);
  const paid = r.obs.filter((o) => o.paid);
  const dueToday = obligations(S, ymOf(td), ymOf(td), td).filter((o) => !o.paid && o.date === td);
  const all = new Map([...late, ...dueToday].map((o) => [o.id, o]));

  sheet({
    title: away ? `Resumo dos últimos ${r.days} dias` : 'Resumo de ontem',
    body: `<div class="summary">
      <p class="sum-sub">${away ? `Desde ${fmtDayLong(from).toLowerCase()} até ontem.` : fmtDayLong(from)}</p>
      <div class="sum-hero ${dDebt < 0 ? 'good' : dDebt > 0 ? 'bad' : ''}">
        <span>Dívida total</span>
        <b>${money(r.after.debt)}</b>
        <em>${dDebt === 0 ? 'Sem variação no período' : `${dDebt < 0 ? 'Caiu' : 'Subiu'} ${money(Math.abs(dDebt))}`}</em>
      </div>
      <div class="kpis">
        <div><span>Entradas</span><b class="pos">${money(r.income)}</b></div>
        <div><span>Saídas</span><b class="neg">${money(r.expense)}</b></div>
        <div><span>Resultado</span><b class="${r.result < 0 ? 'neg' : 'pos'}">${moneySigned(r.result)}</b></div>
      </div>
      <ul class="sum-facts">
        <li>${r.count} ${r.count === 1 ? 'lançamento registrado' : 'lançamentos registrados'}</li>
        ${r.daysWithout ? `<li>${r.daysWithout} ${r.daysWithout === 1 ? 'dia' : 'dias'} sem nenhum registro no diário</li>` : '<li>Todos os dias com registro no diário</li>'}
        ${r.obs.length ? `<li>${paid.length} de ${r.obs.length} compromissos do período quitados</li>` : ''}
      </ul>
      ${
        all.size
          ? `<h4 class="sub">Para resolver</h4><ul class="due-list">${[...all.values()]
              .map(
                (o) => `<li class="${o.date < td ? 'late' : ''}"><div><b>${esc(o.title)}</b><span>${o.date < td ? `Venceu ${fmtDay(o.date)}` : 'Vence hoje'}</span></div>
                <span class="amt">${money(dueAmount(o))}</span><button type="button" class="btn small" data-pay="${esc(o.id)}">${o.dir === 'in' ? 'Receber' : 'Pagar'}</button></li>`,
              )
              .join('')}</ul>`
          : ''
      }
      <div class="sheet-actions"><a class="btn ghost" href="#diario" data-close-go>${icon('diary')}Abrir diário</a><button type="button" class="btn primary" data-ok>Continuar</button></div>
    </div>`,
    onMount(el, close) {
      el.querySelector('[data-ok]').onclick = close;
      el.querySelector('[data-close-go]').onclick = () => close();
      el.querySelectorAll('[data-pay]').forEach((b) => (b.onclick = () => openPay(all.get(b.dataset.pay))));
    },
  });
}
