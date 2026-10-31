import * as store from '../core/store.js';
import { obligations, dueAmount, planStatus, paidKeys, PLAN_KINDS, planMonthOf } from '../core/domain.js';
import { today } from '../lib/clock.js';
import { esc, money, ymOf, addMonths, fmtMonth, fmtMonthShort, relDay, sum, fmtDay } from '../lib/util.js';
import { icon, tip, sheet, moneyInput, readMoney, opt, seg, field, toast, confirmDialog } from '../ui/ui.js';
import { openPay, walletOptions, decodeWallet, encodeWallet } from './txform.js';
import { METHODS, BILL_METHODS } from '../core/methods.js';

const methodSelect = (sel) =>
  field('Forma de pagamento', `<select name="method"><option value="">Não definida</option>${BILL_METHODS.map((m) => opt(m, METHODS[m], m === sel)).join('')}</select>`, 'Sugestão usada ao registrar o pagamento. Pode ser trocada na hora.');

export const title = 'Planejar';
let month = null;
let base = null;

export function render(el) {
  const S = store.snapshot();
  const td = today();
  // Acompanha a virada do mês: se a tela estava no mês corrente, passa para o novo.
  if (!month || (month === base && base !== ymOf(td))) month = ymOf(td);
  base = ymOf(td);
  const obs = obligations(S, month, month, td);
  const outs = obs.filter((o) => o.dir === 'out');
  const ins = obs.filter((o) => o.dir === 'in');
  const total = sum(outs, (o) => o.amount);
  const paidOut = sum(outs, (o) => (o.kind === 'invoice' ? o.amount - o.remaining : o.paid ? o.amount : 0));
  const inTotal = sum(ins, (o) => o.amount);
  const inPaid = sum(ins.filter((o) => o.paid), (o) => o.amount);
  const paid = paidKeys(S);

  el.innerHTML = `
  <div class="month-nav">
    <button type="button" class="icon-btn" data-m="-1" aria-label="Mês anterior">${icon('left')}</button>
    <h2>${fmtMonth(month)}</h2>
    <button type="button" class="icon-btn" data-m="1" aria-label="Próximo mês">${icon('right')}</button>
  </div>

  <section class="panel plan-sum">
    <div class="ps-row"><span>Comprometido ${tip('Soma das contas fixas, parcelas e faturas que vencem neste mês.')}</span><b>${money(total)}</b></div>
    <div class="bar big"><i style="width:${total ? Math.min(100, (paidOut / total) * 100) : 0}%"></i></div>
    <div class="ps-foot"><span>Pago ${money(paidOut)}</span><span>Falta ${money(Math.max(0, total - paidOut))}</span></div>
    ${ins.length ? `<div class="ps-row in"><span>Receitas previstas</span><b class="pos">${money(inTotal)}</b></div><div class="ps-foot"><span>Recebido ${money(inPaid)}</span><span>Falta ${money(inTotal - inPaid)}</span></div>` : ''}
  </section>

  <section class="block">
    <header class="block-head"><h3>Calendário do mês</h3>${tip('Toque em Pagar ou Receber para registrar no diário. O lançamento já sai com valor, conta e categoria preenchidos.')}</header>
    ${
      obs.length
        ? `<ul class="ob-list">${obs
            .map((o) => {
              const late = !o.paid && o.date < td;
              const state = o.paid ? `<span class="pill ok">${icon('check')}${o.dir === 'in' ? 'Recebido' : 'Pago'}</span>` : late ? `<span class="pill late">Atrasado</span>` : `<span class="pill">${relDay(o.date, td)}</span>`;
              return `<li class="${o.paid ? 'done' : ''}">
                <div class="ob-date"><b>${o.date.slice(8)}</b><span>${fmtDay(o.date).split(' ')[1]}</span></div>
                <div class="ob-main"><b>${esc(o.title)}</b>
                  ${o.parts.length > 1 ? `<span>${o.parts.map((p) => `${esc(p.label)} ${money(p.amount)}`).join(' + ')}</span>` : o.kind === 'invoice' ? `<span>${o.partial ? `Pago ${money(o.amount - o.remaining)} de ${money(o.amount)}` : 'Fatura do cartão'}</span>` : o.kind === 'plan' ? `<span>${esc(o.parts[0].label)}</span>` : o.src.variable ? '<span>Valor variável</span>' : ''}
                  ${state}
                </div>
                <div class="ob-side"><span class="amt ${o.dir === 'in' ? 'pos' : ''}">${money(o.kind === 'invoice' && !o.paid ? o.remaining : o.amount)}</span>
                  <button type="button" class="btn small ${o.paid ? 'ghost' : ''}" data-ob="${esc(o.id)}">${o.paid ? 'Ver' : o.dir === 'in' ? 'Receber' : 'Pagar'}</button></div>
              </li>`;
            })
            .join('')}</ul>`
        : `<p class="empty">Nenhum compromisso neste mês. Cadastre contas fixas e parcelamentos abaixo.</p>`
    }
  </section>

  <div class="two-col">
    <section class="block">
      <header class="block-head"><h3>Contas recorrentes</h3>${tip('Despesas e receitas que se repetem todo mês: aluguel, internet, luz, salário, recarga de voucher. Contas de valor variável usam uma estimativa até você registrar o valor real.')}<button type="button" class="btn small" data-new-bill>${icon('plus')}Nova</button></header>
      ${
        S.bill.length
          ? `<ul class="rows">${S.bill
              .map(
                (b) => `<li><button type="button" data-bill="${b.id}" class="row-btn ${b.active === false ? 'muted' : ''}">
                  <span class="row-main"><b>${esc(b.name)}</b><span>Dia ${b.day}${b.variable ? ', valor variável' : ''}${b.active === false ? ', pausada' : ''}${b.endMonth ? `, até ${fmtMonthShort(b.endMonth)}` : ''}</span></span>
                  <span class="amt ${b.dir === 'in' ? 'pos' : ''}">${b.dir === 'in' ? '+' : ''}${money(b.amount)}</span></button></li>`,
              )
              .join('')}</ul>`
          : `<p class="empty">Nenhuma conta recorrente.</p>`
      }
    </section>

    <section class="block">
      <header class="block-head"><h3>Parcelamentos e acordos</h3>${tip('Renegociações, empréstimos, financiamentos e contas parceladas (como um débito de gás em 5x). As parcelas restantes entram na dívida total. Vincule a uma conta recorrente para que a parcela venha somada ao valor mensal.')}<button type="button" class="btn small" data-new-plan>${icon('plus')}Novo</button></header>
      ${
        S.plan.length
          ? `<ul class="rows">${S.plan
              .map((p) => {
                const st = planStatus(p, paid);
                return `<li><button type="button" data-plan="${p.id}" class="row-btn">
                  <span class="row-main"><b>${esc(p.name)}</b><span>${st.paid}/${p.n} pagas, restam ${money(st.remaining)}${st.remainingN ? `, termina em ${fmtMonthShort(planMonthOf(p, p.n))}` : ''}</span>
                  <span class="bar thin"><i style="width:${(st.paid / p.n) * 100}%"></i></span></span>
                  <span class="amt">${money(p.amount)}<small>por mês</small></span></button></li>`;
              })
              .join('')}</ul>`
          : `<p class="empty">Nenhum parcelamento ou acordo.</p>`
      }
    </section>
  </div>`;

  el.querySelectorAll('[data-m]').forEach((b) =>
    b.addEventListener('click', () => {
      month = addMonths(month, Number(b.dataset.m));
      render(el);
    }),
  );
  const byId = new Map(obs.map((o) => [o.id, o]));
  el.querySelectorAll('[data-ob]').forEach((b) => b.addEventListener('click', () => openPay(byId.get(b.dataset.ob))));
  el.querySelector('[data-new-bill]').addEventListener('click', () => openBill());
  el.querySelector('[data-new-plan]').addEventListener('click', () => openPlan());
  el.querySelectorAll('[data-bill]').forEach((b) => b.addEventListener('click', () => openBill(b.dataset.bill)));
  el.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => openPlan(b.dataset.plan)));
}

