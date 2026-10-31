// Formas de pagamento. A conta ou cartão diz DE ONDE o dinheiro saiu; a forma diz COMO.
// Algumas são implícitas pela carteira (cartão de crédito, débito, voucher, dinheiro);
// numa conta bancária a pessoa escolhe (Pix é o padrão).
export const METHODS = {
  pix: 'Pix',
  boleto: 'Boleto',
  debito: 'Débito',
  credito: 'Crédito',
  auto: 'Débito automático',
  pixauto: 'Pix Automático',
  ted: 'TED',
  dinheiro: 'Dinheiro',
  voucher: 'Voucher',
  outro: 'Outro',
};

// Formas que costumam ter uma pessoa ou estabelecimento do outro lado.
export const WITH_CONTACT = new Set(['pix', 'ted']);

// Formas oferecidas em contas recorrentes e parcelamentos.
export const BILL_METHODS = ['pix', 'boleto', 'auto', 'pixauto', 'credito', 'debito', 'ted', 'dinheiro'];

function kindOf(S, v) {
  if (!v) return null;
  const [k, id] = v.split(':');
  if (k === 'c') return 'credit';
  if (k === 'd') return 'debit';
  return S.byId.get(id)?.kind || null;
}

// Formas possíveis para a combinação tipo + origem/destino (valores no formato "a:ID", "c:ID", "d:ID").
export function methodChoices(S, type, fromV, toV) {
  if (type === 'saida') {
    const k = kindOf(S, fromV);
    if (!k) return [];
    if (k === 'credit') return ['credito', 'pix'];
    if (k === 'debit') return ['debito'];
    if (k === 'voucher') return ['voucher'];
    if (k === 'carteira') return ['dinheiro'];
    return ['pix', 'boleto', 'debito', 'auto', 'pixauto', 'ted', 'outro'];
  }
  if (type === 'entrada') {
    const k = kindOf(S, toV);
    if (!k || k === 'credit') return [];
    if (k === 'voucher') return ['voucher'];
    if (k === 'carteira') return ['dinheiro'];
    return ['pix', 'ted', 'dinheiro', 'outro'];
  }
  if (type === 'transf') {
    const kf = kindOf(S, fromV);
    const kt = kindOf(S, toV);
    if (!kf || kf === 'carteira' || kf === 'credit' || kf === 'divida') return [];
    if (kt === 'credit' || kt === 'divida') return ['pix', 'boleto', 'auto', 'outro'];
    return ['pix', 'ted', 'outro'];
  }
  return [];
}

const LAST = 'pago.lastMethod.';
export function defaultMethod(S, type, fromV, toV, preferred) {
  const ch = methodChoices(S, type, fromV, toV);
  if (!ch.length) return '';
  if (preferred && ch.includes(preferred)) return preferred;
  const key = LAST + type + ':' + kindOf(S, type === 'entrada' ? toV : fromV);
  const last = localStorage.getItem(key);
  return last && ch.includes(last) ? last : ch[0];
}
export function rememberMethod(S, type, fromV, toV, m) {
  if (m) localStorage.setItem(LAST + type + ':' + kindOf(S, type === 'entrada' ? toV : fromV), m);
}

// Rótulo curto para listas: só aparece quando acrescenta informação.
export function methodLabel(t) {
  const m = t.method;
  if (!m) return '';
  if (m === 'pix' && t.from?.k === 'c') return 'Pix no crédito';
  if (m === 'pix' || m === 'ted') {
    if (!t.contact) return METHODS[m];
    if (t.type === 'saida') return `${METHODS[m]} para ${t.contact}`;
    if (t.type === 'entrada') return `${METHODS[m]} de ${t.contact}`;
    return METHODS[m];
  }
  if (['credito', 'debito', 'voucher', 'dinheiro'].includes(m)) return ''; // já dito pela conta ou cartão
  return METHODS[m] || '';
}

// Contatos usados recentemente, mais recentes primeiro.
export function recentContacts(S, limit = 40) {
  const seen = new Set();
  const out = [];
  for (let i = S.tx.length - 1; i >= 0 && out.length < limit; i--) {
    const c = S.tx[i].contact;
    if (!c) continue;
    const k = c.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}
