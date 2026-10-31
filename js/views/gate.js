// Telas antes do app: escolher modo, entrar com Google, criar ou entrar num espaço, desbloquear.
import * as sync from '../core/sync.js';
import { createKey, unlockKey } from '../lib/crypto.js';
import { uid, esc } from '../lib/util.js';
import { icon } from '../ui/ui.js';

const LOGO = `<svg class="gate-logo" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="gl" x1="0" x2="1"><stop offset="0" stop-color="var(--g1)"/><stop offset="1" stop-color="var(--g2)"/></linearGradient><filter id="gf"><feGaussianBlur stdDeviation="2.4"/></filter></defs><rect width="64" height="64" rx="15" fill="var(--surface-2)"/><path d="M14 41 24 36l7.5 3.3 8.5-11.3 10-5.5" fill="none" stroke="url(#gl)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" filter="url(#gf)" opacity=".8"/><path d="M14 41 24 36l7.5 3.3 8.5-11.3 10-5.5" fill="none" stroke="url(#gl)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

let host;
function screen(html) {
  host = document.getElementById('gate');
  host.hidden = false;
  host.innerHTML = `<div class="gate-card">${LOGO}<h1>Pago</h1>${html}</div>`;
  host.querySelector('input')?.focus();
  return host;
}
const err = (msg) => {
  const e = host.querySelector('.gate-err');
  if (e) {
    e.textContent = msg;
    e.hidden = !msg;
  }
};
const busy = (on) => host.querySelectorAll('button, input').forEach((b) => (b.disabled = on));
export const closeGate = () => {
  const g = document.getElementById('gate');
  g.hidden = true;
  g.innerHTML = '';
};

const passFields = (confirm) => `
  <label class="field"><span>Senha do espaço</span><input name="p1" type="password" autocomplete="${confirm ? 'new-password' : 'current-password'}" minlength="${confirm ? 8 : 1}" required></label>
  ${confirm ? `<label class="field"><span>Repita a senha</span><input name="p2" type="password" autocomplete="new-password" required></label>
  <p class="gate-note">Guarde esta senha. Ela protege os dados e não pode ser recuperada. Quem for usar o mesmo espaço vai precisar dela.</p>` : ''}`;

// Retorna { hid, key, wrap, mode, uid, owner, user, fresh }
export function welcome() {
  return new Promise((resolve) => {
    const h = screen(`
      <p class="gate-lead">Controle de gastos, contas e dívidas, registrado por você, dia a dia.</p>
      <div class="gate-actions">
        ${sync.cloudConfigured() ? `<button type="button" class="btn primary wide" data-google>${googleIcon()}Entrar com Google</button>` : ''}
        <button type="button" class="btn ${sync.cloudConfigured() ? 'ghost' : 'primary'} wide" data-local>Usar só neste dispositivo</button>
      </div>
      <p class="gate-err" hidden></p>
      <button type="button" class="gate-link" data-test>${icon('flask')}Experimentar no modo de teste</button>`);
    h.querySelector('[data-local]').onclick = () => createLocal().then(resolve);
    h.querySelector('[data-test]').onclick = () => {
      localStorage.setItem('pago.test', '1');
      location.reload();
    };
    h.querySelector('[data-google]')?.addEventListener('click', async () => {
      busy(true);
      try {
        const user = await sync.signIn();
        if (!user) return; // redirecionando
        resolve(await afterGoogle(user));
      } catch (e) {
        busy(false);
        err(e.code === 'auth/popup-closed-by-user' ? '' : 'Não foi possível entrar. Verifique a conexão e tente de novo.');
      }
    });
  });
}

export async function afterGoogle(user) {
  const home = await sync.userHome(user.uid);
  if (home) return unlockCloud(user, home);
  return chooseCloud(user);
}

function chooseCloud(user) {
  return new Promise((resolve) => {
    const h = screen(`
      <p class="gate-lead">Olá, ${esc(user.displayName?.split(' ')[0] || '')}. Você ainda não participa de nenhum espaço.</p>
      <div class="gate-actions">
        <button type="button" class="btn primary wide" data-new>Criar um espaço</button>
        <button type="button" class="btn ghost wide" data-join>Entrar com convite</button>
      </div>`);
    h.querySelector('[data-new]').onclick = () => createCloud(user).then(resolve);
    h.querySelector('[data-join]').onclick = () => joinCloud(user).then(resolve);
  });
}

function formScreen(lead, fields, submitLabel, onSubmit, back) {
  return new Promise((resolve) => {
    const h = screen(`<p class="gate-lead">${lead}</p><form class="form" data-f>${fields}<p class="gate-err" hidden></p>
      <button class="btn primary wide">${submitLabel}</button>${back ? `<button type="button" class="gate-link" data-back>Voltar</button>` : ''}</form>`);
    h.querySelector('[data-back]')?.addEventListener('click', () => back().then(resolve));
    h.querySelector('[data-f]').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.p2 && f.p1.value !== f.p2.value) return err('As senhas não conferem.');
      err('');
      busy(true);
      try {
        resolve(await onSubmit(f));
      } catch (ex) {
        busy(false);
        err(ex.code === 'bad-pass' ? 'Senha incorreta.' : ex.message || 'Algo deu errado. Tente de novo.');
      }
    };
  });
}

function createLocal() {
  return formScreen('Crie a senha do espaço. Ela cifra os dados guardados neste aparelho.', passFields(true), 'Criar espaço', async (f) => {
    const { key, wrap } = await createKey(f.p1.value);
    return { hid: uid(20), key, wrap, mode: 'local', uid: 'local', owner: 'local', fresh: true };
  }, welcome);
}

function createCloud(user) {
  return formScreen('Crie a senha do espaço. Os dados são cifrados com ela antes de irem para a nuvem.', passFields(true), 'Criar espaço', async (f) => {
    const { key, wrap } = await createKey(f.p1.value);
    const hid = uid(20);
    await sync.createHousehold(hid, wrap, user.uid);
    return { hid, key, wrap, mode: 'cloud', uid: user.uid, owner: user.uid, user, fresh: true };
  }, () => chooseCloud(user));
}

function joinCloud(user) {
  let joined = null;
  return formScreen(
    'Informe o código de convite e a senha do espaço que recebeu.',
    `<label class="field"><span>Código de convite</span><input name="code" required autocomplete="off" spellcheck="false"></label>${passFields(false)}`,
    'Entrar no espaço',
    async (f) => {
      joined ||= await sync.joinHousehold(f.code.value, user.uid);
      const key = await unlockKey(f.p1.value, joined.wrap);
      return { hid: joined.hid, key, wrap: joined.wrap, mode: 'cloud', uid: user.uid, owner: joined.owner, user, fresh: false };
    },
    () => chooseCloud(user),
  );
}

async function unlockCloud(user, hid) {
  const h = await sync.getHousehold(hid);
  return formScreen(`Bem-vindo de volta, ${esc(user.displayName?.split(' ')[0] || '')}. Informe a senha do espaço.`, passFields(false), 'Desbloquear', async (f) => {
    const key = await unlockKey(f.p1.value, h.wrap);
    return { hid, key, wrap: h.wrap, mode: 'cloud', uid: user.uid, owner: h.owner, user, fresh: false };
  });
}

// Desbloqueio com a chave embrulhada já salva no aparelho.
export function unlock(wrap, extra = '') {
  return formScreen(`Informe a senha do espaço para abrir.${extra}`, passFields(false), 'Desbloquear', async (f) => unlockKey(f.p1.value, wrap));
}

export function signInAgain() {
  return new Promise((resolve) => {
    const h = screen(`<p class="gate-lead">Sua sessão do Google expirou neste aparelho.</p>
      <div class="gate-actions"><button type="button" class="btn primary wide" data-google>${googleIcon()}Entrar com Google</button></div><p class="gate-err" hidden></p>`);
    h.querySelector('[data-google]').onclick = async () => {
      busy(true);
      try {
        const u = await sync.signIn();
        if (u) resolve(u);
      } catch {
        busy(false);
        err('Não foi possível entrar.');
      }
    };
  });
}

function googleIcon() {
  return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.4c-.24 1.4-1.66 4.1-5.4 4.1-3.25 0-5.9-2.7-5.9-6s2.65-6 5.9-6c1.85 0 3.09.79 3.8 1.47l2.6-2.5C16.74 3.6 14.6 2.6 12 2.6 6.82 2.6 2.6 6.82 2.6 12S6.82 21.4 12 21.4c6.93 0 9.2-4.86 9.2-7.4 0-.5-.05-.88-.12-1.26z"/></svg>`;
}
