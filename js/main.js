import { openDB, deleteDB } from './lib/idb.js';
import { initClock, today, shiftDays, resetClock, clockOffset } from './lib/clock.js';
import { initHLC } from './lib/hlc.js';
import { createKey, changePass } from './lib/crypto.js';
import { uid, esc, fmtDayLong, addDays, debounce, $ } from './lib/util.js';
import * as store from './core/store.js';
import * as sync from './core/sync.js';
import * as notify from './core/notify.js';
import { seedCategories, seedDemo, simulateDay, resetSimCache } from './core/seed.js';
import { icon, initTips, toast, sheet, confirmDialog, COLORS } from './ui/ui.js';
import { initPickers, popover } from './ui/pickers.js';
import { who } from './state.js';
import * as gate from './views/gate.js';
import { maybeSummary } from './views/summary.js';
import { openTx } from './views/txform.js';
import * as dashboard from './views/dashboard.js';
import * as diary from './views/diary.js';
import * as plan from './views/plan.js';
import * as wallet from './views/wallet.js';
import * as settings from './views/settings.js';
import { app } from './state.js';

app.version = '1.2.2';
const VIEWS = { inicio: dashboard, diario: diary, planejar: plan, carteira: wallet, ajustes: settings };
const NAV = [
  ['inicio', 'Início', 'home'],
  ['diario', 'Diário', 'diary'],
  ['planejar', 'Planejar', 'plan'],
  ['carteira', 'Carteira', 'wallet'],
  ['ajustes', 'Ajustes', 'settings'],
];

let current = null;
let rendered = '';

async function boot() {
  initTips();
  applyTheme(localStorage.getItem('pago.theme') || 'system');
  if (!window.isSecureContext || !crypto.subtle) throw new Error('o Pago precisa ser aberto por HTTPS ou por localhost. Endereços como http://192.168… não liberam a criptografia do navegador. Veja as opções no README, em "Rodar localmente".');
  registerSW();
  app.test = localStorage.getItem('pago.test') === '1';
  initClock(app.test);
  document.documentElement.classList.toggle('is-test', app.test);
  await sync.loadConfig();
  const idb = await openDB(app.test ? 'pago-test' : 'pago');
  app.idb = idb;
  let device = await idb.get('meta', 'device');
  if (!device) await idb.put('meta', (device = uid(6)), 'device');
  initHLC(device);

  if (app.test) return bootTest(idb);

  let hid = await idb.get('meta', 'hid');
  let key = null;
  let fresh = false;

  if (!hid) {
    // Volta de um login por redirecionamento?
    let res = null;
    if (sync.cloudConfigured()) {
      try {
        const u = await sync.currentUser();
        if (u) res = await gate.afterGoogle(u);
      } catch {
        /* sem rede: segue para boas-vindas */
      }
    }
    res ||= await gate.welcome();
    ({ hid, key, fresh } = res);
    Object.assign(app, { hid, wrap: res.wrap, mode: res.mode, me: res.uid, owner: res.owner, user: res.user || null });
    await idb.put('meta', hid, 'hid');
    await idb.put('meta', res.wrap, 'wrap');
    await idb.put('meta', res.mode, 'mode');
    await idb.put('meta', res.uid, 'uid');
    await idb.put('meta', res.owner, 'owner');
    if (localStorage.getItem('pago.requirePass') !== '1') await idb.put('meta', key, 'key');
  } else {
    Object.assign(app, {
      hid,
      wrap: await idb.get('meta', 'wrap'),
      mode: await idb.get('meta', 'mode'),
      me: await idb.get('meta', 'uid'),
      owner: await idb.get('meta', 'owner'),
    });
    if (localStorage.getItem('pago.requirePass') !== '1') key = await idb.get('meta', 'key');
    if (!key) key = await gate.unlock(app.wrap);
  }
  app.key = key;
  store.setMe(app.me);
  const res = await store.initStore(idb, key);
  if (fresh) await seedCategories();

  if (app.mode === 'cloud') await startCloud(idb);
  else await ensureMember();

  gate.closeGate();
  start();
  if (res.rejected) toast(`${res.rejected} registros com falha de integridade foram descartados${app.mode === 'cloud' ? ' e serão baixados de novo' : ''}.`);
}

async function startCloud(idb) {
  try {
    let user = await sync.currentUser();
    if (!user) {
      gate.closeGate();
      user = await gate.signInAgain();
    }
    if (user.uid !== app.me) {
      toast('Conta Google diferente da usada neste aparelho.');
      return;
    }
    app.user = user;
    if (current) route();
    await ensureMember();
    await sync.startSync({ hid: app.hid, uid: app.me, idb });
    sync.getHousehold(app.hid).then((h) => {
      if (h && h.owner !== app.owner) {
        app.owner = h.owner;
        idb.put('meta', h.owner, 'owner');
      }
    }).catch(() => {});
  } catch {
    // Sem rede ou SDK indisponível: o app segue offline com os dados locais.
  }
}

