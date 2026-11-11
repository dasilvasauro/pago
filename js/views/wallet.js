import * as store from '../core/store.js';
import { balances, cardInfo, position, obligations, piggyInfo, payRefAt, cardDue, cardClose, cardRef, defaultClose, defaultDue, refByDueMonth, invMonth, ACCOUNT_KINDS, VOUCHER_KINDS, INVEST_KINDS } from '../core/domain.js';
import { today } from '../lib/clock.js';
import { esc, money, fmtDay, fmtMonth, fmtDate, fmtDateHuman, fmtMonthShort, addMonths, ymOf } from '../lib/util.js';
import { icon, tip, sheet, moneyInput, readMoney, opt, seg, field, toast, confirmDialog, colorPicker, COLORS, bindMoney } from '../ui/ui.js';
import { txRow, openTx, openPay, walletOptions } from './txform.js';
import { openRenegotiate } from './plan.js';
import { calcAdd } from '../ui/calc.js';
import { PRIORITY } from '../core/domain.js';

export const title = 'Carteira';

export function render(el) {
  const S = store.snapshot();
  const td = today();
  const bal = balances(S, td);
  const pos = position(S, td);
  const accts = S.acct.filter((a) => !a.archived);
  const cards = S.card.filter((c) => !c.archived);

  const acctRow = (a) => {
    const b = bal.get('a:' + a.id) || 0;
    if (a.kind === 'divida') {
      const inst = a.institutionId ? S.byId.get(a.institutionId)?.name : '';
      return `<li><button type="button" class="row-btn" data-acct="${a.id}"><span class="row-ic">${icon('bank')}</span>
        <span class="row-main"><b>${esc(a.name)}</b><span>${b < 0 ? 'Saldo devedor' : 'Quitada'}${inst ? `, ${esc(inst)}` : ''}</span></span>
        <span class="amt ${b < 0 ? 'neg' : ''}">${money(Math.max(0, -b))}</span></button></li>`;
    }
    const lim = a.overdraftLimit || 0;
    const sub =
      a.kind === 'corrente' && lim
        ? b < 0
          ? `${money(-b)} de ${money(lim)} do cheque especial`
          : `Cheque especial de ${money(lim)}`
        : a.kind === 'voucher'
          ? VOUCHER_KINDS[a.voucherKind] || 'Voucher'
          : a.kind === 'investimento'
            ? INVEST_KINDS[a.investKind] || 'Investimento'
            : ACCOUNT_KINDS[a.kind];
    return `<li><button type="button" class="row-btn" data-acct="${a.id}">
      <span class="row-ic">${icon(a.kind === 'investimento' ? 'chart' : a.kind === 'voucher' ? 'card' : 'wallet')}</span>
      <span class="row-main"><b>${esc(a.name)}</b><span>${esc(sub)}</span>
      ${a.kind === 'corrente' && lim && b < 0 ? `<span class="bar thin warn"><i style="width:${Math.min(100, (-b / lim) * 100)}%"></i></span>` : ''}</span>
      <span class="amt ${b < 0 ? 'neg' : ''}">${money(b)}</span></button></li>`;
  };
  const cardRow = (c) => {
    if (c.kind === 'debito') {
      const a = S.byId.get(c.accountId);
      return `<li><button type="button" class="row-btn" data-card="${c.id}"><span class="row-ic">${icon('card')}</span>
        <span class="row-main"><b>${esc(c.name)}</b><span>Débito${a ? ` na ${esc(a.name)}` : ''}</span></span><span class="amt muted">—</span></button></li>`;
    }
    const info = cardInfo(S, c, td, bal);
    const pct = c.limit ? Math.min(100, (Math.max(0, info.outstanding) / c.limit) * 100) : 0;
    const cur = info.current;
    return `<li><button type="button" class="row-btn" data-card="${c.id}"><span class="row-ic">${icon('card')}</span>
      <span class="row-main"><b>${esc(c.name)}</b><span>${cur ? `Fatura ${cur.status === 'aberta' ? 'aberta' : 'fechada'} ${money(cur.remaining)}, vence ${fmtDay(cur.due)}` : 'Sem fatura'}</span>
      <span class="bar thin ${pct > 85 ? 'warn' : ''}"><i style="width:${pct}%"></i></span><span>Disponível ${money(info.available)} de ${money(c.limit || 0)}</span></span>
      <span class="amt ${info.outstanding > 0 ? 'neg' : ''}">${money(info.outstanding)}</span></button></li>`;
  };

  const loose = accts.filter((a) => !a.institutionId && !['investimento', 'divida', 'cofrinho'].includes(a.kind));
  const piggies = accts.filter((a) => a.kind === 'cofrinho');
  const inv = accts.filter((a) => a.kind === 'investimento');
  const debts = accts.filter((a) => a.kind === 'divida');

  el.innerHTML = `
  <div class="kpis strip wrap5">
    <div><span>Disponível</span><b>${money(pos.liquid)}</b></div>
    <div><span>Cheque especial</span><b class="${pos.overdraft ? 'neg' : ''}">${money(pos.overdraft)}</b></div>
    <div><span>Cartões</span><b class="${pos.cards ? 'neg' : ''}">${money(pos.cards)}</b></div>
    ${pos.other ? `<div><span>Outras dívidas</span><b class="neg">${money(pos.other)}</b></div>` : ''}
    <div><span>Vouchers</span><b>${money(pos.vouchers)}</b></div>
    <div><span>Investido</span><b>${money(pos.invested)}</b></div>
    ${piggies.length ? `<div><span>Cofrinhos</span><b>${money(pos.savings)}</b></div>` : ''}
  </div>

  <section class="block">
    <header class="block-head"><h3>Instituições</h3>${tip('Bancos e emissores. Dentro de cada um ficam as contas e os cartões de débito e crédito.')}<button type="button" class="btn small" data-new-inst>${icon('plus')}Instituição</button></header>
    ${S.inst.length ? '' : `<p class="empty">Cadastre seu primeiro banco para adicionar contas e cartões.</p>`}
    ${S.inst
      .map((i) => {
        const ia = accts.filter((a) => a.institutionId === i.id && a.kind !== 'divida' && a.kind !== 'cofrinho');
        const ic = cards.filter((c) => c.institutionId === i.id);
        return `<article class="inst" style="--c:${i.color || COLORS[0]}">
          <header><button type="button" class="inst-name" data-inst="${i.id}"><i></i>${esc(i.name)}${icon('edit', 'sm')}</button>
            <div class="inst-actions"><button type="button" class="btn small ghost" data-add-acct="${i.id}">${icon('plus')}Conta</button><button type="button" class="btn small ghost" data-add-card="${i.id}">${icon('plus')}Cartão</button></div></header>
          ${ia.length || ic.length ? `<ul class="rows">${ia.map(acctRow).join('')}${ic.map(cardRow).join('')}</ul>` : `<p class="empty">Sem contas ou cartões.</p>`}
        </article>`;
      })
      .join('')}
  </section>

  <section class="block">
    <header class="block-head"><h3>Outras dívidas</h3>${tip('Saldos devedores sem parcelas definidas, como um cheque especial que o banco transferiu para uma conta à parte, ou uma dívida em atraso. Pagamentos são transferências para a dívida; juros entram em Atualizar saldo. Quando virar acordo com parcelas, use Renegociar.')}<button type="button" class="btn small" data-new-debt>${icon('plus')}Dívida</button></header>
    ${debts.length ? `<ul class="rows">${debts.map(acctRow).join('')}</ul>` : `<p class="empty">Nenhuma dívida avulsa.</p>`}
  </section>

  <div class="two-col">
    <section class="block">
      <header class="block-head"><h3>Dinheiro e vouchers</h3>${tip('Dinheiro em espécie e cartões de benefício (alimentação, refeição). Recargas entram como entrada no voucher; compras saem dele.')}<button type="button" class="btn small" data-add-acct="" data-kind="voucher">${icon('plus')}Adicionar</button></header>
      ${loose.length ? `<ul class="rows">${loose.map(acctRow).join('')}</ul>` : `<p class="empty">Nenhum cadastrado.</p>`}
    </section>
    <section class="block">
      <header class="block-head"><h3>Investimentos</h3>${tip('FGTS, poupança, CDB e outros. Use Atualizar saldo quando o valor mudar; isso não conta como entrada no mês.')}<button type="button" class="btn small" data-add-acct="" data-kind="investimento">${icon('plus')}Adicionar</button></header>
      ${inv.length ? `<ul class="rows">${inv.map(acctRow).join('')}</ul>` : `<p class="empty">Nenhum investimento registrado.</p>`}
    </section>
  </div>

  <section class="block">
    <header class="block-head"><h3>Cofrinhos</h3>${tip('Dinheiro guardado para um objetivo, numa instituição. Guardar e resgatar são transferências entre a conta e o cofrinho; rendimentos entram em Atualizar saldo.')}<button type="button" class="btn small" data-new-piggy>${icon('plus')}Cofrinho</button></header>
    ${
      piggies.length
        ? `<div class="piggies">${piggies
            .map((a) => {
              const g = piggyInfo(S, a, td, bal);
              const inst = S.byId.get(a.institutionId);
              return `<button type="button" class="piggy" data-piggy="${a.id}" style="--c:${inst?.color || COLORS[1]}">
                <span class="piggy-top"><b>${esc(a.name)}</b><span class="piggy-pct${g.done ? ' done' : ''}">${g.done ? 'Meta atingida' : `${Math.floor(g.pct)}%`}</span></span>
                <span class="piggy-inst"><i></i>${esc(inst?.name || 'Sem instituição')}</span>
                <span class="bar${g.done ? ' done' : ''}"><i style="width:${g.pct}%"></i></span>
                <span class="piggy-val"><b>${money(g.balance)}</b> de ${money(g.goal)}</span>
              </button>`;
            })
            .join('')}</div>`
        : `<p class="empty">Nenhum cofrinho. Crie um para acompanhar uma meta, como uma reserva de emergência.</p>`
    }
  </section>
  ${S.acct.some((a) => a.archived) || S.card.some((c) => c.archived) ? `<p class="foot-note">${S.acct.filter((a) => a.archived).length + S.card.filter((c) => c.archived).length} itens arquivados não aparecem aqui, mas continuam no histórico.</p>` : ''}`;

  el.querySelector('[data-new-inst]').addEventListener('click', () => openInst());
  el.querySelector('[data-new-debt]').addEventListener('click', () => openDebt());
  el.querySelector('[data-new-piggy]').addEventListener('click', () => openPiggy());
  el.querySelectorAll('[data-piggy]').forEach((b) => b.addEventListener('click', () => piggyDetail(b.dataset.piggy)));
  el.querySelectorAll('[data-inst]').forEach((b) => b.addEventListener('click', () => openInst(b.dataset.inst)));
  el.querySelectorAll('[data-add-acct]').forEach((b) => b.addEventListener('click', () => openAcct(null, { institutionId: b.dataset.addAcct, kind: b.dataset.kind })));
  el.querySelectorAll('[data-add-card]').forEach((b) => b.addEventListener('click', () => openCard(null, { institutionId: b.dataset.addCard })));
  el.querySelectorAll('[data-acct]').forEach((b) => b.addEventListener('click', () => acctDetail(b.dataset.acct)));
  el.querySelectorAll('[data-card]').forEach((b) => b.addEventListener('click', () => cardDetail(b.dataset.card)));
}

