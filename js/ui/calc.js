// Calculadora do Pago.
// A conta é uma fita de termos: cada termo tem uma operação (+ − × ÷) e um valor. Termos de
// dinheiro vêm digitados ou do próprio app (saldo, fatura, contas atrasadas...); vários itens
// podem entrar juntos como um termo de soma. Depois de × e ÷ o número digitado é um fator
// (ex.: ÷ 2), não um valor em reais. As operações são feitas na ordem da fita.
// A fita fica salva no aparelho até ser limpa.
import * as store from '../core/store.js';
import { position, balances, cardInfo, lateBills, obligations, planStatus, paidKeys, dueAmount, projection, walletName } from '../core/domain.js';
import { today } from '../lib/clock.js';
import { esc, money, ymOf, fmtMonthShort, sum } from '../lib/util.js';
import { sheet, icon, toast } from './ui.js';

const KEY = 'pago.calc';
const OPS = { '+': '+', '-': '−', '*': '×', '/': '÷' };
const isMul = (op) => op === '*' || op === '/';

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.terms)) return s;
  } catch {
    /* estado inválido */
  }
  return { terms: [], op: '+', input: '' };
}
let st = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(st));
let redraw = null; // atualiza a calculadora aberta

/* ---------- Avaliação ----------
   Da esquerda para a direita, como uma calculadora de mesa e como a fita é lida:
   "Contas − Saldo ÷ 2" divide a diferença por dois. */
export function evaluate(terms) {
  let total = 0;
  terms.forEach((t, i) => {
    const v = t.pct ? (t.op === '*' || t.op === '/' ? t.v / 100 : total * (t.v / 100)) : t.v;
    if (i === 0 && !t.pct) total = t.op === '-' ? -v : v;
    else if (t.op === '+') total += v;
    else if (t.op === '-') total -= v;
    else if (t.op === '*') total *= v;
    else total = v === 0 ? NaN : total / v;
  });
  return total;
}

const parseInput = (s) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
const fmtFactor = (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 6 });

function commitInput(pct = false) {
  if (!st.input) return false;
  const n = parseInput(st.input);
  // Fatores (× ÷) e porcentagens são números puros; o resto é dinheiro em centavos.
  const v = isMul(st.op) || pct ? n : Math.round(n * 100);
  st.terms.push({ op: st.op, v, pct: pct || undefined });
  st.input = '';
  return true;
}

/* ---------- API para o resto do app ----------
   calcAdd({ label, v })                       um valor em centavos
   calcAdd({ label, items: [{ label, v }] })   soma agrupada */
export function calcAdd(term) {
  commitInput();
  const v = term.items ? sum(term.items, (x) => x.v) : term.v;
  const op = isMul(st.op) || !st.terms.length ? '+' : st.op;
  st.terms.push({ op: term.op || op, v, label: term.label, items: term.items });
  st.op = '+';
  save();
  if (redraw && !document.querySelector('.calc')) redraw = null;
  if (redraw) redraw();
  else openCalc();
  toast(`${term.label} adicionado à calculadora`);
}

