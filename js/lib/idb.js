// IndexedDB mínimo: records (registros cifrados), outbox (ids pendentes de envio), meta (chave/valor).
function req(r) {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function done(t) {
  return new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export function openDB(name) {
  return new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('records', { keyPath: 'id' });
      db.createObjectStore('outbox', { keyPath: 'id' });
      db.createObjectStore('meta');
    };
    r.onsuccess = () => res(wrap(r.result));
    r.onerror = () => rej(r.error);
  });
}

export const deleteDB = (name) => req(indexedDB.deleteDatabase(name));

function wrap(db) {
  const os = (s, mode = 'readonly') => db.transaction(s, mode).objectStore(s);
  return {
    get: (s, k) => req(os(s).get(k)),
    all: (s) => req(os(s).getAll()),
    keys: (s) => req(os(s).getAllKeys()),
    put: (s, v, k) => req(os(s, 'readwrite').put(v, k)),
    del: (s, k) => req(os(s, 'readwrite').delete(k)),
    clear: (s) => req(os(s, 'readwrite').clear()),
    delMany(s, keys) {
      const t = db.transaction(s, 'readwrite');
      const o = t.objectStore(s);
      for (const k of keys) o.delete(k);
      return done(t);
    },
    // Grava registros e marca no outbox de forma atômica.
    write(rows, outboxIds = [], dropOutbox = []) {
      const t = db.transaction(['records', 'outbox'], 'readwrite');
      const r = t.objectStore('records');
      const o = t.objectStore('outbox');
      for (const row of rows) r.put(row);
      for (const id of outboxIds) o.put({ id });
      for (const id of dropOutbox) o.delete(id);
      return done(t);
    },
    removeRecords(ids) {
      const t = db.transaction(['records', 'outbox'], 'readwrite');
      for (const id of ids) {
        t.objectStore('records').delete(id);
        t.objectStore('outbox').delete(id);
      }
      return done(t);
    },
    close: () => db.close(),
  };
}
