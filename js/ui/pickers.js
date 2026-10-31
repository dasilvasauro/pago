// Seletores personalizados.
// O <select> e o <input type=date|month> originais continuam no formulário (ocultos): o código das
// telas lê e escuta os mesmos elementos de sempre. Aqui só se troca a interface.
// No celular as listas e o calendário abrem como painel inferior; no computador, ancorados ao campo.
import { esc, fmtMonth, fmtDateHuman, addDays, addMonths, clampDay, pad, MSHORT } from '../lib/util.js';
import { today } from '../lib/clock.js';
import { icon } from './ui.js';

const isMobile = () => matchMedia('(max-width: 699px)').matches;
let current = null;

export const closePopover = () => current?.(false);

/* ---------- Painel flutuante ---------- */
export function popover(anchor, build, { title = '', minWidth = 220, cls = '', onClose } = {}) {
  closePopover();
  const mobile = isMobile();
  const wrap = document.createElement('div');
  wrap.className = `pop-wrap${mobile ? ' is-sheet' : ''}`;
  wrap.innerHTML = `${mobile ? '<div class="pop-backdrop"></div>' : ''}
    <div class="pop ${cls}" role="dialog" aria-label="${esc(title)}">
      ${mobile && title ? `<div class="pop-title">${esc(title)}</div>` : ''}
      <div class="pop-body"></div>
    </div>`;
  document.body.appendChild(wrap);
  const pop = wrap.querySelector('.pop');
  const body = wrap.querySelector('.pop-body');

  const close = (refocus = true) => {
    if (!wrap.isConnected || wrap.dataset.closing) return;
    wrap.dataset.closing = '1';
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 160);
    current = null;
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('scroll', onScroll, true);
    onClose?.();
    if (refocus) anchor.focus({ preventScroll: true });
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation(); // não fecha o painel de baixo
    close();
  };
  const onDown = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) close(false);
  };
  const onResize = () => close(false);
  const onScroll = (e) => {
    if (!mobile && !pop.contains(e.target)) close(false);
  };

  build(body, close);

  if (!mobile) {
    const r = anchor.getBoundingClientRect();
    const w = Math.min(Math.max(r.width, minWidth), window.innerWidth - 16);
    pop.style.width = w + 'px';
    pop.style.left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8) + 'px';
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const h = pop.scrollHeight;
    if (h > below && above > below) {
      pop.style.maxHeight = Math.min(above, 420) + 'px';
      pop.style.top = Math.max(8, r.top - Math.min(h, above, 420) - 6) + 'px';
      pop.classList.add('up');
    } else {
      pop.style.maxHeight = Math.max(180, Math.min(below, 420)) + 'px';
      pop.style.top = r.bottom + 6 + 'px';
    }
  }
  requestAnimationFrame(() => wrap.classList.add('open'));
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('resize', onResize);
  document.addEventListener('scroll', onScroll, true);
  current = close;
  return close;
}

function fieldLabel(el) {
  return el.getAttribute('aria-label') || el.closest('label')?.querySelector(':scope > span')?.textContent.trim() || '';
}

function makeTrigger(el, extraCls) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `pick ${extraCls}`;
  const label = fieldLabel(el);
  if (label) btn.setAttribute('aria-label', label);
  el.after(btn);
  el.addEventListener('focus', () => btn.focus()); // clique no rótulo leva ao botão
  return btn;
}

