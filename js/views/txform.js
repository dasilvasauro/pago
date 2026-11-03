import * as store from '../core/store.js';
import { dueAmount, walletName, ACCOUNT_KINDS } from '../core/domain.js';
import { today } from '../lib/clock.js';
import { esc, money, fmtDate, fmtDayLong, splitParts } from '../lib/util.js';
import { sheet, moneyInput, readMoney, opt, seg, field, toast, confirmDialog, promptDialog, COLORS, icon } from '../ui/ui.js';
import { app, who, multiUser } from '../state.js';
import { METHODS, WITH_CONTACT, methodChoices, defaultMethod, rememberMethod, methodLabel, recentContacts } from '../core/methods.js';

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Chips de forma de pagamento (Pix, boleto...). Vazio quando a forma é implícita pela carteira.
function methodField(S, type, fv, tv, method, disabled = false) {
  const ch = methodChoices(S, type, fv, tv);
  if (ch.length < 2) return '';
  return `<div class="field"><span>Forma</span><div class="chips wrap" role="radiogroup" aria-label="Forma de pagamento">${ch
    .map((m) => `<button type="button" class="chip${m === method ? ' on' : ''}" role="radio" aria-checked="${m === method}" data-m="${m}"${disabled ? ' disabled' : ''}>${m === 'pix' && fv?.startsWith('c:') ? 'Pix no crédito' : METHODS[m]}</button>`)
    .join('')}</div></div>`;
}

/* ---------- Seleção de origem/destino ----------
   Valores: "a:ID" conta, "c:ID" cartão de crédito, "d:ID" cartão de débito (debita a conta vinculada) */
export function walletOptions(S, mode, selected) {
  const liveA = S.acct.filter((a) => !a.archived);
  const liveC = S.card.filter((c) => !c.archived);
  const groups = [];
  for (const inst of S.inst) {
    const items = [];
    for (const a of liveA.filter((a) => a.institutionId === inst.id)) {
      if (a.kind === 'investimento' && mode === 'out') continue;
      if (a.kind === 'divida' && mode !== 'to' && mode !== 'from') continue;
      if (a.kind === 'cofrinho' && mode === 'out') continue;
      items.push([`a:${a.id}`, a.name]);
    }
    for (const c of liveC.filter((c) => c.institutionId === inst.id)) {
      if (c.kind === 'debito' && mode === 'out') items.push([`d:${c.id}`, `${c.name} (débito)`]);
      if (c.kind === 'credito' && (mode === 'out' || mode === 'to' || mode === 'in')) items.push([`c:${c.id}`, `${c.name} (crédito)`]);
    }
    if (items.length) groups.push([inst.name, items]);
  }
  const loose = liveA.filter((a) => !a.institutionId && !['voucher', 'investimento', 'divida'].includes(a.kind));
  if (loose.length) groups.push(['Outras contas', loose.map((a) => [`a:${a.id}`, a.name])]);
  const vouchers = liveA.filter((a) => !a.institutionId && a.kind === 'voucher');
  if (vouchers.length) groups.push(['Vouchers', vouchers.map((a) => [`a:${a.id}`, a.name])]);
  const inv = liveA.filter((a) => !a.institutionId && a.kind === 'investimento');
  if (inv.length && mode !== 'out') groups.push(['Investimentos', inv.map((a) => [`a:${a.id}`, a.name])]);
  const debts = liveA.filter((a) => !a.institutionId && a.kind === 'divida');
  if (debts.length && (mode === 'to' || mode === 'from')) groups.push(['Dívidas', debts.map((a) => [`a:${a.id}`, a.name])]);
  if (!groups.length) return `<option value="">Cadastre uma conta na Carteira</option>`;
  return (
    `<option value="" data-ph>Selecionar</option>` +
    groups.map(([g, items]) => `<optgroup label="${esc(g)}">${items.map(([v, l]) => opt(v, l, v === selected)).join('')}</optgroup>`).join('')
  );
}

export function decodeWallet(S, v) {
  if (!v) return { ref: null };
  const [k, id] = v.split(':');
  if (k === 'd') {
    const card = S.byId.get(id);
    return { ref: card?.accountId ? { k: 'a', id: card.accountId } : null, via: id };
  }
  return { ref: { k, id } };
}
export const encodeWallet = (ref, via) => (via ? `d:${via}` : ref ? `${ref.k}:${ref.id}` : '');

