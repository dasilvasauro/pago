import { esc, fmtInputMoney } from '../lib/util.js';

/* ---------- Ícones (traço único, 24px) ---------- */
const P = {
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  diary: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
  plan: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4M8 14h3"/>',
  wallet: '<path d="M4 7a2 2 0 0 1 2-2h11v4"/><path d="M4 7v11a2 2 0 0 0 2 2h13V9H6a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1.2"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h4"/>',
  bank: '<path d="M4 9.5 12 5l8 4.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M4 20h16"/>',
  in: '<path d="M17 7 7 17M7 9v8h8"/>',
  out: '<path d="M7 17 17 7M9 7h8v8"/>',
  swap: '<path d="M7 8h12l-3-3M17 16H5l3 3"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 .5 9.5z"/>',
  download: '<path d="M12 4v11m-4-4 4 4 4-4M5 20h14"/>',
  upload: '<path d="M12 16V5m-4 4 4-4 4 4M5 20h14"/>',
  logout: '<path d="M14 5h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h9"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 14h2M14 18v2M17 17h3v3h-3z"/>',
  share: '<path d="M12 15V4m-4 4 4-4 4 4"/><path d="M6 12v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  archive: '<rect x="4" y="5" width="16" height="4" rx="1"/><path d="M5.5 9v10h13V9M10 13h4"/>',
  edit: '<path d="M5 19h4L19 9l-4-4L5 15zM13.5 6.5l4 4"/>',
  chart: '<path d="M4 19h16M6 15l4-4 3 2 5-6"/>',
  flask: '<path d="M10 4h4M10.5 4v5.5L5.5 18a1.5 1.5 0 0 0 1.3 2h10.4a1.5 1.5 0 0 0 1.3-2l-5-8.5V4"/><path d="M8 14h8"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h2"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4"/>',
};
export const icon = (n, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

/* ---------- Dica contextual ---------- */
export const tip = (text) =>
  `<button type="button" class="tip" data-tip="${esc(text)}" aria-label="Ajuda: ${esc(text)}">${icon('info')}</button>`;

let tipEl = null;
function hideTip() {
  tipEl?.remove();
  tipEl = null;
}
export function initTips() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.tip');
    if (!b) return hideTip();
    e.preventDefault();
    e.stopPropagation();
    if (tipEl && tipEl._for === b) return hideTip();
    hideTip();
    tipEl = document.createElement('div');
    tipEl.className = 'tip-pop';
    tipEl.textContent = b.dataset.tip;
    tipEl._for = b;
    document.body.appendChild(tipEl);
    const r = b.getBoundingClientRect();
    const w = Math.min(280, window.innerWidth - 24);
    tipEl.style.maxWidth = w + 'px';
    const pw = tipEl.offsetWidth;
    let left = Math.min(Math.max(12, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 12);
    let top = r.bottom + 8;
    if (top + tipEl.offsetHeight > window.innerHeight - 12) top = r.top - tipEl.offsetHeight - 8;
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  }, true);
  window.addEventListener('scroll', hideTip, true);
}

/* ---------- Painel (bottom sheet no celular, diálogo no computador) ---------- */
const stack = [];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) stack[stack.length - 1]();
});