async function ensureMember() {
  const S = store.snapshot();
  const id = `m_${app.me}`;
  if (S.byId.get(id)) return;
  const name = app.me === 'local' ? 'Você' : (app.user?.displayName || 'Membro').split(' ')[0];
  await store.save('member', { uid: app.me, name, color: COLORS[S.member.length % COLORS.length] }, id);
}

async function bootTest(idb) {
  let key = await idb.get('meta', 'key');
  if (!key) {
    ({ key } = await createKey(uid(24)));
    await idb.put('meta', key, 'key');
    await idb.put('meta', 'test', 'hid');
  }
  Object.assign(app, { hid: 'test', mode: 'local', me: 'local', owner: 'local', key });
  store.setMe('local');
  await store.initStore(idb, key);
  if (!store.snapshot().cat.length) {
    document.getElementById('gate').hidden = false;
    document.getElementById('gate').innerHTML = `<div class="gate-card"><h1>Pago</h1><p class="gate-lead">Preparando dados de teste…</p></div>`;
    await ensureMember();
    await seedDemo();
    await idb.put('meta', today(), 'lastSeen');
    gate.closeGate();
  }
  start();
}

/* ---------- Casca do app ---------- */
function shell() {
  document.getElementById('app').innerHTML = `
    <nav class="nav" aria-label="Seções">
      <a class="brand" href="#inicio"><img src="icons/icon.svg" alt="" width="28" height="28"><span>Pago</span></a>
      ${NAV.map(([id, label, ic]) => `<a href="#${id}" data-nav="${id}">${icon(ic)}<span>${label}</span></a>`).join('')}
      <button type="button" class="nav-new" data-new>${icon('plus')}<span>Novo lançamento</span></button>
    </nav>
    <div class="main-col">
      <div class="head">
        ${app.test ? `<div class="testbar" data-testbar></div>` : ''}
        <header class="topbar"><h1 data-title></h1><span class="sync-dot" data-dot title=""></span><button type="button" class="me-btn" data-me aria-label="Conta e tema" aria-haspopup="dialog"></button></header>
      </div>
      <main id="view" tabindex="-1"></main>
    </div>
    <button type="button" class="fab" data-new aria-label="Novo lançamento">${icon('plus')}</button>`;
  document.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => openTx()));
  const dot = $('[data-dot]');
  const L = { synced: 'Sincronizado', syncing: 'Sincronizando', offline: 'Offline: alterações ficam salvas e sobem ao reconectar', error: 'Erro ao sincronizar', denied: 'Sem acesso ao espaço na nuvem', local: 'Somente neste dispositivo' };
  sync.onStatus((s) => {
    const st = app.mode === 'cloud' ? s : 'local';
    dot.dataset.s = st;
    dot.title = L[st] || '';
    dot.setAttribute('aria-label', L[st] || '');
  });
  if (app.test) testbar();
}

function route() {
  if (location.hash === '#novo') {
    history.replaceState(null, '', '#diario');
    setTimeout(() => openTx(), 50);
  }
  const id = location.hash.slice(1) || 'inicio';
  const next = VIEWS[id] ? id : 'inicio';
  const changed = next !== current;
  current = next;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === current));
  $('[data-title]').textContent = VIEWS[current].title;
  const me = $('[data-me]');
  me.hidden = current !== 'inicio';
  if (!me.hidden) me.innerHTML = avatar(28);
  document.title = current === 'inicio' ? 'Pago' : `${VIEWS[current].title}, Pago`;
  render(changed);
  if (changed) window.scrollTo(0, 0);
}

function render(animate = false) {
  const el = document.getElementById('view');
  const y = window.scrollY;
  VIEWS[current].render(el);
  rendered = today();
  if (animate) {
    el.classList.remove('enter');
    void el.offsetWidth;
    el.classList.add('enter');
  } else window.scrollTo(0, y);
}

const rerender = (() => {
  let raf = 0;
  return () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => render(false));
  };
})();

function start() {
  shell();
  initPickers();
  $('[data-me]').addEventListener('click', (e) => meMenu(e.currentTarget));
  app.nav = (r) => (location.hash = r);
  app.refresh = rerender;
  window.addEventListener('hashchange', route);
  store.subscribe(rerender);
  route();
  maybeSummary(app.idb);

  const schedule = debounce(() => notify.writeSchedule(app.idb).catch(() => {}), 4000);
  store.subscribe(schedule);
  schedule();
  setTimeout(() => notify.check(), 2500);
  setInterval(() => notify.check(), 30 * 60000);

  // Virada do dia com o app aberto ou ao voltar para ele.
  const dayCheck = () => {
    if (rendered && rendered !== today()) {
      render(false);
      maybeSummary(app.idb);
    }
  };
  setInterval(dayCheck, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      dayCheck();
      notify.check();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !document.body.classList.contains('has-sheet') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) {
      e.preventDefault();
      openTx();
    }
  });
}

