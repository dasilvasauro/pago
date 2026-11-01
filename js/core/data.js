import * as store from './store.js';
import { monthStats, obligations, position, walletName, planMonthOf, cardDue, cardRef } from './domain.js';
import { today, nowMs } from '../lib/clock.js';
import { METHODS } from './methods.js';
import { esc, money, ymOf, addMonths, addDays, fmtMonth, fmtDate, pad, clampDay } from '../lib/util.js';

function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- Backup completo (JSON legível) ---------- */
export function exportBackup() {
  const records = store.allRecords().map((r) => (r.del ? { id: r.id, type: r.type, u: r.u, by: r.by, del: true } : { id: r.id, type: r.type, data: r.data, u: r.u, by: r.by, cb: r.cb, ca: r.ca }));
  const doc = { app: 'pago', version: 1, exportedAt: new Date(nowMs()).toISOString(), records };
  download(`pago-backup-${today()}.json`, JSON.stringify(doc), 'application/json');
}

export async function importBackup(file) {
  const doc = JSON.parse(await file.text());
  if (doc.app !== 'pago' || !Array.isArray(doc.records)) throw new Error('Arquivo não é um backup do Pago.');
  return store.importPlain(doc.records);
}

/* ---------- CSV do mês ---------- */
const TYPE = { saida: 'Saída', entrada: 'Entrada', transf: 'Transferência', ajuste: 'Ajuste' };
export function exportCSV(ym) {
  const S = store.snapshot();
  const rows = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Forma', 'Contato', 'Origem', 'Destino', 'Valor', 'Parcelas']];
  const num = (c) => (c / 100).toFixed(2).replace('.', ',');
  for (const t of S.tx.filter((t) => t.date.startsWith(ym))) {
    const sign = t.type === 'saida' ? -1 : 1;
    rows.push([fmtDate(t.date), TYPE[t.type], t.desc || '', S.byId.get(t.categoryId)?.name || '', METHODS[t.method] || '', t.contact || '', walletName(S, t.from), walletName(S, t.to), num(sign * t.amount), t.installments > 1 ? t.installments : '']);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  download(`pago-${ym}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8');
}

/* ---------- Relatório do mês ----------
   Abre dentro do próprio app (sem nova janela, que travava o PWA no celular).
   Imprimir usa a impressão do navegador só com o relatório; Baixar gera um .html independente. */
const REPORT_CSS = `
  .rep{font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;background:#fff;max-width:760px;margin:0 auto;padding:28px 24px 40px}
  .rep h1{font-size:22px;margin:0 0 4px} .rep h2{font-size:14px;margin:28px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
  .rep p.s{color:#666;margin:0 0 16px} .rep table{width:100%;border-collapse:collapse}
  .rep td,.rep th{padding:5px 4px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
  .rep th{font-weight:600;color:#555;font-size:12px} .rep .r{text-align:right;white-space:nowrap}
  .rep .neg{color:#b42318} .rep .pos{color:#067647} .rep small{color:#666}
  .rep .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0 24px}`;

export function openReport(ym) {
  const S = store.snapshot();
  const td = today();
  const start = `${ym}-01`;
  const end = addDays(`${addMonths(ym, 1)}-01`, -1);
  const last = end < td ? end : td;
  const a = position(S, addDays(start, -1));
  const b = position(S, last);
  const ms = monthStats(S, ym);
  const obs = obligations(S, ym, ym, td);
  const cats = [...ms.byCat.entries()].sort((x, y) => y[1] - x[1]);
  const txs = S.tx.filter((t) => t.date.startsWith(ym));
  const row = (l, v) => `<tr><td>${esc(l)}</td><td class="r">${v}</td></tr>`;
  const inner = `<article class="rep">
  <h1>${fmtMonth(ym)}</h1><p class="s">Relatório gerado em ${fmtDate(td)}${last < end ? `, parcial até ${fmtDate(last)}` : ''}.</p>
  <div class="grid">
    <div><h2>Resultado</h2><table>${row('Entradas', money(ms.income))}${row('Saídas', money(ms.expense))}${row('Resultado', `<b class="${ms.result < 0 ? 'neg' : 'pos'}">${money(ms.result)}</b>`)}</table></div>
    <div><h2>Dívida</h2><table>${row('No início do mês', money(a.debt))}${row(last < end ? 'Hoje' : 'No fim do mês', money(b.debt))}${row('Variação', `<b class="${b.debt > a.debt ? 'neg' : 'pos'}">${money(b.debt - a.debt)}</b>`)}${row('Patrimônio líquido', money(b.net))}</table></div>
  </div>
  <h2>Gastos por categoria</h2><table>${cats.map(([id, v]) => row(S.byId.get(id)?.name || 'Sem categoria', `${money(v)} <small>(${ms.expense ? Math.round((v / ms.expense) * 100) : 0}%)</small>`)).join('') || '<tr><td>Nenhuma saída.</td></tr>'}</table>
  <h2>Compromissos</h2><table><tr><th>Vencimento</th><th>Descrição</th><th>Situação</th><th class="r">Valor</th></tr>
  ${obs.map((o) => `<tr><td>${fmtDate(o.date)}</td><td>${esc(o.title)}</td><td>${o.paid ? (o.dir === 'in' ? 'Recebido' : 'Pago') : o.date < td ? 'Atrasado' : 'Pendente'}</td><td class="r">${money(o.amount)}</td></tr>`).join('')}</table>
  <h2>Lançamentos (${txs.length})</h2><table><tr><th>Data</th><th>Descrição</th><th>Forma</th><th>Conta</th><th class="r">Valor</th></tr>
  ${txs.map((t) => `<tr><td>${fmtDate(t.date)}</td><td>${esc(t.desc || S.byId.get(t.categoryId)?.name || TYPE[t.type])}${t.contact ? `<br><small>${t.type === 'entrada' ? 'de' : 'para'} ${esc(t.contact)}</small>` : ''}</td><td>${esc(METHODS[t.method] || '')}</td><td>${esc(t.type === 'transf' ? `${walletName(S, t.from)} para ${walletName(S, t.to)}` : walletName(S, t.from || t.to))}</td><td class="r ${t.type === 'saida' ? 'neg' : t.type === 'entrada' ? 'pos' : ''}">${t.type === 'saida' ? '−' : ''}${money(Math.abs(t.amount))}</td></tr>`).join('')}</table>
  </article>`;

  const standalone = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pago, ${fmtMonth(ym)}</title><style>body{margin:0;background:#fff}${REPORT_CSS}</style></head><body>${inner}</body></html>`;
  document.getElementById('report')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'report';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-label', `Relatório de ${fmtMonth(ym)}`);
  wrap.innerHTML = `<style>${REPORT_CSS}</style>
    <div class="rep-bar">
      <button type="button" class="btn small ghost" data-close>Fechar</button>
      <span></span>
      <button type="button" class="btn small ghost" data-dl>Baixar</button>
      <button type="button" class="btn small primary" data-print>Imprimir ou PDF</button>
    </div>
    <div class="rep-scroll">${inner}</div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('has-report');
  const close = () => {
    wrap.remove();
    document.body.classList.remove('has-report');
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  wrap.querySelector('[data-close]').onclick = close;
  wrap.querySelector('[data-dl]').onclick = () => download(`pago-relatorio-${ym}.html`, standalone, 'text/html');
  wrap.querySelector('[data-print]').onclick = () => {
    try {
      window.print();
    } catch {
      download(`pago-relatorio-${ym}.html`, standalone, 'text/html');
    }
  };
}

/* ---------- Lembretes para o calendário (.ics) ----------
   Importado no Google Agenda, avisa mesmo com o app fechado. */
export function exportICS() {
  const S = store.snapshot();
  const td = today();
  const stamp = new Date(nowMs()).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const d8 = (iso) => iso.replace(/-/g, '');
  const escI = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c);
  const ev = [];
  const alarm = 'BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Vencimento\r\nTRIGGER:-PT15H\r\nEND:VALARM';
  const push = (uid, date, title, rrule) =>
    ev.push(`BEGIN:VEVENT\r\nUID:${uid}@pago\r\nDTSTAMP:${stamp}\r\nDTSTART;VALUE=DATE:${d8(date)}\r\nDTEND;VALUE=DATE:${d8(addDays(date, 1))}\r\nSUMMARY:${escI(title)}\r\n${rrule ? rrule + '\r\n' : ''}${alarm}\r\nEND:VEVENT`);
  const ym = ymOf(td);
  for (const b of S.bill) {
    if (b.active === false) continue;
    const startYM = b.startMonth > ym ? b.startMonth : ym;
    const until = b.endMonth ? `;UNTIL=${d8(clampDay(b.endMonth, b.day))}` : '';
    push(`b-${b.id}`, clampDay(startYM, b.day), `${b.dir === 'in' ? 'Receber' : 'Pagar'}: ${b.name}`, `RRULE:FREQ=MONTHLY;BYMONTHDAY=${Math.min(b.day, 28)}${until}`);
  }
  for (const p of S.plan) {
    if (p.down > 0 && p.downDate && p.downDate >= td) push(`p-${p.id}-entrada`, p.downDate, `Pagar: entrada ${p.name}`);
    if (p.billId) continue;
    for (let k = (p.paidBefore || 0) + 1; k <= p.n; k++) {
      const m = planMonthOf(p, k);
      if (m < ym) continue;
      push(`p-${p.id}-${k}`, clampDay(m, p.day), `Pagar: ${p.name} ${k}/${p.n}`);
    }
  }
  for (const c of S.card) {
    if (c.kind !== 'credito' || c.archived) continue;
    push(`c-${c.id}`, cardDue(c, cardRef(c, td)), `Pagar: fatura ${c.name}`, `RRULE:FREQ=MONTHLY;BYMONTHDAY=${Math.min(c.dueDay, 28)}`);
  }
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Pago//PT-BR\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:Pago\r\n${ev.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
  download('pago-lembretes.ics', ics, 'text/calendar');
}

/* ---------- Compactação de meses antigos ----------
   Lançamentos de meses anteriores ao limite viram um único registro "archive" por mês
   (comprimido e cifrado). Na nuvem, isso troca centenas de documentos por um. */
export async function compact(keepMonths) {
  const S = store.snapshot();
  const cutoff = addMonths(ymOf(today()), -keepMonths);
  const byMonth = new Map();
  for (const t of S.tx) {
    if (t._ar) continue;
    const m = ymOf(t.date);
    if (m >= cutoff) continue;
    (byMonth.get(m) || byMonth.set(m, []).get(m)).push(t);
  }
  let moved = 0;
  for (const [m, list] of byMonth) {
    const id = `arc_${m}`;
    const existing = store.get(id);
    const txs = [...(existing?.txs || [])];
    for (const t of list) {
      const { _ar, _u, _by, ...rest } = t;
      txs.push(rest);
    }
    txs.sort((a, b) => (a.date < b.date ? -1 : 1));
    await store.save('archive', { month: m, txs }, id);
    for (const t of list) await store.remove(t.id);
    moved += list.length;
  }
  return { months: byMonth.size, moved };
}

export function storageEstimate() {
  return navigator.storage?.estimate?.() || Promise.resolve(null);
}

export { pad };