function catOptions(S, kind, selected) {
  const list = S.cat.filter((c) => c.kind === kind && !c.archived);
  return `<option value="">Sem categoria</option>${list.map((c) => opt(c.id, c.name, c.id === selected)).join('')}<option value="__new">Nova categoria…</option>`;
}

const LAST = 'pago.lastWallet.';
const isCredit = (v) => v?.startsWith('c:');

/* ---------- Novo lançamento / edição ---------- */
export function openTx(preset = {}) {
  const S = store.snapshot();
  const t = preset.id ? S.byId.get(preset.id) : null;
  const archived = !!t?._ar;
  const d = t || {
    type: preset.type || 'saida',
    amount: preset.amount || 0,
    date: preset.date || today(),
    desc: preset.desc || '',
    categoryId: preset.categoryId || '',
    installments: 1,
  };
  let type = d.type === 'ajuste' ? 'ajuste' : d.type;
  let method = d.method || '';
  let contact = d.contact || '';
  const fromV = t ? encodeWallet(t.from, t.via) : preset.fromV || localStorage.getItem(LAST + 'from') || '';
  const toV = t ? encodeWallet(t.to) : preset.toV || localStorage.getItem(LAST + 'to') || '';

  const metaLine = () => {
    if (!t) return '';
    const parts = [`Registrado por ${who(S, t._cb).name}`];
    if (t._by && t._by !== t._cb) parts.push(`alterado por ${who(S, t._by).name}`);
    return `<p class="form-meta">${esc(parts.join(', '))}${archived ? '. Mês arquivado: somente leitura.' : ''}</p>`;
  };

  const dyn = (ty) => {
    if (ty === 'ajuste')
      return `${field('Conta', `<select name="to" disabled>${walletOptions(S, 'to', toV)}</select>`)}
        <p class="form-meta">Ajustes corrigem saldos e não entram nos totais de entradas e saídas.</p>`;
    if (ty === 'saida')
      return `${field('Pago com', `<select name="from" required>${walletOptions(S, 'out', fromV)}</select>`, 'Ao escolher um cartão de crédito, o valor entra na fatura. No débito, sai da conta vinculada.')}
        <div class="inst-row" ${isCredit(fromV) ? '' : 'hidden'}>${field('Parcelas', `<input name="installments" type="number" min="1" max="48" value="${d.installments || 1}" inputmode="numeric">`, 'Compras parceladas ocupam o limite pelo total e entram uma parcela por fatura. Para um parcelamento antigo, registre só as parcelas que faltam.')}<span class="inst-hint"></span></div>
        ${field('Categoria', `<select name="categoryId">${catOptions(S, 'saida', d.categoryId)}</select>`)}`;
    if (ty === 'entrada')
      return `${field('Recebido em', `<select name="to" required>${walletOptions(S, 'in', toV)}</select>`, 'Se a conta estiver negativa, a entrada abate o cheque especial automaticamente. Em um cartão de crédito, vale como estorno.')}
        ${field('Categoria', `<select name="categoryId">${catOptions(S, 'entrada', d.categoryId)}</select>`)}`;
    return `${field('De', `<select name="from" required>${walletOptions(S, 'from', fromV)}</select>`)}
      ${field('Para', `<select name="to" required>${walletOptions(S, 'to', toV)}</select>`, 'Para pagar a fatura de um cartão, transfira da conta para o cartão de crédito.')}`;
  };

  sheet({
    title: t ? (archived ? 'Lançamento' : 'Editar lançamento') : 'Novo lançamento',
    body: `<form class="form" data-f>
      ${type === 'ajuste' ? '' : seg('type', [['saida', 'Saída'], ['entrada', 'Entrada'], ['transf', 'Transferência']], type)}
      ${moneyInput('amount', d.amount, { big: true, autofocus: !t, allowNeg: type === 'ajuste' })}
      <label class="field"><span>Descrição</span><input name="desc" value="${esc(d.desc || '')}" placeholder="Opcional" maxlength="80"></label>
      <div data-dyn>${dyn(type)}</div>
      <div data-method class="form-sub"></div>
      <label class="field"><span>Data</span><input name="date" type="date" value="${d.date}" required></label>
      ${metaLine()}
      <div class="sheet-actions">
        ${t && !archived ? `<button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Excluir</button>` : '<span></span>'}
        ${archived ? '' : `<button class="btn primary">${t ? 'Salvar' : 'Registrar'}</button>`}
      </div>
    </form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      if (archived) [...f.elements].forEach((x) => (x.disabled = true));
      const dynBox = el.querySelector('[data-dyn]');
      const hint = () => {
        const row = el.querySelector('.inst-row');
        if (!row) return;
        const credit = isCredit(f.from?.value);
        row.hidden = !credit;
        const n = Number(f.installments?.value || 1);
        const amt = readMoney(f.amount);
        el.querySelector('.inst-hint').textContent = credit && n > 1 && amt ? `${n}x de ${money(splitParts(amt, n)[n - 1])}` : '';
      };
      const methodBox = el.querySelector('[data-method]');
      const renderMethod = () => {
        if (type === 'ajuste') return (methodBox.innerHTML = '');
        const S3 = store.snapshot();
        const fv = f.from?.value || '';
        const tv = f.to?.value || '';
        const typed = methodBox.querySelector('input[name=contact]');
        if (typed) contact = typed.value;
        method = defaultMethod(S3, type, fv, tv, method);
        const showContact = WITH_CONTACT.has(method) && (type === 'saida' || type === 'entrada') && !fv.startsWith('c:');
        methodBox.innerHTML =
          methodField(S3, type, fv, tv, method, archived) +
          (showContact
            ? `<div class="field"><span>${type === 'saida' ? 'Para quem' : 'De quem'}</span>
                <input name="contact" value="${esc(contact)}" placeholder="Nome ou estabelecimento (opcional)" maxlength="60" autocomplete="off" aria-label="${type === 'saida' ? 'Para quem' : 'De quem'}"${archived ? ' disabled' : ''}>
                <div class="sugg" data-sugg></div></div>`
            : '');
        const input = methodBox.querySelector('input[name=contact]');
        if (!input || archived) return;
        const all = recentContacts(S3);
        const sugg = methodBox.querySelector('[data-sugg]');
        const drawSugg = () => {
          const q = norm(input.value.trim());
          const list = all.filter((c) => norm(c) !== q && (!q || norm(c).includes(q))).slice(0, 6);
          sugg.innerHTML = list.map((c) => `<button type="button" class="chip small" data-c="${esc(c)}">${esc(c)}</button>`).join('');
          sugg.hidden = !list.length;
        };
        input.addEventListener('input', drawSugg);
        sugg.addEventListener('click', (e) => {
          const b = e.target.closest('[data-c]');
          if (!b) return;
          input.value = contact = b.dataset.c;
          drawSugg();
        });
        drawSugg();
      };
      methodBox.addEventListener('click', (e) => {
        const b = e.target.closest('[data-m]');
        if (!b || b.disabled) return;
        method = b.dataset.m;
        renderMethod();
      });
      const wire = () => {
        f.from?.addEventListener('change', renderMethod);
        f.to?.addEventListener('change', renderMethod);
        renderMethod();
        f.from?.addEventListener('change', hint);
        f.installments?.addEventListener('input', hint);
        f.categoryId?.addEventListener('change', async () => {
          if (f.categoryId.value !== '__new') return;
          const name = await promptDialog('Nova categoria', { label: 'Nome', ok: 'Criar' });
          const kind = type === 'entrada' ? 'entrada' : 'saida';
          if (!name) {
            f.categoryId.value = '';
            return f.categoryId.dispatchEvent(new Event('change'));
          }
          const id = await store.save('cat', { name, kind, color: COLORS[store.snapshot().cat.length % COLORS.length] });
          f.categoryId.innerHTML = catOptions(store.snapshot(), kind, id);
        });
        hint();
      };
      wire();
      f.amount.addEventListener('money', hint);
      f.querySelectorAll('input[name=type]').forEach((r) =>
        r.addEventListener('change', () => {
          type = r.value;
          dynBox.innerHTML = dyn(type);
          wire();
        }),
      );
      el.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await confirmDialog('Excluir este lançamento? Os saldos serão recalculados.', { ok: 'Excluir', danger: true }))) return;
        await store.remove(t.id);
        close();
        toast('Lançamento excluído');
      });
      f.onsubmit = async (e) => {
        e.preventDefault();
        const amount = readMoney(f.amount);
        if (!amount) return toast('Informe um valor.');
        const S2 = store.snapshot();
        const data = {
          type,
          amount: type === 'ajuste' ? amount : Math.abs(amount),
          date: f.date.value,
          desc: f.desc.value.trim(),
          ob: t?.ob || preset.ob || undefined,
        };
        if (type === 'ajuste') data.to = t?.to || preset.to;
        if (type === 'saida' || type === 'transf') {
          const w = decodeWallet(S2, f.from.value);
          if (!w.ref) return toast('Escolha de onde saiu o dinheiro.');
          data.from = w.ref;
          if (w.via) data.via = w.via;
          localStorage.setItem(LAST + 'from', f.from.value);
        }
        if (type === 'entrada' || type === 'transf') {
          const w = decodeWallet(S2, f.to.value);
          if (!w.ref) return toast('Escolha para onde foi o dinheiro.');
          data.to = w.ref;
          localStorage.setItem(LAST + 'to', f.to.value);
        }
        if (type === 'transf' && data.from.id === data.to.id) return toast('Origem e destino precisam ser diferentes.');
        if (type === 'saida' || type === 'entrada') data.categoryId = f.categoryId.value === '__new' ? '' : f.categoryId.value;
        if (type === 'saida' && data.from.k === 'c') data.installments = Math.max(1, Math.min(48, Number(f.installments.value) || 1));
        if (methodChoices(S2, type, f.from?.value, f.to?.value).length) {
          data.method = method;
          rememberMethod(S2, type, f.from?.value, f.to?.value, method);
        } else if (type === 'saida' && data.from?.k === 'c') data.method = 'credito';
        const ci = f.querySelector('input[name=contact]');
        if (ci?.value.trim()) data.contact = ci.value.trim();
        Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
        await store.save('tx', data, t?.id);
        close();
        toast(t ? 'Lançamento salvo' : 'Lançamento registrado');
      };
    },
  });
}

/* ---------- Pagar / receber um compromisso ---------- */
export function openPay(o, opts = {}) {
  const S = store.snapshot();
  if (o.paid && o.tx) return openTx({ id: o.tx.id });
  const isIn = o.dir === 'in';
  const isInv = o.kind === 'invoice';
  const amount = opts.amount ?? dueAmount(o);
  const defV = isInv ? localStorage.getItem(LAST + 'from') || '' : encodeWallet(o.ref, o.src?.sourceVia);
  const mode = isIn ? 'in' : isInv ? 'from' : 'out';
  sheet({
    title: isIn ? 'Registrar recebimento' : isInv ? 'Pagar fatura' : 'Registrar pagamento',
    body: `<form class="form" data-f>
      <div class="pay-head"><b>${esc(o.title)}</b><span>Vence ${fmtDayLong(o.date).toLowerCase()}</span></div>
      ${o.parts.length > 1 ? `<ul class="parts">${o.parts.map((p) => `<li><span>${esc(p.label)}</span><span>${money(p.amount)}</span></li>`).join('')}</ul>` : ''}
      ${isInv && o.inv.paid ? `<p class="form-meta">Já pago nesta fatura: ${money(o.inv.paid)} de ${money(o.inv.amount)}.</p>` : ''}
      ${moneyInput('amount', amount, { big: true })}
      ${field(isIn ? 'Recebido em' : 'Pago com', `<select name="w" required>${walletOptions(S, mode, defV)}</select>`)}
      <div data-method class="form-sub"></div>
      <label class="field"><span>Data</span><input name="date" type="date" value="${today()}" required></label>
      <div class="sheet-actions"><span></span><button class="btn primary">${isIn ? 'Registrar recebimento' : 'Registrar pagamento'}</button></div>
    </form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      const ptype = isIn ? 'entrada' : isInv ? 'transf' : 'saida';
      const ends = () => (isIn ? ['', f.w.value] : isInv ? [f.w.value, `c:${o.src.id}`] : [f.w.value, '']);
      const box = el.querySelector('[data-method]');
      let method = '';
      const drawMethod = () => {
        const S3 = store.snapshot();
        const [fv, tv] = ends();
        method = defaultMethod(S3, ptype, fv, tv, method || o.src?.method);
        box.innerHTML = methodField(S3, ptype, fv, tv, method);
      };
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        method = b.dataset.m;
        drawMethod();
      });
      f.w.addEventListener('change', drawMethod);
      drawMethod();
      f.onsubmit = async (e) => {
        e.preventDefault();
        const S2 = store.snapshot();
        const value = readMoney(f.amount);
        const w = decodeWallet(S2, f.w.value);
        if (!value) return toast('Informe um valor.');
        if (!w.ref) return toast('Escolha a conta.');
        let data;
        if (isInv) data = { type: 'transf', amount: value, date: f.date.value, desc: `Pagamento ${o.title.toLowerCase()}`, from: w.ref, to: { k: 'c', id: o.src.id } };
        else {
          data = { type: isIn ? 'entrada' : 'saida', amount: value, date: f.date.value, desc: o.title, categoryId: o.categoryId || '', ob: o.parts.map((p) => p.key) };
          if (isIn) data.to = w.ref;
          else {
            data.from = w.ref;
            if (w.via) data.via = w.via;
          }
        }
        const [fv, tv] = ends();
        if (methodChoices(S2, ptype, fv, tv).length) {
          data.method = method;
          rememberMethod(S2, ptype, fv, tv, method);
        }
        await store.save('tx', data);
        close();
        toast(isIn ? 'Recebimento registrado' : 'Pagamento registrado');
      };
    },
  });
}