/* ---------- Instituição ---------- */
function openInst(id) {
  const S = store.snapshot();
  const i = id ? S.byId.get(id) : { color: COLORS[S.inst.length % COLORS.length] };
  sheet({
    title: id ? 'Editar instituição' : 'Nova instituição',
    body: `<form class="form" data-f>
      <label class="field"><span>Nome</span><input name="name" value="${esc(i.name || '')}" required maxlength="40" autofocus placeholder="Ex.: Banco do Brasil"></label>
      <div class="field"><span>Cor</span>${colorPicker('color', i.color)}</div>
      ${id ? '' : `<label class="check"><input type="checkbox" name="withAcct" checked><span>Criar uma conta corrente nesta instituição</span></label>`}
      <div class="sheet-actions">${id ? `<button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Excluir</button>` : '<span></span>'}<button class="btn primary">Salvar</button></div>
    </form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      el.querySelector('[data-del]')?.addEventListener('click', async () => {
        const S2 = store.snapshot();
        if (S2.acct.some((a) => a.institutionId === id) || S2.card.some((c) => c.institutionId === id)) return toast('Remova ou mova as contas e cartões desta instituição antes.');
        if (!(await confirmDialog('Excluir esta instituição?', { ok: 'Excluir', danger: true }))) return;
        await store.remove(id);
        close();
      });
      f.onsubmit = async (e) => {
        e.preventDefault();
        const color = f.querySelector('input[name=color]:checked')?.value || i.color;
        const nid = await store.save('inst', { name: f.name.value.trim(), color }, id);
        close();
        if (!id && f.withAcct?.checked) openAcct(null, { institutionId: nid, kind: 'corrente', name: 'Conta corrente' });
      };
    },
  });
}

/* ---------- Conta ---------- */
function openAcct(id, preset = {}) {
  const S = store.snapshot();
  if (id && S.byId.get(id)?.kind === 'divida') return openDebt(id);
  if (id && S.byId.get(id)?.kind === 'cofrinho') return openPiggy(id);
  const td = today();
  const a = id ? S.byId.get(id) : { kind: preset.kind || 'corrente', institutionId: preset.institutionId || '', name: preset.name || '', opening: 0, openingDate: td, overdraftLimit: 0 };
  let kind = a.kind;
  const dyn = () => `
    ${kind === 'corrente' ? field('Limite do cheque especial', moneyInput('overdraftLimit', a.overdraftLimit || 0), 'Quanto o banco deixa a conta ficar negativa. Serve para acompanhar o uso do limite.') : ''}
    ${kind === 'voucher' ? field('Tipo de voucher', `<select name="voucherKind">${Object.entries(VOUCHER_KINDS).map(([k, l]) => opt(k, l, k === a.voucherKind)).join('')}</select>`) : ''}
    ${kind === 'investimento' ? field('Tipo de investimento', `<select name="investKind">${Object.entries(INVEST_KINDS).map(([k, l]) => opt(k, l, k === a.investKind)).join('')}</select>`) : ''}`;
  const kinds = Object.entries(ACCOUNT_KINDS).filter(([k]) => k !== 'divida' && k !== 'cofrinho');
  sheet({
    title: id ? 'Editar conta' : 'Nova conta',
    body: `<form class="form" data-f>
      ${field('Tipo', `<select name="kind">${kinds.map(([k, l]) => opt(k, l, k === kind)).join('')}</select>`)}
      <label class="field"><span>Nome</span><input name="name" value="${esc(a.name)}" required maxlength="40" placeholder="Ex.: Conta salário"></label>
      ${field('Instituição', `<select name="institutionId"><option value="">Nenhuma</option>${S.inst.map((i) => opt(i.id, i.name, i.id === a.institutionId)).join('')}</select>`)}
      <span class="field-label">Saldo ${id ? 'inicial' : 'atual'} ${tip('Use ± para saldo negativo. Uma conta negativa já é a dívida de cheque especial: não precisa cadastrar em outro lugar.')}</span>
      ${moneyInput('opening', a.opening, { big: true, allowNeg: true })}
      ${field('Saldo no início do dia', `<input name="openingDate" type="date" value="${a.openingDate}" required>`, 'Lançamentos a partir desta data alteram o saldo. Lançamentos anteriores ficam só como histórico.')}
      <div data-dyn>${dyn()}</div>
      <div class="sheet-actions">${id ? `<button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Excluir</button>` : '<span></span>'}<button class="btn primary">Salvar</button></div>
    </form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      f.kind.addEventListener('change', () => {
        kind = f.kind.value;
        el.querySelector('[data-dyn]').innerHTML = dyn();
        bindMoney(el);
      });
      el.querySelector('[data-del]')?.addEventListener('click', () => removeWallet(id, 'a', close));
      f.onsubmit = async (e) => {
        e.preventDefault();
        const data = {
          kind,
          name: f.name.value.trim(),
          institutionId: f.institutionId.value,
          opening: readMoney(f.opening),
          openingDate: f.openingDate.value,
          overdraftLimit: f.overdraftLimit ? Math.abs(readMoney(f.overdraftLimit)) : 0,
          voucherKind: f.voucherKind?.value || '',
          investKind: f.investKind?.value || '',
          archived: !!a.archived,
        };
        await store.save('acct', data, id);
        close();
        toast('Conta salva');
      };
    },
  });
}

