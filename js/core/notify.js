// Lembretes de vencimento.
// - Com o app aberto (ou ao abrir): notificação local para o que vence hoje / nos próximos dias.
// - Em segundo plano: onde existe Periodic Background Sync (Chrome/Edge no Android, com o app
//   instalado), o service worker verifica de tempos em tempos. Para isso fica salvo, sem cifra,
//   apenas datas e quantidades (nenhum nome ou valor).
// - Para avisos garantidos com o app fechado em qualquer aparelho: exportar o .ics (Ajustes > Dados).
import * as store from './store.js';
import { obligations } from './domain.js';
import { today } from '../lib/clock.js';
import { money, addDays, ymOf, addMonths } from '../lib/util.js';

const KEY = 'pago.notify';
export const settings = () => JSON.parse(localStorage.getItem(KEY) || '{"on":false,"lead":1}');
export const saveSettings = (s) => localStorage.setItem(KEY, JSON.stringify(s));
export const supported = () => 'Notification' in window && 'serviceWorker' in navigator;

export async function enable() {
  if (!supported()) return false;
  const p = await Notification.requestPermission();
  const s = settings();
  s.on = p === 'granted';
  saveSettings(s);
  if (s.on) await registerPeriodic();
  return s.on;
}

async function registerPeriodic() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!('periodicSync' in reg)) return false;
    const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (st.state !== 'granted') return false;
    await reg.periodicSync.register('pago-reminders', { minInterval: 6 * 3600 * 1000 });
    return true;
  } catch {
    return false;
  }
}

function upcoming(lead) {
  const S = store.snapshot();
  const td = today();
  const ym = ymOf(td);
  return obligations(S, addMonths(ym, -1), addMonths(ym, 1), td).filter((o) => !o.paid && o.date <= addDays(td, lead));
}

// Agenda mínima para o service worker: [{d:'2026-11-05', n:2}]
export async function writeSchedule(idb) {
  const S = store.snapshot();
  const td = today();
  const ym = ymOf(td);
  const counts = new Map();
  for (const o of obligations(S, ym, addMonths(ym, 2), td)) if (!o.paid && o.dir === 'out') counts.set(o.date, (counts.get(o.date) || 0) + 1);
  await idb.put('meta', [...counts].map(([d, n]) => ({ d, n })), 'reminders');
  await idb.put('meta', settings().lead, 'reminderLead');
}

export async function check() {
  const s = settings();
  if (!s.on || !supported() || Notification.permission !== 'granted') return;
  const td = today();
  const seen = JSON.parse(localStorage.getItem(KEY + '.seen') || '{}');
  const list = upcoming(s.lead).filter((o) => seen[o.id] !== td);
  if (!list.length) return;
  const reg = await navigator.serviceWorker.ready;
  const late = list.filter((o) => o.date < td);
  const now = list.filter((o) => o.date === td);
  const soon = list.filter((o) => o.date > td);
  const lines = [];
  if (late.length) lines.push(`Atrasado: ${late.map((o) => o.title).join(', ')}`);
  if (now.length) lines.push(`Hoje: ${now.map((o) => `${o.title} ${money(o.kind === 'invoice' ? o.remaining : o.amount)}`).join(', ')}`);
  if (soon.length) lines.push(`Em breve: ${soon.map((o) => o.title).join(', ')}`);
  await reg.showNotification('Pago', { body: lines.join('\n'), tag: 'pago-due', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png' });
  for (const o of list) seen[o.id] = td;
  localStorage.setItem(KEY + '.seen', JSON.stringify(seen));
}
