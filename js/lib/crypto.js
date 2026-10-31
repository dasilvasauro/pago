// Criptografia do espaço.
// - Uma chave de dados AES-256-GCM aleatória cifra todos os registros.
// - Essa chave é "embrulhada" por outra, derivada da senha do espaço (PBKDF2-SHA256).
// - No dispositivo, a chave é importada como NÃO-EXTRAÍVEL: o código não consegue ler os bytes dela,
//   nem pelo console. O CryptoKey fica guardado no IndexedDB apenas como referência opaca.
// - Cada registro usa o próprio id, versão e marca de exclusão como dados autenticados (AAD):
//   qualquer alteração manual no IndexedDB faz a decifragem falhar e o registro é rejeitado.

const te = new TextEncoder();
const td = new TextDecoder();
const ITER = 600000;

export const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

async function deriveKEK(pass, salt, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', te.encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const importDataKey = (raw) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

async function wrapRaw(pass, raw) {
  const salt = rand(16);
  const iv = rand(12);
  const kek = await deriveKEK(pass, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw));
  return { v: 1, iter: ITER, salt, iv, ct };
}

async function unwrapRaw(pass, wrap) {
  const kek = await deriveKEK(pass, wrap.salt, wrap.iter || ITER);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: wrap.iv }, kek, wrap.ct));
  } catch {
    const e = new Error('Senha incorreta.');
    e.code = 'bad-pass';
    throw e;
  }
}

export async function createKey(pass) {
  const raw = rand(32);
  const wrap = await wrapRaw(pass, raw);
  const key = await importDataKey(raw);
  raw.fill(0);
  return { key, wrap };
}

export async function unlockKey(pass, wrap) {
  const raw = await unwrapRaw(pass, wrap);
  const key = await importDataKey(raw);
  raw.fill(0);
  return key;
}

export async function changePass(oldPass, newPass, wrap) {
  const raw = await unwrapRaw(oldPass, wrap);
  const next = await wrapRaw(newPass, raw);
  raw.fill(0);
  return next;
}

async function pipe(bytes, stream) {
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function seal(key, obj, aad, compress = false) {
  let body = te.encode(JSON.stringify(obj));
  let flag = 0;
  if (compress && typeof CompressionStream !== 'undefined') {
    body = await pipe(body, new CompressionStream('gzip'));
    flag = 1;
  }
  const plain = new Uint8Array(body.length + 1);
  plain[0] = flag;
  plain.set(body, 1);
  const iv = rand(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, plain),
  );
  return { iv, ct };
}

export async function unseal(key, iv, ct, aad) {
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, ct),
  );
  let body = plain.subarray(1);
  if (plain[0] === 1) body = await pipe(body, new DecompressionStream('gzip'));
  return JSON.parse(td.decode(body));
}

// Serialização da "embalagem" da chave para JSON/Firestore.
export const b64 = (u8) => btoa(String.fromCharCode(...u8));
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