async function removeWallet(id, k, close) {
  const S = store.snapshot();
  const used = S.tx.some((t) => (t.from?.id === id || t.to?.id === id || t.via === id)) || S.card.some((c) => c.accountId === id);
  const item = S.byId.get(id);
  if (used) {
    if (!(await confirmDialog(`"${item.name}" tem lançamentos no histórico. Ela será arquivada: some da Carteira e das listas, mas o histórico e os saldos passados continuam corretos.`, { ok: 'Arquivar' }))) return;
    await store.save(k === 'a' ? 'acct' : 'card', { ...item, archived: true }, id);
  } else {
    if (!(await confirmDialog(`Excluir "${item.name}"?`, { ok: 'Excluir', danger: true }))) return;
    await store.remove(id);
  }
  close();
}

function acctDetail(id) {
  const S = store.snapshot();
  const a = S.byId.get(id);
  if (a.kind === 'cofrinho') return piggyDetail(id);
  const b = balances(S, today()).get('a:' + id) || 0;
  const isDebt = a.kind === 'divida';
  const canReneg = b < 0 && (isDebt || a.kind === 'corrente' || a.kind === 'poupanca');
  const txs = S.tx.filter((t) => t.from?.id === id || t.to?.id === id).slice(-20).reverse();
  sheet({
    title: a.name,
    wide: true,
    body: `<div class="detail-top">${
      isDebt
        ? `<div><span>Saldo devedor</span><b class="${b < 0 ? 'neg' : ''}">${money(Math.max(0, -b))}</b></div>`
        : `<div><span>Saldo</span><b class="${b < 0 ? 'neg' : ''}">${money(b)}</b></div>
      ${a.kind === 'corrente' && a.overdraftLimit ? `<div><span>Disponível com cheque especial</span><b>${money(b + a.overdraftLimit)}</b></div>` : ''}`
    }</div>
      <div class="detail-actions">
        ${isDebt && b < 0 ? `<button type="button" class="btn primary" data-paydebt>Pagar</button>` : ''}
        ${canReneg ? `<button type="button" class="btn" data-reneg>${icon('swap')}Renegociar</button>` : ''}
        <button type="button" class="btn${isDebt ? ' ghost' : ''}" data-adjust>${icon('refresh')}${a.kind === 'investimento' || a.kind === 'cofrinho' || isDebt ? 'Atualizar saldo' : 'Ajustar saldo'}</button>
        <button type="button" class="btn ghost" data-edit>${icon('edit')}Editar</button>
        <button type="button" class="btn ghost" data-calc>${icon('calc')}Calculadora</button>
        <button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Remover</button>
      </div>
      <h4 class="sub">Últimos lançamentos</h4>
      ${txs.length ? txs.map((t) => txRow(S, t, { showDate: true })).join('') : `<p class="empty">Nenhum lançamento nesta conta.</p>`}`,
    onMount(el, close) {
      el.querySelector('[data-edit]').onclick = () => {
        close();
        isDebt ? openDebt(id) : openAcct(id);
      };
      el.querySelector('[data-del]').onclick = () => removeWallet(id, 'a', close);
      el.querySelector('[data-adjust]').onclick = () => adjust(id, b);
      el.querySelector('[data-calc]').onclick = () => calcAdd({ label: isDebt ? `${a.name} (devido)` : `Saldo ${a.name}`, v: isDebt ? Math.max(0, -b) : b });
      el.querySelector('[data-paydebt]')?.addEventListener('click', () => {
        close();
        openTx({ type: 'transf', toV: `a:${id}`, desc: `Pagamento ${a.name}` });
      });
      el.querySelector('[data-reneg]')?.addEventListener('click', () => {
        close();
        openRenegotiate({ acct: id });
      });
      el.querySelectorAll('[data-tx]').forEach((x) => (x.onclick = () => openTx({ id: x.dataset.tx })));
    },
  });
}

