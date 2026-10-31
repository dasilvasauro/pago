import { today } from './clock.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyz';
export function uid(len = 16) {
  const b = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const x of b) s += ALPHA[x % 36];
  return s;
}

export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/* ---------- Dinheiro (sempre em centavos inteiros) ---------- */
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (c) => BRL.format((c || 0) / 100).replace('-', '−');
export const moneyAbs = (c) => BRL.format(Math.abs(c || 0) / 100);
export const moneySigned = (c) => (c > 0 ? '+' : c < 0 ? '−' : '') + moneyAbs(c);
export function moneyShort(c) {
  const neg = c < 0;
  const v = Math.abs(c) / 100;
  let s;
  if (v >= 1e6) s = (v / 1e6).toFixed(1).replace('.', ',') + ' mi';
  else if (v >= 1e3) s = (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace('.', ',').replace(',0', '') + ' mil';
  else s = v.toFixed(0);
  return (neg ? '−' : '') + 'R$ ' + s;
}
export const fmtInputMoney = (c) =>
  (Math.abs(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Divide um total em n parcelas; o resto de centavos vai para a primeira.
export function splitParts(total, n) {
  n = Math.max(1, n | 0);
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? rem : 0));
}

/* ---------- Datas (strings locais YYYY-MM-DD / YYYY-MM) ---------- */
export const pad = (n) => String(n).padStart(2, '0');
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}
export function addDays(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}
export const ymOf = (s) => s.slice(0, 7);
export function addMonths(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = (((m - 1) % 12) + 12) % 12 + 1;
  return `${y}-${pad(m)}`;
}
export function monthsBetween(a, b) {
  const [y1, m1] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}
export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
export const clampDay = (ym, day) => `${ym}-${pad(Math.min(Math.max(1, day | 0), daysInMonth(ym)))}`;
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);

export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MSHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export function fmtDay(s) {
  const d = parseISO(s);
  return `${d.getDate()} ${MSHORT[d.getMonth()]}`;
}
export function fmtDayLong(s) {
  const d = parseISO(s);
  return `${cap(WD[d.getDay()])}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}
export function fmtDate(s) {
  const d = parseISO(s);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
export function fmtDateHuman(s) {
  const d = parseISO(s);
  return `${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}
export function fmtMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${cap(MONTHS[m - 1])} de ${y}`;
}
export function fmtMonthShort(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MSHORT[m - 1]}/${String(y).slice(2)}`;
}
export function relDay(s, ref = today()) {
  const n = daysBetween(ref, s);
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  return n > 1 ? `em ${n} dias` : `há ${-n} dias`;
}