function catOpts(S, kind, sel) {
  return `<option value="">Sem categoria</option>${S.cat.filter((c) => c.kind === kind && !c.archived).map((c) => opt(c.id, c.name, c.id === sel)).join('')}`;
}

export function openBill(id) {
  const S = store.snapshot();
  const b = id ? S.byId.get(id) : { dir: 'out', amount: 0, day: 10, variable: false, startMonth: ymOf(today()), active: true };
  let dir = b.dir || 'out';
  const dyn = () => `
    ${field(dir === 'in' ? 'Recebe em' : 'Paga com', `<select name="w">${walletOptions(S, dir === 'in' ? 'in' : 'out', encodeWallet(b.source, b.sourceVia))}</select>`, 'Sugestão usada ao registrar o pagamento. Se for um cartão de crédito, a conta passa a entrar na fatura.')}
    ${field('Categoria', `<select name="categoryId">${catOpts(S, dir === 'in' ? 'entrada' : 'saida', b.categoryId)}</select>`)}`;
  sheet({
    title: id ? 'Editar conta recorrente' : 'Nova conta recorrente',
    body: `<form class="form" data-f>
      ${seg('dir', [['out', 'Despesa'], ['in', 'Receita']], dir)}
      <label class="field"><span>Nome</span><input name="name" value="${esc(b.name || '')}" required maxlength="50" placeholder="Ex.: Internet"></label>
      ${moneyInput('amount', b.amount, { big: true })}
      <label class="check"><input type="checkbox" name="variable" ${b.variable ? 'checked' : ''}><span>Valor variável (luz, água, gás)</span>${tip('O valor acima vira uma estimativa. Ao pagar, informe o valor real.')}</label>
      <div class="grid2">
        <label class="field"><span>Dia do vencimento</span><input name="day" type="number" min="1" max="31" value="${b.day}" required inputmode="numeric"></label>
        <label class="field"><span>Começa em</span><input name="startMonth" type="month" value="${b.startMonth}" required></label>
      </div>
      <div data-dyn>${dyn()}</div>
      ${methodSelect(b.method)}
      <div class="grid2">
        <label class="field"><span>Termina em</span><input name="endMonth" type="month" value="${b.endMonth || ''}"></label>
        <label class="check pad"><input type="checkbox" name="active" ${b.active !== false ? 'checked' : ''}><span>Ativa</span></label>
      </div>
      <div class="sheet-actions">${id ? `<button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Excluir</button>` : '<span></span>'}<button class="btn primary">Salvar</button></div>
    </form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      f.querySelectorAll('input[name=dir]').forEach((r) =>
        r.addEventListener('change', () => {
          dir = r.value;
          el.querySelector('[data-dyn]').innerHTML = dyn();
        }),
      );
      el.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await confirmDialog('Excluir esta conta recorrente? Pagamentos já registrados continuam no diário.', { ok: 'Excluir', danger: true }))) return;
        await store.remove(id);
        close();
        toast('Conta recorrente excluída');
      });
      f.onsubmit = async (e) => {
        e.preventDefault();
        const w = decodeWallet(store.snapshot(), f.w.value);
        const data = {
          dir,
          name: f.name.value.trim(),
          amount: Math.abs(readMoney(f.amount)),
          variable: f.variable.checked,
          day: Math.min(31, Math.max(1, Number(f.day.value))),
          startMonth: f.startMonth.value,
          endMonth: f.endMonth.value || '',
          active: f.active.checked,
          categoryId: f.categoryId.value,
          source: w.ref,
          sourceVia: w.via || '',
          method: f.method.value,
        };
        await store.save('bill', data, id);
        close();
        toast('Conta recorrente salva');
      };
    },
  });
}

export function openPlan(id) {
  const S = store.snapshot();
  const td = today();
  const p = id ? S.byId.get(id) : { kind: 'acordo', amount: 0, n: 12, paidBefore: 0, startMonth: addMonths(ymOf(td), 0), day: 10 };
  sheet({
    title: id ? 'Editar parcelamento' : 'Novo parcelamento ou acordo',
    body: `<form class="form" data-f>
      <label class="field"><span>Nome</span><input name="name" value="${esc(p.name || '')}" required maxlength="50" placeholder="Ex.: Acordo cartão"></label>
      <div class="grid2">
        ${field('Tipo', `<select name="kind">${Object.entries(PLAN_KINDS).map(([k, l]) => opt(k, l, k === p.kind)).join('')}</select>`)}
        ${field('Instituição', `<select name="institutionId"><option value="">Nenhuma</option>${S.inst.map((i) => opt(i.id, i.name, i.id === p.institutionId)).join('')}</select>`)}
      </div>
      <span class="field-label">Valor da parcela</span>
      ${moneyInput('amount', p.amount, { big: true })}
      <div class="grid3">
        <label class="field"><span>Total de parcelas</span><input name="n" type="number" min="1" max="600" value="${p.n}" required inputmode="numeric"></label>
        <label class="field"><span>Já pagas</span><input name="paidBefore" type="number" min="0" value="${p.paidBefore || 0}" required inputmode="numeric"></label>
        <label class="field"><span>Dia</span><input name="day" type="number" min="1" max="31" value="${p.day}" required inputmode="numeric"></label>
      </div>
      ${field('Próxima parcela em', `<input name="startMonth" type="month" value="${p.startMonth}" required>`, 'Mês da primeira parcela que ainda não foi paga quando você cadastrou.')}
      ${field('Somar a uma conta recorrente', `<select name="billId"><option value="">Não, cobrança separada</option>${S.bill.filter((b) => b.dir !== 'in').map((b) => opt(b.id, b.name, b.id === p.billId)).join('')}</select>`, 'Use quando a parcela vem junto com a conta do mês, como um débito de gás parcelado na própria fatura do gás.')}
      <div class="grid2">
        ${field('Paga com', `<select name="w">${walletOptions(S, 'out', encodeWallet(p.source, p.sourceVia))}</select>`)}
        ${field('Categoria', `<select name="categoryId">${catOpts(S, 'saida', p.categoryId)}</select>`)}
      </div>
      ${methodSelect(p.method)}
      <p class="form-meta" data-calc></p>
      <div class="sheet-actions">${id ? `<button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Excluir</button>` : '<span></span>'}<button class="btn primary">Salvar</button></div>
    </form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      const calc = () => {
        const n = Number(f.n.value) || 0;
        const k = Number(f.paidBefore.value) || 0;
        const a = Math.abs(readMoney(f.amount));
        const rest = Math.max(0, n - k);
        el.querySelector('[data-calc]').textContent = rest && a && f.startMonth.value ? `Restam ${rest} parcelas, ${money(rest * a)} no total. Última em ${fmtMonthShort(addMonths(f.startMonth.value, rest - 1))}.` : '';
      };
      ['n', 'paidBefore', 'startMonth'].forEach((k) => f[k].addEventListener('input', calc));
      f.amount.addEventListener('money', calc);
      calc();
      el.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await confirmDialog('Excluir este parcelamento? Ele deixa de contar na dívida. Pagamentos já registrados continuam no diário.', { ok: 'Excluir', danger: true }))) return;
        await store.remove(id);
        close();
        toast('Parcelamento excluído');
      });
      f.onsubmit = async (e) => {
        e.preventDefault();
        const n = Number(f.n.value);
        const k = Number(f.paidBefore.value);
        if (k > n) return toast('Parcelas pagas não podem passar do total.');
        const w = decodeWallet(store.snapshot(), f.w.value);
        const data = {
          name: f.name.value.trim(),
          kind: f.kind.value,
          institutionId: f.institutionId.value,
          amount: Math.abs(readMoney(f.amount)),
          n,
          paidBefore: k,
          day: Math.min(31, Math.max(1, Number(f.day.value))),
          startMonth: f.startMonth.value,
          billId: f.billId.value,
          categoryId: f.categoryId.value,
          source: w.ref,
          sourceVia: w.via || '',
          method: f.method.value,
          openingDate: p.openingDate || td,
        };
        if (!data.amount) return toast('Informe o valor da parcela.');
        await store.save('plan', data, id);
        close();
        toast('Parcelamento salvo');
      };
    },
  });
}