function adjust(id, current) {
  const S = store.snapshot();
  const a = S.byId.get(id);
  const isDebt = a.kind === 'divida';
  const shown = isDebt ? Math.max(0, -current) : current;
  sheet({
    title: a.kind === 'investimento' || a.kind === 'cofrinho' || isDebt ? 'Atualizar saldo' : 'Ajustar saldo',
    body: `<form class="form" data-f>
      <p class="sheet-text">${
        isDebt
          ? `Devido no Pago: <b>${money(shown)}</b>. Informe quanto a dívida está hoje (com juros e encargos). A diferença vira um ajuste e não conta como saída do mês.`
          : `Saldo no Pago: <b>${money(current)}</b>. Informe o saldo real; a diferença vira um ajuste${a.kind === 'investimento' ? ' (rendimento, depósito de FGTS etc.)' : a.kind === 'cofrinho' ? ' (rendimento), que não conta como depósito' : ''} e não conta como entrada ou saída do mês.`
      }</p>
      ${moneyInput('v', shown, { big: true, allowNeg: !isDebt, autofocus: true })}
      <label class="field"><span>Data</span><input name="date" type="date" value="${today()}" required></label>
      <div class="sheet-actions"><span></span><button class="btn primary">Salvar ajuste</button></div></form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      f.onsubmit = async (e) => {
        e.preventDefault();
        const target = isDebt ? -Math.abs(readMoney(f.v)) : readMoney(f.v);
        const delta = target - current;
        if (!delta) return close();
        await store.save('tx', { type: 'ajuste', amount: delta, date: f.date.value, to: { k: 'a', id }, desc: isDebt ? 'Atualização da dívida' : a.kind === 'investimento' ? 'Atualização de saldo' : 'Ajuste de saldo' });
        close();
        toast(isDebt ? 'Dívida atualizada' : 'Saldo ajustado');
      };
    },
  });
}

/* ---------- Outras dívidas ----------
   Uma dívida avulsa é uma conta do tipo "dívida" com saldo negativo. Quando o banco tira o
   cheque especial da conta e o coloca numa dívida à parte, isso é uma transferência da dívida
   para a conta: a conta volta a zero e a dívida total não muda. */
function openDebt(id) {
  const S = store.snapshot();
  const td = today();
  const a = id ? S.byId.get(id) : null;
  const bal = balances(S, td);
  const negatives = S.acct.filter((x) => !x.archived && (x.kind === 'corrente' || x.kind === 'poupanca') && (bal.get('a:' + x.id) || 0) < 0);
  let origin = negatives.length ? 'conta' : 'valor';
  const dyn = () =>
    origin === 'conta'
      ? `${field('Conta que estava negativa', `<select name="src">${negatives.length ? negatives.map((x) => opt(x.id, `${x.name}${x.institutionId ? ' ' + (S.byId.get(x.institutionId)?.name || '') : ''} (${money(bal.get('a:' + x.id))})`, false)).join('') : '<option value="">Nenhuma conta negativa</option>'}</select>`, 'A conta volta a zero e o valor passa para esta dívida. A dívida total não muda.')}
         <span class="field-label">Valor transferido</span>${moneyInput('amount', negatives[0] ? -(bal.get('a:' + negatives[0].id) || 0) : 0, { big: true })}`
      : `<span class="field-label">Valor devido</span>${moneyInput('amount', 0, { big: true })}`;
  sheet({
    title: id ? 'Editar dívida' : 'Nova dívida',
    body: `<form class="form" data-f>
      <label class="field"><span>Nome</span><input name="name" value="${esc(a?.name || '')}" required maxlength="40" placeholder="Ex.: Dívida cheque especial"></label>
      ${field('Instituição', `<select name="institutionId"><option value="">Nenhuma</option>${S.inst.map((i) => opt(i.id, i.name, i.id === a?.institutionId)).join('')}</select>`)}
      ${id ? '' : `${seg('origin', [['conta', 'Veio de uma conta negativa'], ['valor', 'Informar valor']], origin)}
        <div data-dyn>${dyn()}</div>
        <label class="field"><span>Data</span><input name="date" type="date" value="${td}" required></label>`}
      <div class="sheet-actions">${id ? `<button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Excluir</button>` : '<span></span>'}<button class="btn primary">Salvar</button></div>
    </form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      const wireSrc = () =>
        f.src?.addEventListener('change', () => {
          const v = -(bal.get('a:' + f.src.value) || 0);
          f.amount.value = (Math.max(0, v) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        });
      wireSrc();
      f.querySelectorAll('input[name=origin]').forEach((r) =>
        r.addEventListener('change', () => {
          origin = r.value;
          el.querySelector('[data-dyn]').innerHTML = dyn();
          bindMoney(el);
          wireSrc();
        }),
      );
      el.querySelector('[data-del]')?.addEventListener('click', () => removeWallet(id, 'a', close));
      f.onsubmit = async (e) => {
        e.preventDefault();
        if (id) {
          await store.save('acct', { ...a, name: f.name.value.trim(), institutionId: f.institutionId.value }, id);
          close();
          return toast('Dívida salva');
        }
        const amount = Math.abs(readMoney(f.amount));
        if (!amount) return toast('Informe o valor.');
        if (origin === 'conta' && !f.src.value) return toast('Escolha a conta.');
        const date = f.date.value;
        const nid = await store.save('acct', { kind: 'divida', name: f.name.value.trim(), institutionId: f.institutionId.value, opening: origin === 'valor' ? -amount : 0, openingDate: date, archived: false });
        if (origin === 'conta')
          await store.save('tx', { type: 'transf', amount, date, from: { k: 'a', id: nid }, to: { k: 'a', id: f.src.value }, desc: 'Saldo negativo transferido para dívida' });
        close();
        toast('Dívida registrada');
      };
    },
  });
}

