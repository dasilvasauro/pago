// Estado de sessão compartilhado entre telas.
export const app = {
  test: false, // modo de teste (banco separado, sem nuvem)
  mode: 'local', // 'local' | 'cloud'
  me: 'local',
  user: null, // usuário Google (nome, foto)
  hid: null,
  owner: null,
  idb: null,
  wrap: null,
  nav: () => {},
  refresh: () => {},
};

export function memberMap(S) {
  const m = new Map();
  for (const x of S.member) m.set(x.uid, x);
  return m;
}

export function who(S, uid) {
  const m = memberMap(S).get(uid);
  if (uid === app.me) return { name: 'Você', short: 'V', color: m?.color || '#7C8CFF' };
  if (!m) return { name: 'Outro membro', short: '?', color: '#8FA3B8' };
  return { name: m.name, short: (m.name || '?').trim()[0].toUpperCase(), color: m.color };
}

export const multiUser = (S) => S.member.filter((m) => m.uid !== 'local').length > 1;
