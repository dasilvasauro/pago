import * as store from '../core/store.js';
import { obligations, dueAmount, planStatus, paidKeys, PLAN_KINDS, planMonthOf, lateBills, balances, cardInfo, walletName, occId, occMap } from '../core/domain.js';
import { today } from '../lib/clock.js';
import { esc, money, ymOf, addMonths, fmtMonth, fmtMonthShort, relDay, sum, fmtDay, clampDay } from '../lib/util.js';
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
    <header class="block-head"><h3>Calendário do mês</h3>${tip('Toque em Pagar ou Receber para registrar no diário, com valor, conta e categoria preenchidos. Toque no nome de uma conta recorrente para ajustar o valor ou a data só daquele mês, antes de pagar.')}</header>
    ${
      obs.length
        ? `<ul class="ob-list">${obs
            .map((o) => {
              const late = !o.paid && o.date < td;
              const state = o.reneg ? `<span class="pill">${icon('swap')}Renegociada</span>` : o.paid ? `<span class="pill ok">${icon('check')}${o.dir === 'in' ? 'Recebido' : 'Pago'}</span>` : late ? `<span class="pill late">Atrasado</span>` : `<span class="pill">${relDay(o.date, td)}</span>`;
              return `<li class="${o.paid ? 'done' : ''}">
                <div class="ob-date"><b>${o.date.slice(8)}</b><span>${fmtDay(o.date).split(' ')[1]}</span></div>
                <div class="ob-main">${o.kind === 'bill' && !o.paid ? `<button type="button" class="ob-title" data-occ="${esc(o.id)}" aria-label="Ajustar ${esc(o.title)} deste mês">${esc(o.title)}${icon('edit', 'sm')}</button>` : `<b>${esc(o.title)}</b>`}
                  ${o.parts.length > 1 ? `<span>${o.parts.map((p) => `${esc(p.label)} ${money(p.amount)}`).join(' + ')}</span>` : o.kind === 'invoice' ? `<span>${o.partial ? `Pago ${money(o.amount - o.remaining)} de ${money(o.amount)}` : 'Fatura do cartão'}</span>` : o.kind === 'plan' ? `<span>${esc(o.parts[0].label)}</span>` : o.src.variable ? '<span>Valor variável</span>' : ''}
                  <span class="ob-pills">${state}${o.edited ? '<span class="pill">Ajustado</span>' : ''}</span>
                </div>
                <div class="ob-side"><span class="amt ${o.dir === 'in' ? 'pos' : ''}">${money(o.kind === 'invoice' && !o.paid ? o.remaining : o.amount)}</span>
                  ${o.reneg ? '' : `<button type="button" class="btn small ${o.paid ? 'ghost' : ''}" data-ob="${esc(o.id)}">${o.paid ? 'Ver' : o.dir === 'in' ? 'Receber' : 'Pagar'}</button>`}</div>
              </li>`;
            })
            .join('')}</ul>`
        : `<p class="empty">Nenhum compromisso neste mês. Cadastre contas fixas e parcelamentos abaixo.</p>`
    }
    ${(() => {
      const skipped = S.occ.filter((x) => x.month === month && x.skip && S.byId.get(x.billId));
      return skipped.length
        ? `<ul class="ob-list skipped">${skipped
            .map((x) => `<li><div class="ob-date"><b>—</b></div><div class="ob-main"><b>${esc(S.byId.get(x.billId).name)}</b><span>Sem cobrança neste mês</span></div><div class="ob-side"><button type="button" class="btn small ghost" data-unskip="${x.id}">Desfazer</button></div></li>`)
            .join('')}</ul>`
        : '';
    })()}
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
      <header class="block-head"><h3>Parcelamentos e acordos</h3>${tip('Renegociações, empréstimos, financiamentos e contas parceladas (como um débito de gás em 5x). As parcelas restantes entram na dívida total. Vincule a uma conta recorrente para que a parcela venha somada ao valor mensal. Para transformar contas atrasadas, cheque especial ou cartão em um acordo, use Renegociar.')}<div class="head-actions"><button type="button" class="btn small ghost" data-reneg>${icon('swap')}Renegociar</button><button type="button" class="btn small" data-new-plan>${icon('plus')}Novo</button></div></header>
      ${
        S.plan.length
          ? `<ul class="rows">${S.plan
              .map((p) => {
                const st = planStatus(p, paid);
                return `<li><button type="button" data-plan="${p.id}" class="row-btn">
                  <span class="row-main"><b>${esc(p.name)}</b><span>${p.down ? (st.downOpen ? 'Entrada pendente, ' : 'Entrada paga, ') : ''}${st.paid}/${p.n} pagas, restam ${money(st.remaining)}${st.remainingN ? `, termina em ${fmtMonthShort(planMonthOf(p, p.n))}` : ''}</span>
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
  el.querySelectorAll('[data-occ]').forEach((b) => b.addEventListener('click', () => openOccurrence(byId.get(b.dataset.occ))));
  el.querySelectorAll('[data-unskip]').forEach((b) =>
    b.addEventListener('click', async () => {
      await store.remove(b.dataset.unskip);
      toast('Cobrança restaurada');
    }),
  );
  el.querySelector('[data-new-bill]').addEventListener('click', () => openBill());
  el.querySelector('[data-new-plan]').addEventListener('click', () => openPlan());
  el.querySelector('[data-reneg]').addEventListener('click', () => openRenegotiate());
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

// extra (opcional): { sources, original, name } vindo de Renegociar.
export function openPlan(id, extra = null) {
  const S = store.snapshot();
  const td = today();
  const p = id
    ? S.byId.get(id)
    : { kind: 'acordo', amount: 0, n: 12, paidBefore: 0, startMonth: addMonths(ymOf(td), extra ? 1 : 0), day: 10, down: 0, downDate: td, name: extra?.name || '' };
  const covered = (p.covers || []).length;
  sheet({
    title: id ? 'Editar parcelamento' : extra ? 'Condições do acordo' : 'Novo parcelamento ou acordo',
    body: `<form class="form" data-f>
      ${extra ? `<div class="reneg-box"><span>Renegociando</span><b>${money(extra.original)}</b><small>${esc(extra.sources.map((x) => x.label).join(', '))}</small></div>` : ''}
      ${p.origin ? `<p class="form-meta">Acordo que renegociou ${money(p.origin)}${covered ? ` (${covered} ${covered === 1 ? 'conta atrasada' : 'contas atrasadas'})` : ''}.</p>` : ''}
      <label class="field"><span>Nome</span><input name="name" value="${esc(p.name || '')}" required maxlength="50" placeholder="Ex.: Acordo conta de luz"></label>
      <div class="grid2">
        ${field('Tipo', `<select name="kind">${Object.entries(PLAN_KINDS).map(([k, l]) => opt(k, l, k === p.kind)).join('')}</select>`)}
        ${field('Instituição', `<select name="institutionId"><option value="">Nenhuma</option>${S.inst.map((i) => opt(i.id, i.name, i.id === p.institutionId)).join('')}</select>`)}
      </div>
      <div class="grid2">
        <div><span class="field-label">Entrada ${tip('Valor pago de início, se o acordo tiver. Fica como um compromisso próprio na data informada. Deixe zero se não houver.')}</span>${moneyInput('down', p.down || 0)}</div>
        ${field('Data da entrada', `<input name="downDate" type="date" value="${p.downDate || td}">`)}
      </div>
      <span class="field-label">Valor de cada parcela</span>
      ${moneyInput('amount', p.amount, { big: true })}
      <div class="grid3">
        <label class="field"><span>Parcelas</span><input name="n" type="number" min="1" max="600" value="${p.n}" required inputmode="numeric"></label>
        <label class="field"><span>Já pagas</span><input name="paidBefore" type="number" min="0" value="${p.paidBefore || 0}" required inputmode="numeric"></label>
        <label class="field"><span>Dia</span><input name="day" type="number" min="1" max="31" value="${p.day}" required inputmode="numeric"></label>
      </div>
      ${field(extra ? 'Primeira parcela em' : 'Próxima parcela em', `<input name="startMonth" type="month" value="${p.startMonth}" required>`, 'Mês da primeira parcela ainda não paga. A entrada não conta como parcela.')}
      ${field('Somar a uma conta recorrente', `<select name="billId"><option value="">Não, cobrança separada</option>${S.bill.filter((b) => b.dir !== 'in').map((b) => opt(b.id, b.name, b.id === p.billId)).join('')}</select>`, 'Use quando a parcela vem junto com a conta do mês, como um acordo de luz cobrado na própria fatura de luz.')}
      <div class="grid2">
        ${field('Paga com', `<select name="w">${walletOptions(S, 'out', encodeWallet(p.source, p.sourceVia))}</select>`)}
        ${field('Categoria', `<select name="categoryId">${catOpts(S, 'saida', p.categoryId || S.cat.find((c) => c.kind === 'saida' && c.name === 'Dívidas e acordos')?.id)}</select>`)}
      </div>
      ${methodSelect(p.method)}
      <p class="form-meta" data-calc></p>
      <div class="sheet-actions">${id ? `<button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Excluir</button>` : '<span></span>'}<button class="btn primary">${extra ? 'Criar acordo' : 'Salvar'}</button></div>
    </form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      const calc = () => {
        const n = Number(f.n.value) || 0;
        const k = Number(f.paidBefore.value) || 0;
        const a = Math.abs(readMoney(f.amount));
        const down = Math.abs(readMoney(f.down));
        const rest = Math.max(0, n - k);
        const total = rest * a + down;
        let txt = rest && a && f.startMonth.value ? `${down ? `Entrada de ${money(down)} + ` : ''}${rest} ${rest === 1 ? 'parcela' : 'parcelas'} de ${money(a)}: ${money(total)} no total. Última em ${fmtMonthShort(addMonths(f.startMonth.value, rest - 1))}.` : '';
        const orig = extra?.original ?? p.origin;
        if (txt && orig) {
          const diff = total - orig;
          txt += diff > 0 ? ` São ${money(diff)} a mais que o valor original (juros e encargos).` : diff < 0 ? ` Desconto de ${money(-diff)} sobre o valor original.` : ' Sem juros sobre o valor original.';
        }
        el.querySelector('[data-calc]').textContent = txt;
      };
      ['n', 'paidBefore', 'startMonth'].forEach((k) => f[k].addEventListener('input', calc));
      f.amount.addEventListener('money', calc);
      f.down.addEventListener('money', calc);
      calc();
      el.querySelector('[data-del]')?.addEventListener('click', async () => {
        const S2 = store.snapshot();
        const linked = S2.tx.filter((t) => t.planId === id && t.type === 'ajuste');
        const msg = linked.length || p.covers?.length
          ? 'Excluir este acordo? Os saldos e contas que ele renegociou voltam a aparecer como estavam. Pagamentos já registrados continuam no diário.'
          : 'Excluir este parcelamento? Ele deixa de contar na dívida. Pagamentos já registrados continuam no diário.';
        if (!(await confirmDialog(msg, { ok: 'Excluir', danger: true }))) return;
        for (const t of linked) {
          await store.remove(t.id);
          const acc = t.to?.k === 'a' ? S2.byId.get(t.to.id) : null;
          if (acc?.kind === 'divida' && acc.archived) await store.save('acct', { ...acc, archived: false }, acc.id);
        }
        await store.remove(id);
        close();
        toast('Excluído');
      });
      f.onsubmit = async (e) => {
        e.preventDefault();
        const n = Number(f.n.value);
        const k = Number(f.paidBefore.value);
        if (k > n) return toast('Parcelas pagas não podem passar do total.');
        const S2 = store.snapshot();
        const w = decodeWallet(S2, f.w.value);
        const down = Math.abs(readMoney(f.down));
        const data = {
          name: f.name.value.trim(),
          kind: f.kind.value,
          institutionId: f.institutionId.value,
          amount: Math.abs(readMoney(f.amount)),
          n,
          paidBefore: k,
          day: Math.min(31, Math.max(1, Number(f.day.value))),
          startMonth: f.startMonth.value,
          down,
          downDate: down ? f.downDate.value || td : '',
          billId: f.billId.value,
          categoryId: f.categoryId.value,
          source: w.ref,
          sourceVia: w.via || '',
          method: f.method.value,
          openingDate: p.openingDate || td,
          covers: p.covers || [],
          origin: p.origin || 0,
        };
        if (!data.amount) return toast('Informe o valor da parcela.');
        if (extra) {
          data.covers = extra.sources.filter((x) => x.type === 'ob').map((x) => x.key);
          data.origin = extra.original;
        }
        const pid = await store.save('plan', data, id);
        if (extra) {
          // Saldos renegociados saem de onde estavam: o acordo passa a representar essa dívida.
          for (const x of extra.sources) {
            const desc = `Renegociado em ${data.name}`;
            if (x.type === 'acct') {
              await store.save('tx', { type: 'ajuste', amount: x.amount, date: data.openingDate, to: { k: 'a', id: x.id }, desc, planId: pid });
              const acc = S2.byId.get(x.id);
              if (acc?.kind === 'divida') await store.save('acct', { ...acc, archived: true }, acc.id);
            } else if (x.type === 'card') {
              await store.save('tx', { type: 'ajuste', amount: -x.amount, date: data.openingDate, to: { k: 'c', id: x.id }, desc, planId: pid });
            }
          }
        }
        close();
        toast(extra ? 'Acordo criado' : 'Parcelamento salvo');
      };
    },
  });
}

/* ---------- Renegociar ----------
   Junta o que está sendo renegociado (contas atrasadas, saldo negativo, fatura, dívida avulsa ou um
   valor informado) e abre as condições do acordo. Ao criar o acordo:
   - contas atrasadas ficam marcadas como renegociadas (deixam de contar como atraso);
   - saldos de contas, cartões e dívidas avulsas são zerados por um ajuste ligado ao acordo;
   - a dívida total passa a ser a do acordo; a diferença aparece como juros ou desconto. */
export function openRenegotiate(pre = {}) {
  const S = store.snapshot();
  const td = today();
  const bal = balances(S, td);
  const late = lateBills(S, td);
  const accts = S.acct.filter((a) => !a.archived && (a.kind === 'corrente' || a.kind === 'poupanca' || a.kind === 'divida') && (bal.get('a:' + a.id) || 0) < 0);
  const cards = S.card.filter((c) => c.kind === 'credito' && !c.archived && (bal.get('c:' + c.id) || 0) > 0);
  const item = (type, id, label, sub, amount, checked) =>
    `<label class="reneg-item"><input type="checkbox" data-src="${type}" data-id="${esc(id)}" data-amount="${amount}" data-label="${esc(label)}"${checked ? ' checked' : ''}><span><b>${esc(label)}</b><small>${esc(sub)}</small></span><em>${money(amount)}</em></label>`;
  const lateHtml = late.map((x) => item('ob', x.key, `${x.bill.name} de ${fmtMonthShort(x.month)}`, `Venceu ${fmtDay(x.date)}`, x.amount, pre.keys?.includes(x.key))).join('');
  const balHtml = [
    ...accts.map((a) => item('acct', a.id, walletName(S, { k: 'a', id: a.id }), a.kind === 'divida' ? 'Dívida avulsa' : 'Saldo negativo (cheque especial)', -(bal.get('a:' + a.id) || 0), pre.acct === a.id)),
    ...cards.map((c) => item('card', c.id, c.name, 'Tudo o que está no cartão, inclusive parcelas futuras', bal.get('c:' + c.id) || 0, pre.card === c.id)),
  ].join('');
  sheet({
    title: 'Renegociar',
    body: `<form class="form" data-f>
      <p class="sheet-text">Marque o que entrou no acordo. Na próxima etapa você informa a entrada e as parcelas.</p>
      ${late.length ? `<div class="field"><span>Contas em atraso</span><div class="reneg-list">${lateHtml}</div></div>` : ''}
      ${balHtml ? `<div class="field"><span>Saldos devedores</span><div class="reneg-list">${balHtml}</div></div>` : ''}
      <div class="field"><span>Outro valor ${tip('Para dívidas que não estão no Pago, como contas que atrasaram antes de você começar a usar o app. Ex.: quatro contas de luz antigas somando R$ 820.')}</span>
        <input name="otherLabel" placeholder="Descrição (ex.: 4 contas de luz antigas)" maxlength="60">
        ${moneyInput('other', 0)}
      </div>
      <div class="reneg-total"><span>Valor original</span><b data-total>${money(0)}</b></div>
      <div class="sheet-actions"><span></span><button class="btn primary">Continuar</button></div>
    </form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      const collect = () => {
        const list = [...el.querySelectorAll('[data-src]:checked')].map((c) => ({ type: c.dataset.src, id: c.dataset.id, key: c.dataset.id, amount: Number(c.dataset.amount), label: c.dataset.label }));
        const other = Math.abs(readMoney(f.other));
        if (other) list.push({ type: 'manual', amount: other, label: f.otherLabel.value.trim() || 'Outro valor' });
        return list;
      };
      const total = () => {
        el.querySelector('[data-total]').textContent = money(collect().reduce((a, x) => a + x.amount, 0));
      };
      el.querySelectorAll('[data-src]').forEach((c) => c.addEventListener('change', total));
      f.other.addEventListener('money', total);
      total();
      f.onsubmit = (e) => {
        e.preventDefault();
        const sources = collect();
        if (!sources.length) return toast('Marque ao menos um item ou informe um valor.');
        const original = sources.reduce((a, x) => a + x.amount, 0);
        const first = sources[0];
        const name = first.type === 'ob' ? `Acordo ${first.label.split(' de ')[0].toLowerCase()}` : first.type === 'manual' ? 'Acordo' : `Acordo ${first.label}`;
        close();
        setTimeout(() => openPlan(null, { sources, original, name }), 240);
      };
    },
  });
}