/* ---------- Interface ---------- */
export function openCalc() {
  if (redraw && document.querySelector('.calc')) return;
  sheet({
    title: 'Calculadora',
    body: `<div class="calc">
      <div class="calc-tape" data-tape></div>
      <div class="calc-entry" data-entry></div>
      <div class="calc-result"><span>Resultado</span><b data-result></b></div>
      <div class="calc-actions">
        <button type="button" class="btn small" data-src>${icon('wallet')}Valores do app</button>
        <button type="button" class="btn small ghost" data-copy>${icon('copy')}Copiar</button>
        <button type="button" class="btn small ghost" data-tx>${icon('plus')}Lançar</button>
      </div>
      <div class="calc-keys" role="group" aria-label="Teclado da calculadora">
        ${[
          ['C', 'clear', 'fn'], ['⌫', 'back', 'fn'], ['%', 'pct', 'fn'], ['÷', '/', 'op'],
          ['7', '7'], ['8', '8'], ['9', '9'], ['×', '*', 'op'],
          ['4', '4'], ['5', '5'], ['6', '6'], ['−', '-', 'op'],
          ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+', 'op'],
          ['00', '00'], ['0', '0'], [',', ','], ['=', '=', 'eq'],
        ]
          .map(([l, k, c]) => `<button type="button" class="key ${c || ''}" data-k="${k}" aria-label="${k === 'back' ? 'Apagar' : k === 'clear' ? 'Limpar tudo' : l}">${l}</button>`)
          .join('')}
      </div>
    </div>`,
    onMount(el) {
      const tape = el.querySelector('[data-tape]');
      const entry = el.querySelector('[data-entry]');
      const result = el.querySelector('[data-result]');
      const draw = () => {
        tape.innerHTML = st.terms.length
          ? st.terms
              .map((t, i) => {
                const val = t.pct ? `${fmtFactor(t.v)}%` : isMul(t.op) ? fmtFactor(t.v) : money(Math.round(t.v));
                return `<div class="calc-line${t.items ? ' group' : ''}">
                  <span class="calc-op">${i === 0 && t.op === '+' ? '' : OPS[t.op]}</span>
                  <span class="calc-lab">${t.label ? esc(t.label) : ''}${t.items ? `<details><summary>${t.items.length} itens</summary>${t.items.map((x) => `<span>${esc(x.label)}<em>${money(x.v)}</em></span>`).join('')}</details>` : ''}</span>
                  <span class="calc-val">${val}</span>
                  <button type="button" class="calc-del" data-del="${i}" aria-label="Remover">${icon('x')}</button>
                </div>`;
              })
              .join('')
          : `<p class="calc-empty">Digite valores ou use Valores do app para trazer saldos, faturas e contas.</p>`;
        tape.scrollTop = tape.scrollHeight;
        const show = st.input || (st.terms.length ? '' : '0');
        const hint = isMul(st.op) ? 'número' : 'reais';
        entry.innerHTML = `<span class="calc-op">${st.terms.length || st.op === '-' ? OPS[st.op] : ''}</span><span class="calc-in">${esc(show)}</span>${st.input || st.terms.length ? `<small>${hint}</small>` : ''}`;
        const preview = [...st.terms];
        if (st.input) preview.push({ op: st.op, v: isMul(st.op) ? parseInput(st.input) : parseInput(st.input) * 100 });
        const r = evaluate(preview);
        result.textContent = Number.isFinite(r) ? money(Math.round(r)) : 'Divisão por zero';
        result.classList.toggle('neg', r < 0);
        save();
      };
      redraw = draw;
      draw();

      const press = (k) => {
        if (/^\d+$/.test(k)) {
          if (st.input.replace(/\D/g, '').length < 12) st.input = (st.input === '0' ? '' : st.input) + k;
        } else if (k === ',') {
          if (!st.input.includes(',')) st.input = (st.input || '0') + ',';
        } else if (k === 'back') {
          if (st.input) st.input = st.input.slice(0, -1);
          else if (st.terms.length) st.terms.pop();
        } else if (k === 'clear') {
          st = { terms: [], op: '+', input: '' };
        } else if (k in OPS) {
          commitInput();
          st.op = k;
        } else if (k === 'pct') {
          commitInput(true);
        } else if (k === '=') {
          commitInput();
        }
        draw();
      };
      el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => press(b.dataset.k)));
      tape.addEventListener('click', (e) => {
        const d = e.target.closest('[data-del]');
        if (!d) return;
        st.terms.splice(Number(d.dataset.del), 1);
        if (st.terms[0]?.op === '*' || st.terms[0]?.op === '/') st.terms[0].op = '+';
        draw();
      });
      const onKey = (e) => {
        if (e.target.closest('input, textarea') || document.querySelector('.pop-wrap')) return;
        const map = { Enter: '=', '=': '=', Backspace: 'back', Delete: 'clear', '.': ',', ',': ',', '%': 'pct', x: '*', X: '*' };
        const k = /^\d$/.test(e.key) ? e.key : e.key in OPS ? e.key : map[e.key];
        if (!k || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        press(k);
      };
      el.addEventListener('keydown', onKey);
      el.tabIndex = -1;
      setTimeout(() => el.focus({ preventScroll: true }), 60);

      el.querySelector('[data-src]').onclick = () => pickSource();
      el.querySelector('[data-copy]').onclick = async () => {
        const r = evaluate(st.terms.concat(st.input ? [{ op: st.op, v: isMul(st.op) ? parseInput(st.input) : parseInput(st.input) * 100 }] : []));
        await navigator.clipboard?.writeText((Math.round(r) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
        toast('Resultado copiado');
      };
      el.querySelector('[data-tx]').onclick = async () => {
        commitInput();
        const r = Math.round(evaluate(st.terms));
        draw();
        if (!r || !Number.isFinite(r)) return toast('Não há resultado para lançar.');
        const { openTx } = await import('../views/txform.js');
        openTx({ amount: Math.abs(r), type: 'saida' });
      };
    },
    onClose: () => (redraw = null),
  });
}

/* ---------- Valores do app ---------- */
function sources() {
  const S = store.snapshot();
  const td = today();
  const bal = balances(S, td);
  const pos = position(S, td);
  const pj = projection(S, td);
  const paid = paidKeys(S);
  const ym = ymOf(td);
  const groups = [];
  groups.push(['Totais', [
    { label: 'Dívida total', v: pos.debt },
    { label: 'Saldo total', v: pos.liquid },
    { label: 'Projeção do fim do mês', v: pj.end },
  ]]);
  const accts = S.acct.filter((a) => !a.archived && a.kind !== 'divida');
  if (accts.length) groups.push(['Contas e carteira', accts.map((a) => ({ label: walletName(S, { k: 'a', id: a.id }), v: bal.get('a:' + a.id) || 0 }))]);
  const cards = S.card.filter((c) => c.kind === 'credito' && !c.archived);
  if (cards.length)
    groups.push(['Cartões', cards.flatMap((c) => {
      const info = cardInfo(S, c, td, bal);
      const out = [];
      if (info.current) out.push({ label: `Fatura ${c.name} (${fmtMonthShort(ymOf(info.current.due))})`, v: info.current.remaining || info.current.amount });
      out.push({ label: `Dívida total ${c.name}`, v: Math.max(0, info.outstanding) });
      return out;
    })]);
  const late = lateBills(S, td);
  if (late.length) groups.push(['Contas atrasadas', late.map((x) => ({ label: `${x.bill.name} ${fmtMonthShort(x.month)}`, v: x.amount }))]);
  const pend = obligations(S, ym, ym, td).filter((o) => o.dir === 'out' && !o.paid && o.date >= td);
  if (pend.length) groups.push(['A pagar neste mês', pend.map((o) => ({ label: `${o.title} (dia ${Number(o.date.slice(8))})`, v: dueAmount(o) }))]);
  const debts = S.acct.filter((a) => !a.archived && a.kind === 'divida');
  const plans = S.plan.map((p) => ({ label: `${p.name}, restante`, v: planStatus(p, paid).remaining })).filter((x) => x.v > 0);
  if (debts.length || plans.length) groups.push(['Dívidas e acordos', [...debts.map((a) => ({ label: a.name, v: Math.max(0, -(bal.get('a:' + a.id) || 0)) })), ...plans]]);
  return groups;
}

function pickSource() {
  const groups = sources();
  let n = 0;
  const flat = [];
  sheet({
    title: 'Valores do app',
    body: `<form class="form" data-f>
      <p class="sheet-text">Marque um ou mais valores. Vários entram juntos como uma soma.</p>
      ${groups
        .map(
          ([g, items]) => `<div class="field"><span>${esc(g)}</span><div class="reneg-list">${items
            .map((x) => {
              flat.push(x);
              return `<label class="reneg-item"><input type="checkbox" data-i="${n++}"><span><b>${esc(x.label)}</b></span><em class="${x.v < 0 ? 'neg' : ''}">${money(x.v)}</em></label>`;
            })
            .join('')}</div></div>`,
        )
        .join('')}
      <div class="sheet-actions"><span data-sel class="form-meta"></span><button class="btn primary">Adicionar</button></div>
    </form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      const sel = () => [...el.querySelectorAll('[data-i]:checked')].map((c) => flat[Number(c.dataset.i)]);
      const upd = () => {
        const s = sel();
        el.querySelector('[data-sel]').textContent = s.length > 1 ? `${s.length} itens, ${money(sum(s, (x) => x.v))}` : '';
      };
      el.querySelectorAll('[data-i]').forEach((c) => c.addEventListener('change', upd));
      f.onsubmit = (e) => {
        e.preventDefault();
        const s = sel();
        if (!s.length) return toast('Marque ao menos um valor.');
        close();
        if (s.length === 1) calcAdd({ label: s[0].label, v: s[0].v });
        else calcAdd({ label: `Soma de ${s.length} itens`, items: s });
      };
    },
  });
}
