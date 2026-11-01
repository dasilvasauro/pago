import { money, moneyShort, fmtDay, parseISO } from '../lib/util.js';

// lineChart(host, { points:[{d, debt, net}], lines:[{key,label,cls}], animate })
export function lineChart(host, { points, lines, animate = false }) {
  host.innerHTML = '';
  if (points.length < 2) {
    host.innerHTML = `<p class="chart-empty">O gráfico aparece a partir do segundo dia de uso.</p>`;
    return;
  }
  const W = Math.max(280, host.clientWidth || 600);
  const H = host.clientHeight || 220;
  const pad = { l: 8, r: 8, t: 14, b: 24 };
  const vals = points.flatMap((p) => lines.map((l) => p[l.key]));
  let min = Math.min(0, ...vals);
  let max = Math.max(...vals);
  if (max === min) max = min + 100;
  const span = max - min;
  max += span * 0.08;
  if (min < 0) min -= span * 0.08;
  const t0 = parseISO(points[0].d).getTime();
  const t1 = parseISO(points[points.length - 1].d).getTime();
  const X = (d) => pad.l + ((parseISO(d).getTime() - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);

  // Curva suave (monotônica simples) para não "inventar" picos.
  const path = (key) => {
    const pts = points.map((p) => [X(p.d), Y(p[key])]);
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      d += ` C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    }
    return d;
  };

  const grid = [0, 0.5, 1].map((k) => min + (max - min) * k);
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  const main = lines[0];
  const mainPath = path(main.key);
  const area = `${mainPath} L${X(points[points.length - 1].d).toFixed(1)},${(H - pad.b).toFixed(1)} L${X(points[0].d).toFixed(1)},${(H - pad.b).toFixed(1)} Z`;
  const mid = points[Math.floor(points.length / 2)].d;

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Evolução de ${main.label.toLowerCase()}">
    <defs>
      <linearGradient id="${gid}l" x1="0" x2="1"><stop offset="0" stop-color="var(--g1)"/><stop offset="1" stop-color="var(--g2)"/></linearGradient>
      <linearGradient id="${gid}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--g2)" stop-opacity=".18"/><stop offset="1" stop-color="var(--g2)" stop-opacity="0"/></linearGradient>
      <filter id="${gid}f" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="6"/></filter>
    </defs>
    ${grid.map((v) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ylab" x="${pad.l + 2}" y="${(Y(v) - 5).toFixed(1)}">${moneyShort(Math.round(v))}</text>`).join('')}
    ${min < 0 ? `<line class="zero" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(0)}" y2="${Y(0)}"/>` : ''}
    <path d="${area}" fill="url(#${gid}a)" class="area"/>
    ${lines.slice(1).map((l) => `<path d="${path(l.key)}" class="line ${l.cls}"/>`).join('')}
    <path d="${mainPath}" class="glow" stroke="url(#${gid}l)" filter="url(#${gid}f)"/>
    <path d="${mainPath}" class="line main${animate ? ' draw' : ''}" stroke="url(#${gid}l)" pathLength="1"/>
    <text class="xlab" x="${pad.l}" y="${H - 6}">${fmtDay(points[0].d)}</text>
    <text class="xlab" x="${X(mid)}" y="${H - 6}" text-anchor="middle">${fmtDay(mid)}</text>
    <text class="xlab" x="${W - pad.r}" y="${H - 6}" text-anchor="end">${fmtDay(points[points.length - 1].d)}</text>
    <g class="cross" opacity="0"><line y1="${pad.t}" y2="${H - pad.b}"/>${lines.map((l) => `<circle r="4" class="dot ${l.cls}"/>`).join('')}</g>
  </svg><div class="chart-read" hidden></div>`;

  const svg = host.querySelector('svg');
  const cross = svg.querySelector('.cross');
  const read = host.querySelector('.chart-read');
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W;
    let best = 0;
    let bd = Infinity;
    points.forEach((p, i) => {
      const dx = Math.abs(X(p.d) - x);
      if (dx < bd) {
        bd = dx;
        best = i;
      }
    });
    const p = points[best];
    const px = X(p.d);
    cross.setAttribute('opacity', '1');
    cross.querySelector('line').setAttribute('x1', px);
    cross.querySelector('line').setAttribute('x2', px);
    cross.querySelectorAll('circle').forEach((c, i) => {
      c.setAttribute('cx', px);
      c.setAttribute('cy', Y(p[lines[i].key]));
    });
    read.hidden = false;
    read.innerHTML = `<b>${fmtDay(p.d)}</b>${lines.map((l) => `<span class="${l.cls}">${l.label}: ${money(p[l.key])}</span>`).join('')}`;
    const left = (px / W) * r.width;
    read.style.left = Math.min(Math.max(0, left - read.offsetWidth / 2), r.width - read.offsetWidth) + 'px';
  };
  const leave = () => {
    cross.setAttribute('opacity', '0');
    read.hidden = true;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
}

/* ---------- Barras por dia (Diário) ----------
   days: [{ d, v, inc }]  v = altura da barra; inc = entradas do dia (ponto verde na base).
   Tocar ou arrastar percorre os dias; soltar seleciona. Setas do teclado também navegam.
   describe(day|null) devolve o HTML da leitura acima do gráfico. */
export function dayBars(host, { days, selected, today, onSelect, describe }) {
  const W = Math.max(280, host.clientWidth || 600);
  const H = 128;
  const pad = { t: 8, b: 22 };
  const n = days.length;
  const slot = W / n;
  const bw = Math.max(3, Math.min(18, slot * 0.62));
  const max = Math.max(1, ...days.map((x) => x.v));
  const base = H - pad.b;
  const h = (v) => (v > 0 ? Math.max(3, (v / max) * (base - pad.t)) : 0);
  const labels = new Set([1, 8, 15, 22, n]);
  let hover = days.findIndex((x) => x.d === selected);

  host.innerHTML = `<div class="dc-read" aria-live="polite"></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" tabindex="0" role="slider" aria-label="Dias do mês" aria-valuemin="1" aria-valuemax="${n}">
      <defs><linearGradient id="dcg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--g1)"/><stop offset="1" stop-color="var(--g2)"/></linearGradient></defs>
      <line class="dc-base" x1="0" x2="${W}" y1="${base}" y2="${base}"/>
      ${days
        .map((x, i) => {
          const cx = i * slot + slot / 2;
          const bh = h(x.v);
          const cls = ['dc-bar', x.d > today && 'future', x.d === today && 'today'].filter(Boolean).join(' ');
          return `<g data-i="${i}">
            <rect class="dc-hit" x="${(i * slot).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}"/>
            <rect class="${cls}" x="${(cx - bw / 2).toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="${Math.min(4, bw / 2).toFixed(1)}"/>
            ${x.inc > 0 ? `<circle class="dc-inc" cx="${cx.toFixed(1)}" cy="${base + 6}" r="2.6"/>` : ''}
            ${labels.has(i + 1) ? `<text class="dc-lab" x="${cx.toFixed(1)}" y="${H - 3}" text-anchor="middle">${i + 1}</text>` : ''}
          </g>`;
        })
        .join('')}
    </svg>`;

  const svg = host.querySelector('svg');
  const read = host.querySelector('.dc-read');
  const groups = [...svg.querySelectorAll('g[data-i]')];
  const show = (i) => {
    groups.forEach((g, j) => g.classList.toggle('on', j === i));
    groups.forEach((g, j) => g.classList.toggle('sel', days[j].d === selected));
    read.innerHTML = describe(i >= 0 ? days[i].d : null);
    if (i >= 0) svg.setAttribute('aria-valuenow', i + 1);
  };
  show(hover);

  const idxAt = (clientX) => {
    const r = svg.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) / r.width) * n)));
  };
  let down = false;
  let moved = false;
  let startI = -1;
  svg.addEventListener('pointerdown', (e) => {
    down = true;
    moved = false;
    startI = idxAt(e.clientX);
    hover = startI;
    show(hover);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!down && e.pointerType !== 'mouse') return;
    const i = idxAt(e.clientX);
    if (i !== hover) {
      hover = i;
      if (down) moved = true;
      show(hover);
    }
  });
  const end = () => {
    if (!down) return;
    down = false;
    const d = days[hover]?.d;
    // Tocar de novo no dia já selecionado volta ao mês inteiro.
    onSelect(!moved && d === selected ? null : d);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', () => {
    down = false;
    show(days.findIndex((x) => x.d === selected));
  });
  svg.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !down) show(days.findIndex((x) => x.d === selected));
  });
  svg.addEventListener('keydown', (e) => {
    let i = days.findIndex((x) => x.d === selected);
    if (e.key === 'ArrowRight') i = Math.min(n - 1, i < 0 ? 0 : i + 1);
    else if (e.key === 'ArrowLeft') i = Math.max(0, i < 0 ? n - 1 : i - 1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = n - 1;
    else if (e.key === 'Escape' && selected) return onSelect(null);
    else return;
    e.preventDefault();
    onSelect(days[i].d);
  });
}
