// Relógio central. No modo de teste é possível deslocar o "hoje" em dias.
const KEY = 'pago.clockOffset';
let offset = 0;

export function initClock(testMode) {
  offset = testMode ? Number(localStorage.getItem(KEY) || 0) : 0;
}
export const nowMs = () => Date.now() + offset * 86400000;
export function today() {
  const d = new Date(nowMs());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function shiftDays(n) {
  offset += n;
  localStorage.setItem(KEY, String(offset));
}
export function resetClock() {
  offset = 0;
  localStorage.setItem(KEY, '0');
}
export const clockOffset = () => offset;