/* ---------- Cofrinhos ---------- */
function openPiggy(id) {
  const S = store.snapshot();
  const td = today();
  const a = id ? S.byId.get(id) : { name: '', institutionId: S.inst[0]?.id || '', goal: 0, opening: 0, openingDate: td, targetDate: '' };
  if (!S.inst.length) return toast('Cadastre antes a instituição onde o cofrinho fica.');
  sheet({
    title: id ? 'Editar cofrinho' : 'Novo cofrinho',
    body: `<form class="form" data-f>
      <label class="field"><span>Nome do objetivo</span><input name="name" value="${esc(a.name)}" required maxlength="40" placeholder="Ex.: Reserva de emergência"></label>
      ${field('Instituição', `<select name="institutionId">${S.inst.map((i) => opt(i.id, i.name, i.id === a.institutionId)).join('')}</select>`, 'Onde o dinheiro do cofrinho fica guardado.')}
      <span class="field-label">Meta</span>
      ${moneyInput('goal', a.goal || 0, { big: true })}
      ${field('Data para atingir', `<input name="targetDate" type="date" value="${a.targetDate || ''}">`, 'Opcional. Com uma data, o Pago mostra quanto guardar por mês para chegar lá.')}
      ${id ? '' : `<div class="grid2"><div><span class="field-label">Já guardado</span>${moneyInput('opening', 0)}</div>
        ${field('Valor em', `<input name="openingDate" type="date" value="${td}" required>`)}</div>`}
      <div class="sheet-actions">${id ? `<button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Excluir</button>` : '<span></span>'}<button class="btn primary">Salvar</button></div>
    </form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      el.querySelector('[data-del]')?.addEventListener('click', () => removeWallet(id, 'a', close));
      f.onsubmit = async (e) => {
        e.preventDefault();
        const goal = Math.abs(readMoney(f.goal));
        if (!goal) return toast('Defina a meta do cofrinho.');
        if (!f.institutionId.value) return toast('Escolha a instituição.');
        const data = id
          ? { ...a, name: f.name.value.trim(), institutionId: f.institutionId.value, goal, targetDate: f.targetDate.value }
          : { kind: 'cofrinho', name: f.name.value.trim(), institutionId: f.institutionId.value, goal, targetDate: f.targetDate.value, opening: Math.abs(readMoney(f.opening)), openingDate: f.openingDate.value, archived: false };
        await store.save('acct', data, id);
        close();
        toast('Cofrinho salvo');
      };
    },
  });
}

function piggyDetail(id) {
  const S = store.snapshot();
  const td = today();
  const a = S.byId.get(id);
  const g = piggyInfo(S, a, td);
  const inst = S.byId.get(a.institutionId);
  const idle =
    g.daysWithout === 0
      ? g.lastDeposit
        ? 'Recebeu um depósito hoje.'
        : 'Criado hoje.'
      : `Há ${g.daysWithout} ${g.daysWithout === 1 ? 'dia' : 'dias'} sem receber nenhum valor${g.lastDeposit ? `. Último depósito em ${fmtDateHuman(g.lastDeposit)}` : ', desde a criação'}.`;
  const txs = S.tx.filter((t) => t.from?.id === id || t.to?.id === id).slice(-15).reverse();
  sheet({
    title: a.name,
    wide: true,
    body: `<div class="piggy-detail" style="--c:${inst?.color || COLORS[1]}">
        <div class="ring" style="--p:${g.pct}" role="img" aria-label="${Math.floor(g.pct)}% da meta"><span><b>${Math.floor(g.pct)}%</b><small>da meta</small></span></div>
        <div class="piggy-nums">
          <div><span>Guardado</span><b>${money(g.balance)}</b></div>
          <div><span>Meta</span><b>${money(g.goal)}</b></div>
          <div><span>${g.done ? 'Acima da meta' : 'Falta'}</span><b>${money(g.done ? g.balance - g.goal : g.remaining)}</b></div>
        </div>
      </div>
      <p class="idle ${g.daysWithout >= 30 ? 'warn' : ''}">${icon('plan')}<span>${esc(idle)}</span></p>
      ${a.targetDate ? `<p class="form-meta">${g.done ? `Meta atingida antes de ${fmtDateHuman(a.targetDate)}.` : g.monthsLeft < 0 ? `A data para atingir (${fmtDateHuman(a.targetDate)}) já passou.` : `Para chegar até ${fmtDateHuman(a.targetDate)}, guarde ${money(g.perMonth)} por mês.`}</p>` : ''}
      <p class="form-meta">${esc(inst?.name || 'Sem instituição')}</p>
      <div class="detail-actions">
        <button type="button" class="btn primary" data-in>${icon('in')}Guardar</button>
        <button type="button" class="btn" data-out ${g.balance ? '' : 'disabled'}>${icon('out')}Resgatar</button>
        <button type="button" class="btn ghost" data-adjust>${icon('refresh')}Atualizar saldo</button>
        <button type="button" class="btn ghost" data-edit>${icon('edit')}Editar</button>
      </div>
      <h4 class="sub">Movimentações</h4>
      ${txs.length ? txs.map((t) => txRow(S, t, { showDate: true })).join('') : `<p class="empty">Nenhuma movimentação ainda.</p>`}`,
    onMount(el, close) {
      el.querySelector('[data-in]').onclick = () => {
        close();
        openTx({ type: 'transf', toV: `a:${id}`, desc: `Guardar em ${a.name}` });
      };
      el.querySelector('[data-out]').onclick = () => {
        close();
        openTx({ type: 'transf', fromV: `a:${id}`, desc: `Resgate de ${a.name}` });
      };
      el.querySelector('[data-adjust]').onclick = () => adjust(id, g.balance);
      el.querySelector('[data-edit]').onclick = () => {
        close();
        openPiggy(id);
      };
      el.querySelectorAll('[data-tx]').forEach((x) => (x.onclick = () => openTx({ id: x.dataset.tx })));
    },
  });
}

/* ---------- Cartão ---------- */
function openCard(id, preset = {}) {
  const S = store.snapshot();
  const td = today();
  const c = id ? S.byId.get(id) : { kind: 'credito', institutionId: preset.institutionId || '', name: '', limit: 0, closingDay: 1, dueDay: 10, openInv: 0, openRest: 0, openRestN: 1, openingDate: td };
  let kind = c.kind;
  const accts = S.acct.filter((a) => !a.archived && (a.kind === 'corrente' || a.kind === 'poupanca'));
  const dyn = () =>
    kind === 'debito'
      ? field('Conta vinculada', `<select name="accountId" required><option value="">Selecionar</option>${accts.map((a) => opt(a.id, a.name, a.id === c.accountId || (!c.accountId && a.institutionId === c.institutionId))).join('')}</select>`, 'Compras no débito saem desta conta.')
      : `${field('Limite', moneyInput('limit', c.limit || 0))}
        <div class="grid2">
          <label class="field"><span>Dia de fechamento ${tip('Dia em que a fatura fecha. Compras feitas a partir dele entram na fatura seguinte. Costuma ser de 7 a 10 dias antes do vencimento.')}</span><input name="closingDay" type="number" min="1" max="31" value="${c.closingDay}" required inputmode="numeric"></label>
          <label class="field"><span>Dia de vencimento ${tip('Se o vencimento for num dia menor que o do fechamento (ex.: fecha 28, vence 5), a fatura vence no mês seguinte ao fechamento. Para uma fatura com data diferente, ajuste no detalhe do cartão.')}</span><input name="dueDay" type="number" min="1" max="31" value="${c.dueDay}" required inputmode="numeric"></label>
        </div>
        <p class="form-meta" data-cardprev></p>
        <details class="hist"${c.prevAmount ? ' open' : ''}>
          <summary>Fatura anterior (paga ou paga em parte)</summary>
          <div class="hist-body">
            <p class="form-meta">Só para constar: não mexe no saldo das contas, porque o pagamento já aconteceu. Se foi paga em parte, o restante entra sozinho na fatura seguinte.</p>
            ${field('Vencimento da fatura anterior', `<input name="prevDue" type="date" value="${c.prevRef ? cardDue(c, c.prevRef) : defaultDue(c, addMonths(payRefAt(c, td), -1))}">`, 'Data em que ela venceu, como aparece na fatura do banco.')}
            <div class="grid2">
              <div><span class="field-label">Valor da fatura</span>${moneyInput('prevAmount', c.prevAmount || 0)}</div>
              <div><span class="field-label">Quanto foi pago</span>${moneyInput('prevPaid', c.prevPaid || 0)}</div>
            </div>
          </div>
        </details>
        <span class="field-label">Compras na fatura atual ${tip('Valor das compras da fatura que você vai pagar agora. Não inclua o saldo que veio da fatura anterior: ele é somado sozinho.')}</span>
        ${moneyInput('openInv', c.openInv || 0)}
        <p class="form-meta" data-cardsum></p>
        <div class="grid2">
          <div><span class="field-label">Parcelas futuras ${tip('Soma das parcelas que já estão programadas para as faturas seguintes.')}</span>${moneyInput('openRest', c.openRest || 0)}</div>
          <label class="field"><span>Em quantos meses</span><input name="openRestN" type="number" min="1" max="48" value="${c.openRestN || 1}" inputmode="numeric"></label>
        </div>
        ${field('Valores informados em', `<input name="openingDate" type="date" value="${c.openingDate}" required>`)}
        ${field('Prioridade da fatura', seg('priority', Object.entries(PRIORITY), c.priority || 'normal'), 'Orienta a Sugestão de pagamento. Um cartão usado para mercado e remédios pode ser essencial.')}`;
  sheet({
    title: id ? 'Editar cartão' : 'Novo cartão',
    body: `<form class="form" data-f>
      ${id ? '' : seg('kind', [['credito', 'Crédito'], ['debito', 'Débito']], kind)}
      <label class="field"><span>Nome</span><input name="name" value="${esc(c.name)}" required maxlength="40" placeholder="Ex.: Visa Platinum"></label>
      ${field('Instituição', `<select name="institutionId"><option value="">Nenhuma</option>${S.inst.map((i) => opt(i.id, i.name, i.id === c.institutionId)).join('')}</select>`)}
      <div data-dyn>${dyn()}</div>
      <div class="sheet-actions">${id ? `<button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Excluir</button>` : '<span></span>'}<button class="btn primary">Salvar</button></div>
    </form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      f.querySelectorAll('input[name=kind]').forEach((r) =>
        r.addEventListener('change', () => {
          kind = r.value;
          el.querySelector('[data-dyn]').innerHTML = dyn();
          bindMoney(el);
        }),
      );
      el.querySelector('[data-del]')?.addEventListener('click', () => removeWallet(id, 'c', close));
      // Resumo ao vivo: de onde vem o valor da fatura atual.
      const sumUp = () => {
        const out = el.querySelector('[data-cardsum]');
        if (!out || kind !== 'credito') return;
        const prevAmount = Math.abs(readMoney(f.prevAmount));
        const prevPaid = Math.min(prevAmount, Math.abs(readMoney(f.prevPaid)));
        const inv = Math.abs(readMoney(f.openInv));
        const cd = Number(f.closingDay.value) || 1;
        const dd = Number(f.dueDay.value) || 10;
        const tmp = { closingDay: cd, dueDay: dd, _inv: c._inv };
        const open = cardRef(tmp, td);
        el.querySelector('[data-cardprev]').textContent = `Com esses dias, a fatura aberta hoje fecha em ${fmtDate(cardClose(tmp, open))} e vence em ${fmtDate(cardDue(tmp, open))} (fatura de ${fmtMonth(invMonth(tmp, open)).toLowerCase()}).`;
        const prevDue = prevAmount && f.prevDue.value ? f.prevDue.value : null;
        const prevRef = prevDue ? refByDueMonth(tmp, ymOf(prevDue)) : null;
        let cur = payRefAt(tmp, f.openingDate.value || td);
        if (prevRef && cur <= prevRef) cur = addMonths(prevRef, 1);
        const carry = prevAmount ? prevAmount - prevPaid : 0;
        const name = `Fatura de ${fmtMonth(invMonth(tmp, cur)).toLowerCase()}`;
        out.textContent = prevAmount
          ? carry > 0
            ? `${name}, com vencimento em ${fmtDate(cardDue(tmp, cur))}: ${money(carry)} da fatura anterior + ${money(inv)} em compras = ${money(carry + inv)}.${prevDue >= td ? ` Até ${fmtDate(prevDue)} o restante ainda aparece na fatura anterior.` : ''}`
            : `Fatura anterior quitada. ${name}: ${money(inv)}.`
          : inv
            ? `${name}, com vencimento em ${fmtDate(cardDue(tmp, cur))}: ${money(inv)}.`
            : '';
      };
      // Enquanto o vencimento anterior não for escolhido à mão, ele acompanha os dias do cartão.
      let prevTouched = !!c.prevRef;
      const syncPrev = () => {
        if (prevTouched || !f.prevDue || kind !== 'credito') return;
        const tmp = { closingDay: Number(f.closingDay.value) || 1, dueDay: Number(f.dueDay.value) || 10 };
        f.prevDue.value = defaultDue(tmp, addMonths(payRefAt(tmp, f.openingDate.value || td), -1));
      };
      const wireSum = () => {
        prevTouched = !!c.prevRef;
        f.prevDue?.addEventListener('change', () => (prevTouched = true));
        ['closingDay', 'dueDay', 'openingDate'].forEach((k) => {
          f[k]?.addEventListener('input', syncPrev);
          f[k]?.addEventListener('change', syncPrev);
        });
        ['prevAmount', 'prevPaid', 'openInv'].forEach((k) => f[k]?.addEventListener('money', sumUp));
        ['prevDue', 'closingDay', 'dueDay', 'openingDate'].forEach((k) => {
          f[k]?.addEventListener('input', sumUp);
          f[k]?.addEventListener('change', sumUp);
        });
        sumUp();
      };
      wireSum();
      f.querySelectorAll('input[name=kind]').forEach((r) => r.addEventListener('change', () => setTimeout(wireSum, 0)));
      f.onsubmit = async (e) => {
        e.preventDefault();
        const data = { kind, name: f.name.value.trim(), institutionId: f.institutionId.value, archived: !!c.archived };
        if (kind === 'debito') {
          data.accountId = f.accountId.value;
          if (!data.accountId) return toast('Escolha a conta vinculada.');
        } else
          Object.assign(data, {
            limit: Math.abs(readMoney(f.limit)),
            closingDay: Number(f.closingDay.value),
            dueDay: Number(f.dueDay.value),
            openInv: Math.abs(readMoney(f.openInv)),
            openRest: Math.abs(readMoney(f.openRest)),
            openRestN: Number(f.openRestN.value) || 1,
            openingDate: f.openingDate.value,
            priority: f.querySelector('input[name=priority]:checked')?.value || 'normal',
          });
        if (kind === 'credito') {
          const prevAmount = Math.abs(readMoney(f.prevAmount));
          const prevPaid = Math.abs(readMoney(f.prevPaid));
          if (prevPaid > prevAmount) return toast('O valor pago não pode passar do valor da fatura.');
          if (prevAmount && !f.prevDue.value) return toast('Informe o vencimento da fatura anterior.');
          const prevRef = prevAmount ? refByDueMonth({ ...data, _inv: c._inv }, ymOf(f.prevDue.value)) : '';
          Object.assign(data, prevAmount ? { prevRef, prevAmount, prevPaid } : { prevRef: '', prevAmount: 0, prevPaid: 0 });
          data._prevDue = prevAmount ? f.prevDue.value : '';
        }
        const prevDueWanted = data._prevDue;
        delete data._prevDue;
        const cid = await store.save('card', data, id);
        // Vencimento informado diferente do padrão: fica como data ajustada daquela fatura.
        if (prevDueWanted && prevDueWanted !== defaultDue(data, data.prevRef)) {
          const oid = `ci_${cid}_${data.prevRef}`;
          const prev = store.get(oid);
          await store.save('cinv', { cardId: cid, ref: data.prevRef, close: prev?.close || '', due: prevDueWanted }, oid);
        }
        close();
        toast('Cartão salvo');
      };
    },
  });
}

