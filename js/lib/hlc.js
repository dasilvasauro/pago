// Hybrid Logical Clock: versões comparáveis como texto ("maior vence"),
// robustas a relógios de dispositivos levemente fora de sincronia.
let last = 0;
let counter = 0;
let node = 'x';

const enc = (ms, c) => `${ms.toString(36).padStart(10, '0')}:${c.toString(36).padStart(4, '0')}:${node}`;

export function initHLC(nodeId) {
  node = nodeId;
}

export function tick() {
  const t = Date.now();
  if (t > last) {
    last = t;
    counter = 0;
  } else counter++;
  return enc(last, counter);
}

export function observe(u) {
  if (!u) return;
  const [ms, c] = u.split(':');
  const rm = parseInt(ms, 36);
  const rc = parseInt(c, 36);
  if (rm > last) {
    last = rm;
    counter = rc;
  } else if (rm === last && rc > counter) counter = rc;
}

export const hlcMs = (u) => parseInt(String(u).split(':')[0], 36) || 0;
