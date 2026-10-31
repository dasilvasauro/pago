import * as store from '../core/store.js';
import * as sync from '../core/sync.js';
import * as notify from '../core/notify.js';
import { exportBackup, importBackup, exportCSV, openReport, exportICS, compact, storageEstimate } from '../core/data.js';
import { today } from '../lib/clock.js';
import { esc, ymOf, addMonths, fmtMonth } from '../lib/util.js';
import { icon, tip, sheet, opt, seg, toast, confirmDialog, colorPicker, COLORS } from '../ui/ui.js';
import { app, memberMap } from '../state.js';

export const title = 'Ajustes';
let reportMonth = null;

export function render(el) {
  const S = store.snapshot();
  const st = store.stats();
  const ns = notify.settings();
  const keep = Number(localStorage.getItem('pago.keepMonths') || 12);
  reportMonth ||= ymOf(today());
  const months = Array.from({ length: 18 }, (_, i) => addMonths(ymOf(today()), -i));
  const members = S.member.filter((m) => m.uid !== 'local');
  const requirePass = localStorage.getItem('pago.requirePass') === '1';

  el.innerHTML = `
  <section class="block">
    <header class="block-head"><h3>Espaço</h3>${tip('O espaço reúne todos os dados financeiros. Duas ou mais pessoas podem usar o mesmo espaço; cada lançamento mostra quem registrou.')}</header>
    <div class="set-card">
      ${
        app.test
          ? `<p class="set-line">Modo de teste ativo. Os dados ficam só neste navegador, separados dos dados reais.</p>`
          : app.mode === 'cloud'
            ? `<div class="set-user">${app.user?.photoURL ? `<img src="${esc(app.user.photoURL)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar">${icon('user')}</span>`}<div><b>${esc(app.user?.displayName || 'Conta Google')}</b><span>${esc(app.user?.email || '')}</span></div><span class="sync-tag" data-sync></span></div>
              <h4 class="sub">Membros</h4>
              <ul class="members">${members
                .map((m) => `<li><span class="who" style="--c:${m.color}">${esc((m.name || '?')[0].toUpperCase())}</span><span>${esc(m.name)}${m.uid === app.me ? ' (você)' : ''}${m.uid === app.owner ? ', dono' : ''}</span>${app.owner === app.me && m.uid !== app.me ? `<button type="button" class="btn small ghost danger-text" data-kick="${esc(m.uid)}">Remover</button>` : ''}</li>`)
                .join('')}</ul>
              <div class="set-actions">
                ${app.owner === app.me ? `<button type="button" class="btn" data-invite>${icon('user')}Convidar pessoa</button>` : ''}
                <button type="button" class="btn ghost" data-profile>${icon('edit')}Meu nome e cor</button>
                <button type="button" class="btn ghost" data-signout>Sair da conta</button>
              </div>`
            : `<p class="set-line">Dados guardados apenas neste dispositivo.</p>
              <div class="set-actions">${sync.cloudConfigured() ? `<button type="button" class="btn primary" data-connect>${icon('cloud')}Conectar conta Google</button>` : `<span class="set-line ${sync.getConfigError() ? 'neg' : 'muted'}">${esc(sync.getConfigError() || 'Para sincronizar e compartilhar, configure o Firebase (veja o README).')}</span>`}</div>`
      }
    </div>
  </section>

  <div class="two-col">
    <section class="block">
      <header class="block-head"><h3>Categorias</h3>${tip('Usadas para classificar entradas e saídas no diário e nos relatórios.')}<button type="button" class="btn small" data-new-cat>${icon('plus')}Nova</button></header>
      ${['saida', 'entrada']
        .map(
          (k) => `<h4 class="sub">${k === 'saida' ? 'Saídas' : 'Entradas'}</h4><div class="cat-chips">${S.cat
            .filter((c) => c.kind === k && !c.archived)
            .map((c) => `<button type="button" class="cat-chip" data-cat="${c.id}"><i style="background:${c.color}"></i>${esc(c.name)}</button>`)
            .join('')}</div>`,
        )
        .join('')}
    </section>

    <section class="block">
      <header class="block-head"><h3>Lembretes</h3>${tip('Avisos de contas e faturas a vencer. Aparecem ao abrir o Pago; no Android, com o app instalado, também em segundo plano. Para avisos em qualquer aparelho com o app fechado, adicione os lembretes ao seu calendário.')}</header>
      <div class="set-card">
        ${notify.supported() ? `<label class="switch"><input type="checkbox" data-notif ${ns.on && Notification.permission === 'granted' ? 'checked' : ''}><span>Notificações de vencimento</span></label>` : `<p class="set-line muted">Este navegador não oferece notificações.</p>`}
        <label class="field inline"><span>Avisar com antecedência de</span><select data-lead>${[0, 1, 2, 3, 5].map((n) => opt(n, n === 0 ? 'No dia' : n === 1 ? '1 dia' : `${n} dias`, n === ns.lead)).join('')}</select></label>
        <button type="button" class="btn ghost" data-ics>${icon('plan')}Adicionar ao calendário (.ics)</button>
      </div>
    </section>
  </div>

  <section class="block">
    <header class="block-head"><h3>Dados</h3>${tip('Exportações ficam no seu aparelho. O backup completo pode ser importado de volta em qualquer espaço do Pago.')}</header>
    <div class="set-card">
      <div class="grid2">
        <label class="field"><span>Mês</span><select data-month>${months.map((m) => opt(m, fmtMonth(m), m === reportMonth)).join('')}</select></label>
        <div class="set-actions end"><button type="button" class="btn" data-report>${icon('diary')}Relatório</button><button type="button" class="btn ghost" data-csv>${icon('download')}CSV</button></div>
      </div>
      <div class="set-actions">
        <button type="button" class="btn ghost" data-backup>${icon('download')}Backup completo</button>
        <label class="btn ghost file">${icon('upload')}Importar backup<input type="file" accept="application/json,.json" data-import hidden></label>
      </div>
      <h4 class="sub">Arquivamento ${tip('Lançamentos de meses antigos são compactados em um único registro por mês, cifrado e comprimido. Saldos, gráficos e relatórios continuam completos; os lançamentos arquivados ficam somente leitura.')}</h4>
      <div class="grid2">
        <label class="field"><span>Manter detalhado</span><select data-keep>${[6, 12, 24, 36].map((n) => opt(n, `${n} meses`, n === keep)).join('')}</select></label>
        <div class="set-actions end"><button type="button" class="btn ghost" data-compact>${icon('archive')}Arquivar agora</button></div>
      </div>
      <p class="set-line muted" data-usage>${st.live} registros ativos${st.tomb ? `, ${st.tomb} exclusões aguardando limpeza` : ''}.</p>
    </div>
  </section>

  <section class="block">
    <header class="block-head"><h3>Segurança</h3>${tip('Os dados ficam cifrados no aparelho e na nuvem com uma chave protegida pela senha do espaço. Sem a senha, nem o servidor consegue lê-los.')}</header>
    <div class="set-card">
      ${app.test ? '<p class="set-line muted">Indisponível no modo de teste.</p>' : `
      <label class="switch"><input type="checkbox" data-reqpass ${requirePass ? 'checked' : ''}><span>Pedir a senha sempre que abrir</span></label>
      <div class="set-actions">
        <button type="button" class="btn ghost" data-lock>${icon('lock')}Bloquear agora</button>
        ${app.mode === 'local' || app.owner === app.me ? `<button type="button" class="btn ghost" data-pass>Alterar senha do espaço</button>` : ''}
      </div>`}
    </div>
  </section>

  <section class="block">
    <header class="block-head"><h3>Modo de teste</h3>${tip('Abre um espaço separado com dados fictícios e controles para avançar os dias. Nada é enviado para a nuvem e os dados reais não são tocados.')}</header>
    <div class="set-card">
      <div class="set-actions">
        <button type="button" class="btn ${app.test ? 'primary' : 'ghost'}" data-test>${icon('flask')}${app.test ? 'Sair do modo de teste' : 'Entrar no modo de teste'}</button>
        ${app.test ? `<button type="button" class="btn ghost danger-text" data-test-reset>Recomeçar dados de teste</button>` : ''}
      </div>
    </div>
  </section>
  <p class="foot-note">Pago ${esc(app.version || '')}</p>`;

  const $ = (s) => el.querySelector(s);
  const on = (s, f) => $(s)?.addEventListener('click', f);

  const syncTag = $('[data-sync]');
  if (syncTag) {
    const L = { synced: 'Sincronizado', syncing: 'Sincronizando', offline: 'Offline', error: 'Erro ao sincronizar', denied: 'Sem acesso ao espaço', local: '' };
    const off = sync.onStatus((s) => {
      if (!syncTag.isConnected) return off();
      syncTag.textContent = L[s] || '';
      syncTag.dataset.s = s;
    });
  }

  on('[data-connect]', () => app.actions.connectGoogle());
  on('[data-signout]', async () => {
    if (await confirmDialog('Sair da conta neste dispositivo? Os dados locais deste aparelho serão apagados; na nuvem continuam salvos.', { ok: 'Sair', danger: true })) app.actions.signOut();
  });
  on('[data-invite]', invite);
  on('[data-profile]', profile);
  el.querySelectorAll('[data-kick]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!(await confirmDialog('Remover esta pessoa do espaço? Ela perde o acesso à nuvem. Se ela souber a senha, altere-a depois.', { ok: 'Remover', danger: true }))) return;
      await sync.removeMember(b.dataset.kick);
      const m = memberMap(store.snapshot()).get(b.dataset.kick);
      if (m) await store.remove(m.id);
      toast('Pessoa removida');
    }),
  );

  on('[data-new-cat]', () => openCat());
  el.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => openCat(b.dataset.cat)));

  $('[data-notif]')?.addEventListener('change', async (e) => {
    if (e.target.checked) {
      const ok = await notify.enable();
      e.target.checked = ok;
      if (!ok) toast('Permissão de notificação negada no navegador.');
      else notify.check();
    } else notify.saveSettings({ ...notify.settings(), on: false });
  });
  $('[data-lead]').addEventListener('change', (e) => notify.saveSettings({ ...notify.settings(), lead: Number(e.target.value) }));
  on('[data-ics]', exportICS);

  $('[data-month]').addEventListener('change', (e) => (reportMonth = e.target.value));
  on('[data-report]', () => openReport(reportMonth));
  on('[data-csv]', () => exportCSV(reportMonth));
  on('[data-backup]', exportBackup);
  $('[data-import]').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const n = await importBackup(f);
      toast(n ? `${n} registros importados` : 'Nada novo para importar');
    } catch (err) {
      toast(err.message);
    }
    e.target.value = '';
  });
  $('[data-keep]').addEventListener('change', (e) => localStorage.setItem('pago.keepMonths', e.target.value));
  on('[data-compact]', async () => {
    const n = Number($('[data-keep]').value);
    if (!(await confirmDialog(`Arquivar lançamentos anteriores a ${fmtMonth(addMonths(ymOf(today()), -n)).toLowerCase()}?`, { ok: 'Arquivar' }))) return;
    const r = await compact(n);
    toast(r.moved ? `${r.moved} lançamentos arquivados em ${r.months} ${r.months === 1 ? 'mês' : 'meses'}` : 'Nada para arquivar');
  });
  storageEstimate().then((e) => {
    const u = $('[data-usage]');
    if (e && u) u.textContent += ` Espaço usado neste aparelho: ${(e.usage / 1048576).toFixed(1)} MB.`;
  });

  $('[data-reqpass]')?.addEventListener('change', (e) => app.actions.setRequirePass(e.target.checked));
  on('[data-lock]', () => app.actions.lock());
  on('[data-pass]', () => app.actions.changePass());
  on('[data-test]', () => app.actions.toggleTest());
  on('[data-test-reset]', async () => {
    if (await confirmDialog('Apagar os dados de teste e gerar novos?', { ok: 'Recomeçar', danger: true })) app.actions.resetTest();
  });
}