/* ---------- Lista (substitui <select>) ---------- */
export function enhanceSelect(sel) {
  if (sel._pick || sel.hasAttribute('data-native')) return;
  sel._pick = true;
  sel.removeAttribute('required'); // as telas validam a escolha ao salvar
  sel.classList.add('pick-native');
  sel.tabIndex = -1;
  sel.setAttribute('aria-hidden', 'true');
  const btn = makeTrigger(sel, 'pick-select');
  btn.setAttribute('aria-haspopup', 'listbox');
  const refresh = () => {
    const o = sel.selectedOptions[0];
    const ph = !o || o.hasAttribute('data-ph');
    btn.innerHTML = `<span class="pick-val${ph ? ' ph' : ''}">${esc(o?.textContent || '')}</span>${icon('down')}`;
    btn.disabled = sel.disabled;
  };
  refresh();
  sel.addEventListener('change', refresh);
  new MutationObserver(refresh).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  btn.addEventListener('click', () => openList(sel, btn));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openList(sel, btn);
    }
  });
}

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function openList(sel, btn) {
  if (sel.disabled) return;
  btn.setAttribute('aria-expanded', 'true');
  popover(
    btn,
    (body, close) => {
      const opt = (o) =>
        o.hasAttribute('data-ph')
          ? ''
          : `<button type="button" role="option" class="pick-opt${o.selected ? ' on' : ''}" data-i="${o.index}" aria-selected="${o.selected}"${o.disabled ? ' disabled' : ''}><span>${esc(o.textContent)}</span>${o.selected ? icon('check') : ''}</button>`;
      let list = '';
      for (const n of sel.children) {
        if (n.tagName === 'OPTGROUP') list += `<div class="pick-group" role="group" aria-label="${esc(n.label)}"><div class="pick-glabel">${esc(n.label)}</div>${[...n.children].map(opt).join('')}</div>`;
        else list += opt(n);
      }
      const searchable = sel.options.length > 9;
      body.innerHTML = `${searchable ? `<div class="pick-search">${icon('diary', 'sm')}<input type="search" placeholder="Buscar" aria-label="Buscar opção" autocomplete="off"></div>` : ''}<div class="pick-list" role="listbox">${list}</div>`;
      const opts = () => [...body.querySelectorAll('.pick-opt:not([hidden]):not(:disabled)')];
      body.addEventListener('click', (e) => {
        const b = e.target.closest('.pick-opt');
        if (!b) return;
        sel.selectedIndex = Number(b.dataset.i);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        close();
      });
      body.addEventListener('keydown', (e) => {
        const list = opts();
        const i = list.indexOf(document.activeElement);
        let next = null;
        if (e.key === 'ArrowDown') next = list[Math.min(list.length - 1, i + 1)];
        else if (e.key === 'ArrowUp') next = i <= 0 ? body.querySelector('.pick-search input') || list[0] : list[i - 1];
        else if (e.key === 'Home') next = list[0];
        else if (e.key === 'End') next = list[list.length - 1];
        else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT') {
          const s = body.querySelector('.pick-search input');
          if (s) s.focus();
          else next = list.find((b) => norm(b.textContent).startsWith(norm(e.key)));
          if (!s) e.preventDefault();
          return next?.focus();
        }
        if (next) {
          e.preventDefault();
          next.focus();
        }
      });
      const search = body.querySelector('.pick-search input');
      search?.addEventListener('input', () => {
        const q = norm(search.value.trim());
        body.querySelectorAll('.pick-opt').forEach((b) => (b.hidden = !!q && !norm(b.textContent).includes(q)));
        body.querySelectorAll('.pick-group').forEach((g) => (g.hidden = !g.querySelector('.pick-opt:not([hidden])')));
      });
      search?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          opts()[0]?.click();
        }
      });
      setTimeout(() => {
        const on = body.querySelector('.pick-opt.on');
        on?.scrollIntoView({ block: 'nearest' });
        if (!isMobile() || !search) (on || opts()[0])?.focus({ preventScroll: true });
      }, 0);
    },
    { title: fieldLabel(sel), cls: 'pop-list', onClose: () => btn.setAttribute('aria-expanded', 'false') },
  );
}

/* ---------- Calendário (substitui <input type=date|month>) ---------- */
const WD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export function enhanceDate(inp) {
  if (inp._pick || inp.hasAttribute('data-native')) return;
  inp._pick = true;
  const kind = inp.type === 'month' ? 'month' : 'date';
  const optional = !inp.required;
  const btn = makeTrigger(inp, 'pick-date');
  inp.type = 'hidden'; // o valor continua no formulário (AAAA-MM-DD ou AAAA-MM)
  btn.setAttribute('aria-haspopup', 'dialog');
  const refresh = () => {
    const v = inp.value;
    btn.innerHTML = `${icon('plan')}<span class="pick-val${v ? '' : ' ph'}">${v ? (kind === 'month' ? fmtMonth(v) : fmtDateHuman(v)) : 'Sem data'}</span>`;
    btn.disabled = inp.disabled;
  };
  refresh();
  inp.addEventListener('change', refresh);
  new MutationObserver(refresh).observe(inp, { attributes: true, attributeFilter: ['disabled', 'value'] });
  btn.addEventListener('click', () => openCalendar(inp, btn, kind, optional));
}