/* ---------- Avatar, tema e saída ---------- */
function avatar(size) {
  const S = store.snapshot();
  const w = who(S, app.me);
  const photo = app.user?.photoURL;
  const initial = `<span class="av-initial" style="--c:${w.color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${esc(((app.user?.displayName || (app.me === 'local' ? '' : w.name)) || 'V').trim()[0].toUpperCase())}</span>`;
  if (!photo) return initial;
  return `<img class="av-img" src="${esc(photo)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer" onerror="this.outerHTML=this.dataset.fb" data-fb="${esc(initial)}">`;
}

function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t;
  else delete root.dataset.theme;
  localStorage.setItem('pago.theme', t);
  const dark = t === 'dark' || (t !== 'light' && !matchMedia('(prefers-color-scheme: light)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0F1217' : '#F5F6F8');
}
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => applyTheme(localStorage.getItem('pago.theme') || 'system'));

function meMenu(anchor) {
  const theme = localStorage.getItem('pago.theme') || 'system';
  const name = app.user?.displayName || (app.test ? 'Modo de teste' : who(store.snapshot(), app.me).name);
  const sub = app.test ? 'Dados fictícios, só neste navegador' : app.mode === 'cloud' ? app.user?.email || 'Conta Google' : 'Somente neste dispositivo';
  const exit = app.test ? ['Sair do modo de teste', 'flask'] : app.mode === 'cloud' ? ['Sair da conta', 'logout'] : ['Bloquear', 'lock'];
  popover(
    anchor,
    (body, close) => {
      body.innerHTML = `<div class="me-menu">
        <div class="me-head">${avatar(44)}<div><b>${esc(name)}</b><span>${esc(sub)}</span></div></div>
        <div class="me-sec"><span>Tema</span>
          <div class="seg small" role="radiogroup" aria-label="Tema">${[['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Escuro']]
            .map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === theme}" class="${v === theme ? 'on' : ''}" data-theme-opt="${v}">${l}</button>`)
            .join('')}</div></div>
        <button type="button" class="me-item${app.mode === 'cloud' && !app.test ? ' danger-text' : ''}" data-exit>${icon(exit[1])}<span>${exit[0]}</span></button>
      </div>`;
      body.querySelectorAll('[data-theme-opt]').forEach((b) =>
        b.addEventListener('click', () => {
          applyTheme(b.dataset.themeOpt);
          body.querySelectorAll('[data-theme-opt]').forEach((x) => {
            x.classList.toggle('on', x === b);
            x.setAttribute('aria-checked', x === b);
          });
          render(false);
        }),
      );
      body.querySelector('[data-exit]').addEventListener('click', async () => {
        close(false);
        if (app.test) return app.actions.toggleTest();
        if (app.mode !== 'cloud') return app.actions.lock();
        if (await confirmDialog('Sair da conta neste dispositivo? Os dados locais deste aparelho serão apagados; na nuvem continuam salvos.', { ok: 'Sair', danger: true })) app.actions.signOut();
      });
      setTimeout(() => body.querySelector('[data-theme-opt].on')?.focus({ preventScroll: true }), 0);
    },
    { title: 'Conta', minWidth: 280, cls: 'pop-me' },
  );
}

/* ---------- Modo de teste: avançar dias ---------- */
function testbar() {
  const bar = $('[data-testbar]');
  const draw = () => {
    bar.innerHTML = `<span class="tb-label">${icon('flask')}Teste<b>${fmtDayLong(today())}</b>${clockOffset() ? `<em>+${clockOffset()} d</em>` : ''}</span>
      <div class="tb-actions">
        <label class="tb-sim"><input type="checkbox" data-sim ${localStorage.getItem('pago.sim') !== '0' ? 'checked' : ''}>Simular uso</label>
        <button type="button" data-adv="1">+1 dia</button><button type="button" data-adv="7">+7</button><button type="button" data-adv="30">+30</button>
        <button type="button" data-real>Hoje real</button><button type="button" data-sum>Resumo</button>
      </div>`;
    bar.querySelector('[data-sim]').onchange = (e) => localStorage.setItem('pago.sim', e.target.checked ? '1' : '0');
    bar.querySelectorAll('[data-adv]').forEach((b) => (b.onclick = () => advance(Number(b.dataset.adv))));
    bar.querySelector('[data-real]').onclick = async () => {
      resetClock();
      await app.idb.put('meta', today(), 'lastSeen');
      draw();
      render(false);
    };
    bar.querySelector('[data-sum]').onclick = () => import('./views/summary.js').then((m) => m.showSummary(addDays(today(), -7), addDays(today(), -1)));
  };
  const advance = async (n) => {
    bar.classList.add('busy');
    const from = today();
    if (localStorage.getItem('pago.sim') !== '0') {
      resetSimCache();
      for (let i = 0; i < n; i++) await simulateDay(addDays(from, i));
    }
    shiftDays(n);
    draw();
    render(false);
    bar.classList.remove('busy');
    maybeSummary(app.idb);
  };
  draw();
}

/* ---------- Ações globais (usadas em Ajustes) ---------- */
app.actions = {
  async connectGoogle() {
    try {
      const user = await sync.signIn();
      if (!user) return;
      const home = await sync.userHome(user.uid);
      if (home && home !== app.hid) {
        const ok = await confirmDialog('Esta conta Google já participa de outro espaço. Entrar nele substitui os dados deste aparelho. Exporte um backup antes, se quiser mantê-los.', { ok: 'Entrar no espaço existente', danger: true });
        if (!ok) return sync.signOut();
        app.idb.close?.();
        await deleteDB('pago');
        location.reload();
        return;
      }
      if (!home) await sync.createHousehold(app.hid, app.wrap, user.uid);
      const local = store.get('m_local');
      if (local) await store.remove('m_local');
      Object.assign(app, { mode: 'cloud', me: user.uid, owner: user.uid, user });
      await store.claimLocal(user.uid);
      await app.idb.put('meta', 'cloud', 'mode');
      await app.idb.put('meta', user.uid, 'uid');
      await app.idb.put('meta', user.uid, 'owner');
      await ensureMember();
      await sync.startSync({ hid: app.hid, uid: app.me, idb: app.idb });
      toast('Conta conectada. Os dados estão sendo enviados para a nuvem.');
      rerender();
    } catch (e) {
      toast('Não foi possível conectar: ' + (e.message || e.code));
    }
  },
  async signOut() {
    await sync.signOut();
    app.idb.close();
    await deleteDB('pago');
    location.hash = '';
    location.reload();
  },
  async lock() {
    await app.idb.del('meta', 'key');
    location.reload();
  },
  async setRequirePass(on) {
    localStorage.setItem('pago.requirePass', on ? '1' : '0');
    if (on) await app.idb.del('meta', 'key');
    else await app.idb.put('meta', app.key, 'key');
    toast(on ? 'A senha será pedida a cada abertura' : 'Este aparelho abre sem pedir a senha');
  },
  changePass() {
    sheet({
      title: 'Alterar senha do espaço',
      body: `<form class="form" data-f>
        <label class="field"><span>Senha atual</span><input name="a" type="password" required autocomplete="current-password"></label>
        <label class="field"><span>Nova senha</span><input name="b" type="password" minlength="8" required autocomplete="new-password"></label>
        <label class="field"><span>Repita a nova senha</span><input name="c" type="password" required autocomplete="new-password"></label>
        <p class="form-meta">${app.mode === 'cloud' ? 'Os outros membros vão usar a nova senha ao entrar em um aparelho novo. Os aparelhos já desbloqueados continuam funcionando.' : 'A senha protege os dados deste aparelho.'}</p>
        <div class="sheet-actions"><span></span><button class="btn primary">Alterar senha</button></div></form>`,
      onMount(el, close) {
        el.querySelector('[data-f]').onsubmit = async (e) => {
          e.preventDefault();
          const f = e.target;
          if (f.b.value !== f.c.value) return toast('As senhas novas não conferem.');
          try {
            const wrap = await changePass(f.a.value, f.b.value, app.wrap);
            if (app.mode === 'cloud') await sync.updateWrap(app.hid, wrap);
            app.wrap = wrap;
            await app.idb.put('meta', wrap, 'wrap');
            close();
            toast('Senha alterada');
          } catch (ex) {
            toast(ex.code === 'bad-pass' ? 'Senha atual incorreta.' : 'Não foi possível alterar. Verifique a conexão.');
          }
        };
      },
    });
  },
  toggleTest() {
    localStorage.setItem('pago.test', app.test ? '0' : '1');
    location.hash = '';
    location.reload();
  },
  async resetTest() {
    app.idb.close();
    await deleteDB('pago-test');
    resetClock();
    location.reload();
  },
};

/* ---------- Service worker ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller)
          toast('Nova versão disponível', { action: 'Atualizar', onAction: () => w.postMessage('skip'), ms: 8000 });
      });
    });
  });
  let reloaded = !navigator.serviceWorker.controller; // primeira instalação não recarrega
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('gate').hidden = false;
  document.getElementById('gate').innerHTML = `<div class="gate-card"><h1>Pago</h1><p class="gate-lead">Não foi possível abrir o app: ${esc(e.message || e)}</p><button class="btn primary wide" onclick="location.reload()">Tentar de novo</button></div>`;
});
