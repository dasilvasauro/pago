// Adiamento do aviso de contas atrasadas na tela inicial (e das notificações de atraso).
// Guarda até quando adiar e quais atrasos estavam na tela: um atraso novo faz o aviso voltar.
import { nowMs } from '../lib/clock.js';

const KEY = 'pago.lateSnooze';
export const HOUR = 3600000;

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

export function snoozeLate(ms, keys) {
  localStorage.setItem(KEY, JSON.stringify({ until: nowMs() + ms, keys }));
}

export function lateSnoozed(keys) {
  const s = read();
  if (!s || nowMs() >= s.until) return false;
  return keys.every((k) => s.keys.includes(k));
}

export const snoozeEndsIn = () => Math.max(0, (read()?.until || 0) - nowMs());
