// Service worker do Pago: app disponível offline + lembretes periódicos.
const VERSION = 'pago-v1.2.2';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/badge-96.png',
  'js/main.js',
  'js/state.js',
  'js/firebase-config.js',
  'js/lib/clock.js',
  'js/lib/util.js',
  'js/lib/idb.js',
  'js/lib/crypto.js',
  'js/lib/hlc.js',
  'js/core/store.js',
  'js/core/domain.js',
  'js/core/sync.js',
  'js/core/data.js',
  'js/core/notify.js',
  'js/core/seed.js',
  'js/core/methods.js',
  'js/ui/ui.js',
  'js/ui/chart.js',
  'js/ui/pickers.js',
  'js/views/gate.js',
  'js/views/txform.js',
  'js/views/dashboard.js',
  'js/views/diary.js',
  'js/views/plan.js',
  'js/views/wallet.js',
  'js/views/settings.js',
  'js/views/summary.js',
];
const RUNTIME = 'pago-runtime';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Configuração do Firebase: rede primeiro (para valer assim que o arquivo for alterado), cache se offline.
  if (url.origin === location.origin && url.pathname.endsWith('/js/firebase-config.js')) {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone(); // clonar antes de entregar a resposta
            caches.open(VERSION).then((c) => c.put('js/firebase-config.js', copy));
          }
          return res;
        })
        .catch(() => caches.match('js/firebase-config.js')),
    );
    return;
  }
  // App: cache primeiro, rede como reserva. Uma nova VERSION renova tudo.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() => caches.match('index.html'))),
    );
    return;
  }
  // SDK do Firebase e fontes: usa o cache e atualiza em segundo plano.
  if (url.hostname === 'www.gstatic.com' || url.hostname.startsWith('fonts.')) {
    e.respondWith(
      caches.open(RUNTIME).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res.ok || res.type === 'opaque') c.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
  }
  // Firestore/Auth: sempre rede (não cachear).
});

/* ---------- Lembretes em segundo plano ----------
   Lê do IndexedDB somente a agenda mínima (datas e quantidades), nunca dados cifrados. */
function readMeta(key) {
  return new Promise((resolve) => {
    const r = indexedDB.open('pago', 1);
    r.onerror = () => resolve(null);
    r.onupgradeneeded = () => {
      r.transaction.abort();
      resolve(null);
    };
    r.onsuccess = () => {
      const db = r.result;
      try {
        const g = db.transaction('meta').objectStore('meta').get(key);
        g.onsuccess = () => {
          resolve(g.result);
          db.close();
        };
        g.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    };
  });
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function remind() {
  const list = (await readMeta('reminders')) || [];
  const lead = (await readMeta('reminderLead')) ?? 1;
  const now = new Date();
  const today = iso(now);
  const limit = new Date(now);
  limit.setDate(limit.getDate() + lead);
  const max = iso(limit);
  const due = list.filter((x) => x.d >= today && x.d <= max);
  const todayN = due.filter((x) => x.d === today).reduce((a, x) => a + x.n, 0);
  const soonN = due.filter((x) => x.d > today).reduce((a, x) => a + x.n, 0);
  if (!todayN && !soonN) return;
  const cache = await caches.open(RUNTIME);
  const mark = await cache.match('/__pago-notified');
  if (mark && (await mark.text()) === today) return; // no máximo um aviso por dia
  await cache.put('/__pago-notified', new Response(today));
  const parts = [];
  if (todayN) parts.push(`${todayN} ${todayN === 1 ? 'conta vence' : 'contas vencem'} hoje`);
  if (soonN) parts.push(`${soonN} nos próximos dias`);
  await self.registration.showNotification('Pago', { body: parts.join(', ') + '.', tag: 'pago-due', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png' });
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'pago-reminders') e.waitUntil(remind());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      const c = cs.find((x) => 'focus' in x);
      if (c) return c.focus();
      return self.clients.openWindow('./#planejar');
    }),
  );
});