export function sheet({ title, body, onMount, onClose, wide = false }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop"></div>
    <section class="sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button></header>
      <div class="sheet-body">${body}</div>
    </section>`;
  document.body.appendChild(wrap);
  document.body.classList.add('has-sheet');
  const prev = document.activeElement;
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    stack.splice(stack.indexOf(close), 1);
    wrap.classList.remove('open');
    onClose?.();
    setTimeout(() => {
      wrap.remove();
      if (!stack.length) document.body.classList.remove('has-sheet');
    }, 220);
    prev?.focus?.({ preventScroll: true });
  };
  stack.push(close);
  wrap.querySelector('.sheet-backdrop').onclick = close;
  wrap.querySelector('[data-close]').onclick = close;
  const el = wrap.querySelector('.sheet');
  bindMoney(el);
  onMount?.(el, close);
  setTimeout(() => el.querySelector('[autofocus]')?.focus(), 80);
  return close;
}

export function confirmDialog(message, { ok = 'Confirmar', danger = false, title = 'Confirmar' } = {}) {
  return new Promise((resolve) => {
    let result = false;
    sheet({
      title,
      body: `<p class="sheet-text">${esc(message)}</p>
        <div class="sheet-actions"><button type="button" class="btn ghost" data-no>Cancelar</button>
        <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(ok)}</button></div>`,
      onMount(el, close) {
        el.querySelector('[data-no]').onclick = close;
        el.querySelector('[data-yes]').onclick = () => {
          result = true;
          close();
        };
      },
      onClose: () => resolve(result),
    });
  });
}

export function promptDialog(title, { label = '', value = '', ok = 'Salvar', type = 'text' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    sheet({
      title,
      body: `<form class="form" data-f>
        <label class="field"><span>${esc(label)}</span><input name="v" type="${type}" value="${esc(value)}" autofocus required></label>
        <div class="sheet-actions"><button type="button" class="btn ghost" data-no>Cancelar</button><button class="btn primary">${esc(ok)}</button></div></form>`,
      onMount(el, close) {
        el.querySelector('[data-no]').onclick = close;
        el.querySelector('[data-f]').onsubmit = (e) => {
          e.preventDefault();
          result = e.target.v.value.trim();
          close();
        };
      },
      onClose: () => resolve(result),
    });
  });
}

/* ---------- Avisos ---------- */
export function toast(msg, { action, onAction, ms = 3200 } = {}) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  const kill = () => {
    t.classList.remove('in');
    setTimeout(() => t.remove(), 200);
  };
  if (action)
    t.querySelector('button').onclick = () => {
      onAction?.();
      kill();
    };
  setTimeout(kill, action ? ms * 2 : ms);
}

/* ---------- Campo de valor em reais (digitação estilo caixa eletrônico) ---------- */
export function moneyInput(name, cents = 0, { allowNeg = false, big = false, autofocus = false } = {}) {
  const neg = cents < 0 ? '1' : '0';
  return `<div class="money-in${big ? ' big' : ''}${cents < 0 ? ' neg' : ''}">
    <span class="cur">R$</span>
    <input name="${name}" size="1" inputmode="numeric" autocomplete="off" data-money data-neg="${neg}" value="${fmtInputMoney(cents)}"${autofocus ? ' autofocus' : ''}>
    ${allowNeg ? `<button type="button" class="sign" data-sign aria-pressed="${neg === '1'}" aria-label="Valor negativo" title="Alternar entre positivo e negativo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 4v8M4 8h8M13 18h7"/></svg></button>` : ''}
  </div>`;
}

export function bindMoney(root) {
  root.querySelectorAll('input[data-money]').forEach((el) => {
    if (el._bound) return;
    el._bound = true;
    const box = el.closest('.money-in');
    el.addEventListener('focus', () => setTimeout(() => el.setSelectionRange(el.value.length, el.value.length), 0));
    el.addEventListener('input', () => {
      const digits = el.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 11);
      el.value = fmtInputMoney(Number(digits || 0));
      el.dispatchEvent(new CustomEvent('money'));
    });
    box?.querySelector('[data-sign]')?.addEventListener('click', () => {
      el.dataset.neg = el.dataset.neg === '1' ? '0' : '1';
      box.classList.toggle('neg', el.dataset.neg === '1');
      box.querySelector('[data-sign]').setAttribute('aria-pressed', el.dataset.neg === '1');
      el.dispatchEvent(new CustomEvent('money'));
    });
  });
}

export const readMoney = (el) => (el.dataset.neg === '1' ? -1 : 1) * Number(el.value.replace(/\D/g, '') || 0);

export function readForm(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.dataset.money !== undefined) o[el.name] = readMoney(el);
    else if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') {
      if (el.checked) o[el.name] = el.value;
    } else if (el.type === 'number') o[el.name] = el.value === '' ? null : Number(el.value);
    else o[el.name] = el.value;
  }
  return o;
}

export const opt = (value, label, sel) => `<option value="${esc(value)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;

export function seg(name, options, value) {
  return `<div class="seg" role="radiogroup">${options
    .map(([v, l]) => `<label><input type="radio" name="${name}" value="${esc(v)}"${v === value ? ' checked' : ''}><span>${esc(l)}</span></label>`)
    .join('')}</div>`;
}

export const field = (label, control, help) =>
  `<label class="field"><span>${esc(label)}${help ? tip(help) : ''}</span>${control}</label>`;

export const COLORS = ['#7C8CFF', '#5FE3B5', '#F2C14E', '#F2716B', '#59C3F0', '#C08CF5', '#F59AC0', '#9BD16A', '#F0995A', '#8FA3B8'];
export function colorPicker(name, value) {
  return `<div class="colors">${COLORS.map(
    (c) => `<label style="--c:${c}"><input type="radio" name="${name}" value="${c}"${c === value ? ' checked' : ''}><span></span></label>`,
  ).join('')}</div>`;
}

// Anima um número do zero até o valor (usado uma vez por sessão no total de dívida).
export function countUp(el, to, fmt, ms = 700) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(Math.round(to * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
