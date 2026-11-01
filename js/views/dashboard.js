import * as store from '../core/store.js';
import { position, series, monthStats, projection, obligations, balances, cardInfo, firstDate, dueAmount, lateBills } from '../core/domain.js';
import { lateSnoozed, snoozeLate, snoozeEndsIn, HOUR } from '../core/snooze.js';
import { openLateBills } from './plan.js';
import { app } from '../state.js';
import { today } from '../lib/clock.js';
import { esc, money, moneySigned, addDays, addMonths, ymOf, relDay, fmtDay, fmtMonth } from '../lib/util.js';
import { tip, icon, countUp, toast } from '../ui/ui.js';
import { lineChart } from '../ui/chart.js';
import { openPay } from './txform.js';

let range = localStorage.getItem('pago.range') || '90';
let showNet = localStorage.getItem('pago.showNet') !== '0';
let counted = false;
let reshow = 0;
let mode = localStorage.getItem('pago.heroMode') === 'saldo' ? 'saldo' : 'divida';

export const title = 'Início';

export function render(el) {
  const S = store.snapshot();
  const td = today();
  if (!S.acct.length && !S.card.length && !S.plan.length) return renderEmpty(el);

  const pos = position(S, td);
  const prev = position(S, addDays(td, -30));
  const isSaldo = mode === 'saldo';
  const value = isSaldo ? pos.liquid : pos.debt;
  const delta = value - (isSaldo ? prev.liquid : prev.debt);
  const good = isSaldo ? delta > 0 : delta < 0;
  const ym = ymOf(td);
  const ms = monthStats(S, ym);
  const pj = projection(S, td);
  const bal = balances(S, td);

  const upcoming = obligations(S, addMonths(ym, -2), addMonths(ym, 1), td)
    .filter((o) => !o.paid && o.date <= addDays(td, 10))
    .slice(0, 8);

  const cats = [...ms.byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const catMax = cats[0]?.[1] || 1;

  // Aviso de contas atrasadas (contas recorrentes; cartão e cheque especial ficam de fora).
  const late = lateBills(S, td);
  const lateKeys = late.map((x) => x.key);
  const showLate = lateKeys.length > 0 && !lateSnoozed(lateKeys);
  clearTimeout(reshow);
  if (lateKeys.length && !showLate && snoozeEndsIn() < 2 * HOUR) reshow = setTimeout(() => app.refresh(), snoozeEndsIn() + 1000);
  const byBill = new Map();
  for (const x of late) byBill.set(x.bill.name, (byBill.get(x.bill.name) || 0) + 1);
  const lateTotal = late.reduce((a, x) => a + x.amount, 0);

  el.innerHTML = `
  ${
    showLate
      ? `<section class="alert" role="alert">
      <div class="alert-txt"><b>${late.length} ${late.length === 1 ? 'conta atrasada' : 'contas atrasadas'}, ${money(lateTotal)}</b>
      <span>${esc([...byBill].map(([n, c]) => `${n} (${c} ${c === 1 ? 'mês' : 'meses'})`).join(', '))}</span></div>
      <div class="alert-acts">
        <button type="button" class="btn small primary" data-late-pay>Pagar agora</button>
        <button type="button" class="btn small ghost" data-late-later>Lembre-me mais tarde</button>
        <button type="button" class="btn small ghost" data-late-cant>Não consigo pagar agora</button>
      </div>
    </section>`
      : ''
  }
  <section class="hero">
    <div class="hero-top">
      <div class="hero-num">
        <div class="label hero-switch">
          <div class="seg small" role="radiogroup" aria-label="Mostrar">
            <button type="button" role="radio" aria-checked="${!isSaldo}" data-mode="divida" class="${!isSaldo ? 'on' : ''}">Dívida total</button>
            <button type="button" role="radio" aria-checked="${isSaldo}" data-mode="saldo" class="${isSaldo ? 'on' : ''}">Saldo total</button>
          </div>
          ${tip(isSaldo ? 'Soma dos valores positivos nas contas correntes, poupanças e em dinheiro. Contas no negativo não entram aqui: elas aparecem como cheque especial na dívida. Vouchers, cofrinhos e investimentos ficam à parte.' : 'Soma do cheque especial em uso, de tudo o que está nos cartões de crédito (inclusive parcelas futuras), do que falta pagar em acordos e parcelamentos, das outras dívidas e das contas recorrentes em atraso. Atualiza a cada lançamento.')}
        </div>
        <p class="big" data-big>${money(value)}</p>
        <p class="delta ${delta === 0 ? '' : good ? 'good' : 'bad'}">${delta === 0 ? 'Sem variação' : `${delta < 0 ? 'Caiu' : 'Subiu'} ${money(Math.abs(delta))}`} nos últimos 30 dias</p>
      </div>
      <dl class="hero-break">
        ${
          isSaldo
            ? `<div><dt>Contas bancárias</dt><dd>${money(pos.bank)}</dd></div>
        <div><dt>Dinheiro</dt><dd>${money(pos.cash)}</dd></div>
        <div><dt>Vouchers</dt><dd>${money(pos.vouchers)}</dd></div>
        <div><dt>Investimentos</dt><dd>${money(pos.invested)}</dd></div>
        ${pos.savings ? `<div><dt>Cofrinhos</dt><dd>${money(pos.savings)}</dd></div>` : ''}`
            : `<div><dt>Cheque especial</dt><dd>${money(pos.overdraft)}</dd></div>
        <div><dt>Cartões</dt><dd>${money(pos.cards)}</dd></div>
        <div><dt>Acordos e parcelamentos</dt><dd>${money(pos.plans)}</dd></div>
        ${pos.other ? `<div><dt>Outras dívidas</dt><dd>${money(pos.other)}</dd></div>` : ''}
        ${pos.late ? `<div><dt>Contas em atraso ${tip('Contas recorrentes vencidas e ainda não pagas. Saem daqui ao registrar o pagamento ou ao renegociá-las em Planejar.')}</dt><dd class="neg">${money(pos.late)}</dd></div>` : ''}`
        }
        <div><dt>Patrimônio líquido ${tip('Tudo o que você tem (contas positivas, vouchers e investimentos) menos a dívida total.')}</dt><dd class="${pos.net < 0 ? 'neg' : 'pos'}">${money(pos.net)}</dd></div>
      </dl>
    </div>
    <div class="chart-bar">
      <div class="seg small" data-range>
        ${[['30', '30 dias'], ['90', '90 dias'], ['365', '12 meses'], ['all', 'Tudo']].map(([v, l]) => `<button type="button" data-r="${v}" class="${range === v ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <button type="button" class="legend-btn ${showNet ? 'on' : ''}" data-net><i></i>Patrimônio líquido</button>
    </div>
    <div class="chart" data-chart></div>
  </section>

  <div class="dash-grid">
    <section class="panel">
      <header class="panel-head"><h3>${fmtMonth(ym)}</h3>${tip('Entradas e saídas registradas no diário neste mês. Transferências e pagamentos de fatura não contam como gasto; a compra no cartão já contou.')}</header>
      <div class="kpis">
        <div><span>Entradas</span><b class="pos">${money(ms.income)}</b></div>
        <div><span>Saídas</span><b class="neg">${money(ms.expense)}</b></div>
        <div><span>Resultado</span><b class="${ms.result < 0 ? 'neg' : 'pos'}">${moneySigned(ms.result)}</b></div>
      </div>
      <div class="proj">
        <div><span>Saldo nas contas hoje</span><b>${money(pj.now)}</b></div>
        <div><span>Ainda vai entrar</span><b class="pos">${money(pj.pin)}</b></div>
        <div><span>Ainda vai sair</span><b class="neg">${money(pj.pout)}</b></div>
        <div class="proj-end"><span>Projeção para o fim do mês ${tip('Saldo das contas (descontando o cheque especial) mais receitas previstas, menos contas fixas, parcelas e faturas ainda não pagas, incluindo atrasadas.')}</span><b class="${pj.end < 0 ? 'neg' : 'pos'}">${money(pj.end)}</b></div>
      </div>
    </section>

    <section class="panel">
      <header class="panel-head"><h3>Próximos vencimentos</h3>${tip('Contas, parcelas e faturas não pagas que vencem nos próximos 10 dias, mais as atrasadas.')}<a href="#planejar" class="link">Ver mês</a></header>
      ${
        upcoming.length
          ? `<ul class="due-list">${upcoming
              .map(
                (o) => `<li class="${o.date < td ? 'late' : ''}">
                  <div><b>${esc(o.title)}</b><span>${o.date < td ? 'Atrasado, venceu ' + relDay(o.date, td) : relDay(o.date, td) === 'hoje' ? 'Vence hoje' : 'Vence ' + relDay(o.date, td)}${o.partial ? ', pago em parte' : ''}</span></div>
                  <span class="amt ${o.dir === 'in' ? 'pos' : ''}">${money(dueAmount(o))}</span>
                  <button type="button" class="btn small" data-pay="${esc(o.id)}">${o.dir === 'in' ? 'Receber' : 'Pagar'}</button>
                </li>`,
              )
              .join('')}</ul>`
          : `<p class="empty">Nada vencendo nos próximos 10 dias.</p>`
      }
    </section>

    <section class="panel">
      <header class="panel-head"><h3>Contas e cartões</h3><a href="#carteira" class="link">Carteira</a></header>
      <ul class="mini-list">
        ${S.acct
          .filter((a) => !a.archived && !['investimento', 'divida', 'cofrinho'].includes(a.kind))
          .map((a) => {
            const b = bal.get('a:' + a.id) || 0;
            const lim = a.overdraftLimit || 0;
            const used = b < 0 ? -b : 0;
            return `<li><div><b>${esc(a.name)}</b>${a.kind === 'corrente' && lim ? `<div class="bar ${used ? 'warn' : ''}"><i style="width:${Math.min(100, (used / lim) * 100)}%"></i></div><span>${used ? `${money(used)} de ${money(lim)} do cheque especial` : `Cheque especial livre: ${money(lim)}`}</span>` : ''}</div><span class="amt ${b < 0 ? 'neg' : ''}">${money(b)}</span></li>`;
          })
          .join('')}
        ${S.card
          .filter((c) => c.kind === 'credito' && !c.archived)
          .map((c) => {
            const info = cardInfo(S, c, td, bal);
            const pct = c.limit ? Math.min(100, (info.outstanding / c.limit) * 100) : 0;
            return `<li><div><b>${esc(c.name)}</b><div class="bar ${pct > 85 ? 'warn' : ''}"><i style="width:${pct}%"></i></div><span>${money(info.outstanding)} de ${money(c.limit || 0)} do limite</span></div><span class="amt">${info.current ? money(info.current.remaining || info.current.amount) : money(0)}<small>${info.current ? 'fatura ' + fmtDay(info.current.due) : ''}</small></span></li>`;
          })
          .join('')}
      </ul>
    </section>

    <section class="panel">
      <header class="panel-head"><h3>Gastos por categoria</h3>${tip('Saídas do mês atual agrupadas por categoria.')}</header>
      ${
        cats.length
          ? `<ul class="cat-bars">${cats
              .map(([id, v]) => {
                const c = S.byId.get(id);
                return `<li><div class="cat-line"><span><i style="background:${c?.color || 'var(--muted)'}"></i>${esc(c?.name || 'Sem categoria')}</span><b>${money(v)}</b></div><div class="bar thin"><i style="width:${(v / catMax) * 100}%;background:${c?.color || 'var(--muted)'}"></i></div></li>`;
              })
              .join('')}</ul>`
          : `<p class="empty">Nenhuma saída registrada neste mês.</p>`
      }
    </section>
  </div>`;

  // Gráfico
  const chartEl = el.querySelector('[data-chart]');
  const draw = (animate) => {
    const start = range === 'all' ? firstDate(S) || addDays(td, -30) : addDays(td, -Number(range));
    const fd = firstDate(S);
    const from = fd && fd > start ? fd : start;
    const pts = series(S, from, td);
    const lines = [isSaldo ? { key: 'liquid', label: 'Saldo total', cls: 'l-debt' } : { key: 'debt', label: 'Dívida', cls: 'l-debt' }];
    if (showNet) lines.push({ key: 'net', label: 'Patrimônio líquido', cls: 'l-net' });
    lineChart(chartEl, { points: pts, lines, animate });
  };
  draw(!counted);
  el.querySelectorAll('[data-r]').forEach((b) =>
    b.addEventListener('click', () => {
      range = b.dataset.r;
      localStorage.setItem('pago.range', range);
      el.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x === b));
      draw(true);
    }),
  );
  el.querySelector('[data-net]').addEventListener('click', (e) => {
    showNet = !showNet;
    localStorage.setItem('pago.showNet', showNet ? '1' : '0');
    e.currentTarget.classList.toggle('on', showNet);
    draw(false);
  });
  if (!counted) {
    countUp(el.querySelector('[data-big]'), value, money);
    counted = true;
  }
  el.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.mode === mode) return;
      mode = b.dataset.mode;
      localStorage.setItem('pago.heroMode', mode);
      counted = false;
      render(el);
    }),
  );
  el.querySelector('[data-late-pay]')?.addEventListener('click', openLateBills);
  el.querySelector('[data-late-later]')?.addEventListener('click', () => {
    snoozeLate(HOUR, lateKeys);
    render(el);
    toast('Aviso adiado por uma hora');
  });
  el.querySelector('[data-late-cant]')?.addEventListener('click', () => {
    snoozeLate(7 * 24 * HOUR, lateKeys);
    render(el);
    toast('Aviso adiado por 7 dias. Se outra conta atrasar, ele volta antes.');
  });
  const obsById = new Map(upcoming.map((o) => [o.id, o]));
  el.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => openPay(obsById.get(b.dataset.pay))));

  const ro = new ResizeObserver(() => {
    if (!chartEl.isConnected) return ro.disconnect();
    if (Math.abs(chartEl._w - chartEl.clientWidth) > 20) draw(false);
    chartEl._w = chartEl.clientWidth;
  });
  chartEl._w = chartEl.clientWidth;
  ro.observe(chartEl);
}

function renderEmpty(el) {
  el.innerHTML = `
  <section class="start">
    <h2>Monte sua carteira</h2>
    <p>O Pago calcula dívida, saldos e projeções a partir do que você cadastra e registra no diário. Comece por aqui:</p>
    <ol class="steps">
      <li><a href="#carteira"><b>Instituições, contas e cartões</b><span>Informe o saldo atual de cada conta (pode ser negativo) e o que já está nos cartões.</span></a></li>
      <li><a href="#planejar"><b>Contas fixas e acordos</b><span>Aluguel, internet, salário, renegociações e contas parceladas.</span></a></li>
      <li><a href="#diario"><b>Diário</b><span>Todo dia, registre o que entrou e o que saiu.</span></a></li>
    </ol>
  </section>`;
}