const ST = { paga: 'Paga', aberta: 'Aberta', fechada: 'Fechada', vencida: 'Vencida', parcial: 'Paga em parte' };

function cardDetail(id) {
  const S = store.snapshot();
  const c = S.byId.get(id);
  if (c.kind === 'debito') return openCard(id);
  const td = today();
  const info = cardInfo(S, c, td);
  const invs = info.invoices.filter((i) => i.status !== 'paga').concat(info.invoices.filter((i) => i.status === 'paga').slice(-3)).sort((a, b) => b.ref.localeCompare(a.ref));
  sheet({
    title: c.name,
    wide: true,
    body: `<div class="detail-top">
        <div><span>Dívida no cartão</span><b class="${info.outstanding > 0 ? 'neg' : ''}">${money(info.outstanding)}</b></div>
        <div><span>Disponível</span><b>${money(info.available)}</b></div>
        <div><span>Fecha dia ${c.closingDay}, vence dia ${c.dueDay}</span><b>${money(c.limit || 0)}</b></div>
      </div>
      <div class="detail-actions">
        ${info.current && info.current.remaining > 0 ? `<button type="button" class="btn primary" data-pay>Pagar fatura</button>` : ''}
        ${info.outstanding > 0 ? `<button type="button" class="btn" data-reneg>${icon('swap')}Renegociar</button>` : ''}
        <button type="button" class="btn ghost" data-calc>${icon('calc')}Calculadora</button>
        <button type="button" class="btn ghost" data-edit>${icon('edit')}Editar</button>
        <button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Remover</button>
      </div>
      <h4 class="sub">Faturas</h4>
      ${invs.length ? `<ul class="inv-list">${invs.map((i) => `<li><button type="button" data-inv="${i.ref}"><span><b>${fmtMonth(invMonth(c, i.ref))}</b><small>Fecha ${fmtDay(i.close)}, vence ${fmtDate(i.due)}</small></span><span class="pill ${i.status === 'paga' ? 'ok' : i.status === 'vencida' ? 'late' : i.status === 'parcial' ? 'part' : ''}">${ST[i.status]}</span><span class="amt">${money(i.amount)}${i.carried ? `<small>${money(i.carried)} foi para a seguinte</small>` : i.paid && i.remaining ? `<small>falta ${money(i.remaining)}</small>` : ''}</span></button></li>`).join('')}</ul>` : `<p class="empty">Nenhuma fatura.</p>`}`,
    onMount(el, close) {
      el.querySelector('[data-edit]').onclick = () => {
        close();
        openCard(id);
      };
      el.querySelector('[data-del]').onclick = () => removeWallet(id, 'c', close);
      el.querySelector('[data-reneg]')?.addEventListener('click', () => {
        close();
        openRenegotiate({ card: id });
      });
      el.querySelector('[data-calc]').onclick = () =>
        info.current ? calcAdd({ label: `Fatura ${c.name} (${fmtMonthShort(ymOf(info.current.due))})`, v: info.current.remaining || info.current.amount }) : calcAdd({ label: `Dívida ${c.name}`, v: Math.max(0, info.outstanding) });
      el.querySelector('[data-pay]')?.addEventListener('click', () => {
        const ob = obligations(S, info.current.due.slice(0, 7), info.current.due.slice(0, 7), td).find((o) => o.id === `i:${id}:${info.current.ref}`);
        if (ob) openPay(ob);
      });
      el.querySelectorAll('[data-inv]').forEach(
        (b) =>
          (b.onclick = () =>
            invoiceItems(c, info.invoices.find((i) => i.ref === b.dataset.inv), () => {
              close();
              setTimeout(() => cardDetail(id), 240);
            })),
      );
    },
  });
}