function openCat(id) {
  const S = store.snapshot();
  const c = id ? S.byId.get(id) : { kind: 'saida', color: COLORS[S.cat.length % COLORS.length] };
  const used = id && (S.tx.some((t) => t.categoryId === id) || S.bill.some((b) => b.categoryId === id) || S.plan.some((p) => p.categoryId === id));
  sheet({
    title: id ? 'Editar categoria' : 'Nova categoria',
    body: `<form class="form" data-f>
      ${id ? '' : seg('kind', [['saida', 'Saída'], ['entrada', 'Entrada']], c.kind)}
      <label class="field"><span>Nome</span><input name="name" value="${esc(c.name || '')}" required maxlength="30" autofocus></label>
      <div class="field"><span>Cor</span>${colorPicker('color', c.color)}</div>
      <div class="sheet-actions">${id ? `<button type="button" class="btn ghost danger-text" data-del>${icon('trash')}${used ? 'Arquivar' : 'Excluir'}</button>` : '<span></span>'}<button class="btn primary">Salvar</button></div>
    </form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      el.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (used) {
          await store.save('cat', { ...c, archived: true }, id);
          toast('Categoria arquivada. Lançamentos antigos mantêm a categoria.');
        } else await store.remove(id);
        close();
      });
      f.onsubmit = async (e) => {
        e.preventDefault();
        const kind = id ? c.kind : f.querySelector('input[name=kind]:checked').value;
        await store.save('cat', { name: f.name.value.trim(), kind, color: f.querySelector('input[name=color]:checked')?.value || c.color, archived: false }, id);
        close();
      };
    },
  });
}

async function invite() {
  let h;
  try {
    h = await sync.getHousehold(app.hid);
  } catch {
    return toast('Sem conexão. Tente de novo online.');
  }
  const code = () => `${app.hid}.${h.joinCode}`;
  sheet({
    title: 'Convidar pessoa',
    body: `<div class="form">
      <p class="sheet-text">Envie o código abaixo. A pessoa entra com a conta Google dela, escolhe Entrar com convite e informa o código e a senha do espaço. Combine a senha pessoalmente ou por outro canal.</p>
      <div class="code-box"><code data-code>${esc(code())}</code><button type="button" class="icon-btn" data-copy aria-label="Copiar">${icon('copy')}</button></div>
      <div class="sheet-actions"><button type="button" class="btn ghost" data-rotate>${icon('refresh')}Gerar novo código</button><span></span></div>
      <p class="form-meta">Gerar um novo código invalida o anterior. Quem já entrou continua no espaço.</p>
    </div>`,
    onMount(el) {
      el.querySelector('[data-copy]').onclick = async () => {
        await navigator.clipboard.writeText(code());
        toast('Código copiado');
      };
      el.querySelector('[data-rotate]').onclick = async () => {
        h.joinCode = await sync.rotateInvite(app.hid);
        el.querySelector('[data-code]').textContent = code();
        toast('Novo código gerado');
      };
    },
  });
}

function profile() {
  const S = store.snapshot();
  const m = memberMap(S).get(app.me) || { name: app.user?.displayName || '', color: COLORS[0] };
  sheet({
    title: 'Meu nome e cor',
    body: `<form class="form" data-f>
      <label class="field"><span>Nome exibido</span><input name="name" value="${esc(m.name)}" required maxlength="24" autofocus></label>
      <div class="field"><span>Cor</span>${colorPicker('color', m.color)}</div>
      <div class="sheet-actions"><span></span><button class="btn primary">Salvar</button></div></form>`,
    onMount(el, close) {
      const f = el.querySelector('[data-f]');
      f.onsubmit = async (e) => {
        e.preventDefault();
        await store.save('member', { uid: app.me, name: f.name.value.trim(), color: f.querySelector('input[name=color]:checked')?.value || m.color }, `m_${app.me}`);
        close();
      };
    },
  });
}
