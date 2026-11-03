import * as store from '../core/store.js';
import { paymentPlan, position, PRIORITY } from '../core/domain.js';
import { today } from '../lib/clock.js';
import { esc, money, fmtDayLong, relDay, fmtMonthShort } from '../lib/util.js';
import { sheet, icon, tip, moneyInput, readMoney } from '../ui/ui.js';
import { openPay } from './txform.js';
import { calcAdd } from '../ui/calc.js';

export const prioPill = (p) =>
  p === 'essencial' ? `<span class="pill prio-e">${icon('flag')}Essencial</span>` : p === 'importante' ? `<span class="pill prio-i">${icon('flag')}Importante</span>` : '';

// Sugestão de pagamento: o que pagar agora com o dinheiro disponível e o que pode esperar.
export function openSuggest() {
  let unsub = () => {};
  const S0 = store.snapshot();
  let available = position(S0, today()).liquid;
  sheet({
    title: 'Sugestão de pagamento',
    wide: true,
    body: `<div class="form">
      <div class="grid2 sug-top">
        <div><span class="field-label">Disponível para pagar agora ${tip('Começa com a soma dos saldos positivos das contas e do dinheiro. Diminua se quiser guardar uma parte para mercado, transporte e outras despesas do dia a dia.')}</span>${moneyInput('avail', available, { big: true })}</div>
        <div class="sug-next" data-next></div>
      </div>
      <div data-plan></div>
      <p class="form-meta">Sugestão automática por regras: prioridade marcada, tipo de dívida, atraso e vencimento. A decisão é sua. Para marcar uma conta como essencial, edite a conta recorrente, o acordo ou o cartão.</p>
    </div>`,
    onMount(el) {
      const input = el.querySelector('input[name=avail]');
      const box = el.querySelector('[data-plan]');
      const draw = () => {
        const S = store.snapshot();
        const td = today();
        const p = paymentPlan(S, td, available);
        el.querySelector('[data-next]').innerHTML = p.nextIncome
          ? `<span>Próximo recebimento</span><b>${esc(p.nextIncome.title)}</b><small>${fmtDayLong(p.nextIncome.date)}, ${relDay(p.nextIncome.date, td)}, ${money(p.nextIncome.amount)}</small>`
          : `<span>Próximo recebimento</span><b>Nenhum previsto</b><small>Cadastre o salário como receita recorrente em Planejar. Por enquanto a sugestão olha os próximos 15 dias.</small>`;
        const row = (it, mode) => `<li>
            <div class="sug-main"><b>${esc(it.o.title)}${it.o.kind === 'bill' && it.o.month ? ` <small>${fmtMonthShort(it.o.month)}</small>` : ''}</b>
              <span class="ob-pills">${prioPill(it.prio)}</span>
              <span class="sug-why">${esc(it.reasons.join('. '))}.</span></div>
            <div class="sug-side"><span class="amt">${money(mode === 'now' ? it.pay : it.amount)}</span>
              ${mode === 'now' ? `${it.partial ? `<small>parte de ${money(it.amount)}</small>` : ''}<button type="button" class="btn small" data-pay="${esc(it.o.id)}" data-amt="${it.pay}">Pagar</button>` : it.rest ? '<small>restante</small>' : ''}</div>
          </li>`;
        box.innerHTML = !p.now.length && !p.later.length
          ? `<div class="empty-block">${icon('check')}<p>Nada pendente até ${p.nextIncome ? 'o próximo recebimento' : 'os próximos 15 dias'}.</p></div>`
          : `${p.now.length ? `<section class="sug-sec"><header><h4>Pagar agora</h4><b>${money(p.totalNow)}</b></header><ul class="sug-list">${p.now.map((x) => row(x, 'now')).join('')}</ul></section>` : `<p class="note">${icon('info')}O valor disponível não cobre nenhum compromisso inteiro. Veja abaixo a ordem sugerida para quando entrar dinheiro.</p>`}
            ${p.later.length ? `<section class="sug-sec later"><header><h4>Pode esperar${p.nextIncome ? ` até ${fmtDayLong(p.nextIncome.date).toLowerCase()}` : ''}</h4><b>${money(p.totalLater)}</b></header><ul class="sug-list">${p.later.map((x) => row(x, 'later')).join('')}</ul></section>` : ''}
            <div class="reneg-total"><span>Sobra depois dos pagamentos</span><b class="${p.left > 0 ? 'pos' : ''}">${money(p.left)}</b></div>
            <div class="sheet-actions"><span></span><button type="button" class="btn ghost" data-calc>${icon('calc')}Levar para a calculadora</button></div>`;
        box.querySelectorAll('[data-pay]').forEach((b) =>
          b.addEventListener('click', () => {
            const it = p.now.find((x) => x.o.id === b.dataset.pay);
            if (it) openPay(it.o, { amount: Number(b.dataset.amt) });
          }),
        );
        box.querySelector('[data-calc]')?.addEventListener('click', () => {
          calcAdd({ label: 'Disponível', v: available });
          if (p.now.length) calcAdd({ label: 'Pagar agora', op: '-', items: p.now.map((x) => ({ label: x.o.title, v: x.pay })) });
        });
      };
      input.addEventListener('money', () => {
        available = Math.abs(readMoney(input));
        clearTimeout(input._t);
        input._t = setTimeout(draw, 250);
      });
      draw();
      unsub = store.subscribe(draw);
    },
    onClose: () => unsub(),
  });
}

export { PRIORITY };