function invoiceItems(card, inv, onChanged) {
  const S = store.snapshot();
  const ov = card._inv?.[inv.ref] || null;
  const dClose = defaultClose(card, inv.ref);
  const dDue = defaultDue(card, inv.ref);
  sheet({
    title: `Fatura de ${fmtMonth(invMonth(card, inv.ref)).toLowerCase()}`,
    body: `<p class="sheet-text">Fecha em ${fmtDate(inv.close)}, vence em ${fmtDate(inv.due)}.${ov ? ' Datas ajustadas para esta fatura.' : ''}</p>
      <ul class="parts">${inv.items
        .map((it) => {
          const label = it.label || it.tx.desc || S.byId.get(it.tx.categoryId)?.name || 'Compra';
          return `<li><span>${esc(label)}${it.n > 1 ? ` <small>${it.i}/${it.n}</small>` : ''}<small>${fmtDate(it.date)}</small></span><span>${money(it.amount)}</span></li>`;
        })
        .join('')}
        <li class="total"><span>Total</span><span>${money(inv.amount)}</span></li>
        ${inv.paid ? `<li><span>Pago</span><span class="pos">${money(inv.paid)}</span></li>` : ''}
        ${inv.carried ? `<li><span>Foi para a fatura seguinte</span><span>${money(inv.carried)}</span></li>` : ''}</ul>
      <form class="form inv-dates" data-f>
        <h4 class="sub">Datas desta fatura ${tip('Ajuste quando o banco mudar as datas de uma fatura específica, por feriado ou fim de semana. Mudar o fechamento muda quais compras entram nesta fatura. As outras seguem o padrão do cartão.')}</h4>
        <div class="grid2">
          <label class="field"><span>Fechamento</span><input name="close" type="date" value="${inv.close}" required></label>
          <label class="field"><span>Vencimento</span><input name="due" type="date" value="${inv.due}" required></label>
        </div>
        <p class="form-meta">Padrão do cartão: fecha dia ${card.closingDay}, vence dia ${card.dueDay}.</p>
        <div class="sheet-actions">${ov ? `<button type="button" class="btn ghost" data-reset>${icon('refresh')}Voltar ao padrão</button>` : '<span></span>'}<button class="btn primary">Salvar datas</button></div>
      </form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      const id = `ci_${card.id}_${inv.ref}`;
      el.querySelector('[data-reset]')?.addEventListener('click', async () => {
        await store.remove(id);
        close();
        toast('Datas da fatura voltaram ao padrão');
        onChanged?.();
      });
      f.onsubmit = async (e) => {
        e.preventDefault();
        const c2 = f.close.value;
        const d2 = f.due.value;
        if (d2 <= c2) return toast('O vencimento precisa ser depois do fechamento.');
        const prevClose = cardClose(card, addMonths(inv.ref, -1));
        const nextClose = cardClose(card, addMonths(inv.ref, 1));
        if (c2 <= prevClose || c2 >= nextClose) return toast(`O fechamento precisa ficar entre ${fmtDate(prevClose)} e ${fmtDate(nextClose)}, os fechamentos das faturas vizinhas.`);
        const data = { cardId: card.id, ref: inv.ref, close: c2 !== dClose ? c2 : '', due: d2 !== dDue ? d2 : '' };
        if (!data.close && !data.due) await store.remove(id);
        else await store.save('cinv', data, id);
        close();
        toast('Datas da fatura salvas');
        onChanged?.();
      };
    },
  });
}