/* ---------- Ajustar um mês de uma conta recorrente ----------
   Guarda um registro próprio para aquele mês (valor, data ou "sem cobrança"), sem mexer nos outros. */
export function openOccurrence(o) {
  const S = store.snapshot();
  const b = o.src;
  const id = occId(b.id, o.month);
  const cur = o.occ || {};
  const base = o.parts[0];
  const extra = o.parts.slice(1);
  const defDate = clampDay(o.month, b.day);
  sheet({
    title: `${b.name} de ${fmtMonth(o.month).toLowerCase()}`,
    body: `<form class="form" data-f>
      <p class="sheet-text">Vale só para este mês. Os outros meses continuam com ${money(b.amount)}${b.variable ? ' (estimado)' : ''}, dia ${b.day}.</p>
      <span class="field-label">${b.variable ? 'Valor da conta neste mês' : 'Valor neste mês'}</span>
      ${moneyInput('amount', base.amount, { big: true, autofocus: true })}
      ${extra.length ? `<ul class="parts">${extra.map((p) => `<li><span>${esc(p.label)} <small>vem junto, valor do parcelamento</small></span><span>${money(p.amount)}</span></li>`).join('')}</ul>` : ''}
      <label class="field"><span>Vencimento</span><input name="date" type="date" value="${o.date}" required></label>
      <label class="check"><input type="checkbox" name="skip"><span>Não haverá cobrança neste mês</span></label>
      <label class="check"><input type="checkbox" name="forward"><span>Usar este valor daqui em diante</span>${tip('Muda o valor padrão da conta a partir deste mês. Meses anteriores ainda não pagos mantêm o valor que tinham.')}</label>
      <div class="sheet-actions">${o.edited ? `<button type="button" class="btn ghost" data-reset>${icon('refresh')}Restaurar padrão</button>` : '<span></span>'}<button class="btn primary">Salvar</button></div>
    </form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      f.skip.addEventListener('change', () => {
        f.forward.disabled = f.skip.checked;
        if (f.skip.checked) f.forward.checked = false;
      });
      el.querySelector('[data-reset]')?.addEventListener('click', async () => {
        await store.remove(id);
        close();
        toast('Mês voltou ao valor padrão');
      });
      f.onsubmit = async (e) => {
        e.preventDefault();
        if (f.skip.checked) {
          await store.save('occ', { billId: b.id, month: o.month, skip: true }, id);
          close();
          return toast('Mês marcado sem cobrança');
        }
        const amount = Math.abs(readMoney(f.amount));
        const date = f.date.value !== defDate ? f.date.value : '';
        if (f.forward.checked) {
          // Congela os meses anteriores ainda não pagos com o valor antigo antes de mudar o padrão.
          const S2 = store.snapshot();
          const ov = occMap(S2);
          const unpaid = obligations(S2, b.startMonth, addMonths(o.month, -1), today()).filter((x) => x.kind === 'bill' && x.src.id === b.id && !x.paid);
          for (const x of unpaid) if (!ov.has(`${b.id}:${x.month}`)) await store.save('occ', { billId: b.id, month: x.month, amount: b.amount }, occId(b.id, x.month));
          await store.save('bill', { ...b, amount }, b.id);
          if (date) await store.save('occ', { billId: b.id, month: o.month, date }, id);
          else if (o.occ) await store.remove(id);
          close();
          return toast('Novo valor aplicado daqui em diante');
        }
        if (amount === (b.amount || 0) && !date) {
          if (o.occ) await store.remove(id);
        } else await store.save('occ', { billId: b.id, month: o.month, amount, ...(date ? { date } : {}) }, id);
        close();
        toast('Mês ajustado');
      };
    },
  });
}