function openCalendar(inp, btn, kind, optional) {
  if (inp.disabled) return;
  const td = today();
  let view = kind === 'month' ? 'months' : 'days';
  let cursor = inp.value ? (kind === 'month' ? `${inp.value}-01` : inp.value) : td;

  popover(
    btn,
    (body, close) => {
      const pick = (v) => {
        inp.value = v;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        close();
      };
      const foot = `<div class="cal-foot">${optional ? `<button type="button" class="btn small ghost" data-clear>Limpar</button>` : '<span></span>'}<button type="button" class="btn small" data-today>${kind === 'month' ? 'Este mês' : 'Hoje'}</button></div>`;

      const draw = (focusSel = '[tabindex="0"]') => {
        const ym = cursor.slice(0, 7);
        const [y] = ym.split('-').map(Number);
        if (view === 'days') {
          const start = addDays(`${ym}-01`, -new Date(y, Number(ym.slice(5)) - 1, 1).getDay());
          let cells = '';
          for (let i = 0; i < 42; i++) {
            const d = addDays(start, i);
            const c = ['cal-day', d.slice(0, 7) !== ym && 'out', d === td && 'today', d === inp.value && 'sel'].filter(Boolean).join(' ');
            cells += `<button type="button" class="${c}" data-d="${d}" tabindex="${d === cursor ? 0 : -1}" aria-label="${fmtDateHuman(d)}"${d === inp.value ? ' aria-pressed="true"' : ''}>${Number(d.slice(8))}</button>`;
          }
          body.innerHTML = `<div class="cal">
            <div class="cal-head"><button type="button" class="icon-btn" data-nav="-1" aria-label="Mês anterior">${icon('left')}</button>
            <button type="button" class="cal-title" data-view aria-label="Escolher mês e ano">${fmtMonth(ym)}${icon('down', 'sm')}</button>
            <button type="button" class="icon-btn" data-nav="1" aria-label="Próximo mês">${icon('right')}</button></div>
            <div class="cal-wd" aria-hidden="true">${WD.map((w) => `<span>${w}</span>`).join('')}</div>
            <div class="cal-grid">${cells}</div>${foot}</div>`;
        } else {
          let cells = '';
          for (let m = 1; m <= 12; m++) {
            const v = `${y}-${pad(m)}`;
            const sel = (inp.value || '').slice(0, 7) === v;
            const c = ['cal-month', v === td.slice(0, 7) && 'today', sel && 'sel'].filter(Boolean).join(' ');
            cells += `<button type="button" class="${c}" data-m="${v}" tabindex="${v === ym ? 0 : -1}" aria-label="${fmtMonth(v)}">${cap(MSHORT[m - 1])}</button>`;
          }
          body.innerHTML = `<div class="cal">
            <div class="cal-head"><button type="button" class="icon-btn" data-yr="-1" aria-label="Ano anterior">${icon('left')}</button>
            <span class="cal-title static">${y}</span>
            <button type="button" class="icon-btn" data-yr="1" aria-label="Próximo ano">${icon('right')}</button></div>
            <div class="cal-months">${cells}</div>${foot}</div>`;
        }
        if (focusSel) body.querySelector(focusSel)?.focus({ preventScroll: true });
      };

      body.addEventListener('click', (e) => {
        const t = e.target.closest('button');
        if (!t) return;
        const day = Number(cursor.slice(8));
        if (t.dataset.nav) {
          cursor = clampDay(addMonths(cursor.slice(0, 7), Number(t.dataset.nav)), day);
          draw(`[data-nav="${t.dataset.nav}"]`);
        } else if (t.dataset.yr) {
          cursor = clampDay(addMonths(cursor.slice(0, 7), 12 * Number(t.dataset.yr)), day);
          draw(`[data-yr="${t.dataset.yr}"]`);
        } else if (t.hasAttribute('data-view')) {
          view = 'months';
          draw();
        } else if (t.dataset.d) pick(t.dataset.d);
        else if (t.dataset.m) {
          if (kind === 'month') return pick(t.dataset.m);
          cursor = clampDay(t.dataset.m, day);
          view = 'days';
          draw();
        } else if (t.hasAttribute('data-today')) pick(kind === 'month' ? td.slice(0, 7) : td);
        else if (t.hasAttribute('data-clear')) pick('');
      });

      body.addEventListener('keydown', (e) => {
        const t = e.target;
        let next = null;
        if (t.classList.contains('cal-day')) {
          const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
          if (step) next = addDays(cursor, step);
          else if (e.key === 'PageUp' || e.key === 'PageDown') next = clampDay(addMonths(cursor.slice(0, 7), e.key === 'PageUp' ? -1 : 1), Number(cursor.slice(8)));
        } else if (t.classList.contains('cal-month')) {
          const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key];
          if (step) next = `${addMonths(cursor.slice(0, 7), step)}-01`;
        }
        if (next) {
          e.preventDefault();
          cursor = next;
          draw();
        }
      });
      draw(isMobile() ? null : undefined);
    },
    { title: kind === 'month' ? 'Escolher mês' : 'Escolher data', minWidth: 296, cls: 'pop-cal' },
  );
}

/* ---------- Aplicação automática ---------- */
function enhanceIn(root) {
  if (!root.querySelectorAll) return;
  if (root.matches?.('select')) enhanceSelect(root);
  if (root.matches?.('input[type=date], input[type=month]')) enhanceDate(root);
  root.querySelectorAll('select').forEach(enhanceSelect);
  root.querySelectorAll('input[type=date], input[type=month]').forEach(enhanceDate);
}

export function initPickers() {
  enhanceIn(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) enhanceIn(n);
  }).observe(document.body, { childList: true, subtree: true });
}