/* ---------- Linha de lançamento (diário, detalhes de conta) ---------- */
export function txRow(S, t, { showDate = false } = {}) {
  const cat = t.categoryId ? S.byId.get(t.categoryId) : null;
  const sign = t.type === 'entrada' ? 1 : t.type === 'saida' ? -1 : t.type === 'ajuste' ? Math.sign(t.amount) : 0;
  const title =
    t.desc ||
    cat?.name ||
    (t.contact ? `${t.type === 'entrada' ? 'De' : 'Para'} ${t.contact}` : '') ||
    (t.type === 'transf' ? (t.to?.k === 'c' ? 'Pagamento de fatura' : 'Transferência') : t.type === 'ajuste' ? 'Ajuste de saldo' : t.type === 'entrada' ? 'Entrada' : 'Saída');
  const meta = [];
  if (showDate) meta.push(fmtDate(t.date));
  const ml = methodLabel(t);
  if (ml) meta.push(t.contact && title.includes(t.contact) ? METHODS[t.method] : ml);
  if (t.type === 'transf') meta.push(`${walletName(S, t.from)} para ${walletName(S, t.to)}`);
  else if (t.type === 'saida') meta.push(t.via ? S.byId.get(t.via)?.name || walletName(S, t.from) : walletName(S, t.from));
  else meta.push(walletName(S, t.to));
  if (t.installments > 1) meta.push(`${t.installments}x de ${money(splitParts(t.amount, t.installments)[1] ?? t.amount)}`);
  if (cat && t.desc) meta.push(cat.name);
  const w = multiUser(S) ? who(S, t._cb) : null;
  return `<button type="button" class="tx-row" data-tx="${t.id}">
    <span class="tx-ic t-${t.type}" style="--c:${cat?.color || 'var(--muted)'}">${icon(t.type === 'entrada' ? 'in' : t.type === 'saida' ? 'out' : t.type === 'ajuste' ? 'edit' : 'swap')}</span>
    <span class="tx-main"><span class="tx-title">${esc(title)}</span><span class="tx-meta">${esc(meta.join(', '))}</span></span>
    ${w ? `<span class="who" style="--c:${w.color}" title="${esc(w.name)}">${esc(w.short)}</span>` : ''}
    <span class="tx-amt ${sign > 0 ? 'pos' : sign < 0 ? 'neg' : ''}">${sign > 0 ? '+' : sign < 0 ? '−' : ''}${money(Math.abs(t.amount)).replace('−', '')}</span>
  </button>`;
}

export const kindLabel = (a) => ACCOUNT_KINDS[a.kind] || '';
