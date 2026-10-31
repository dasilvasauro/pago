# Pago

Controle financeiro pessoal e familiar para uso diário, pensado para a realidade brasileira: cheque especial, cartões com fatura e parcelamento, acordos e renegociações, contas parceladas, vouchers de benefício e FGTS.

Funciona no celular (instalável como PWA) e no computador, offline, com sincronização opcional e compartilhada via Firebase.

Não há etapa de build: são arquivos estáticos (HTML, CSS e módulos JavaScript).

---

## Estrutura

```
index.html              casca do app
manifest.webmanifest    instalação como PWA
sw.js                   service worker (offline, atualização, lembretes)
css/app.css             estilos
icons/                  ícones do app
js/
  main.js               inicialização, navegação, modo de teste, ações globais
  state.js              estado de sessão compartilhado
  firebase-config.js    configuração do Firebase (preencher)
  lib/                  relógio, utilitários, IndexedDB, criptografia, relógio lógico (HLC)
  core/
    store.js            registros cifrados, tombstones, coleta de lixo local
    domain.js           regras de negócio (saldos, faturas, dívida, projeções)
    sync.js             Firebase: login, espaço compartilhado, sincronização
    data.js             backup, CSV, relatório, .ics, arquivamento
    notify.js           lembretes
    seed.js             categorias padrão e dados do modo de teste
  ui/                   componentes e gráfico
  views/                telas
firestore.rules         regras de segurança do Firestore
firestore.indexes.json  índice usado na limpeza de exclusões
firebase.json           configuração para o Firebase CLI
```

---

## Rodar localmente

O app precisa ser servido por HTTP, porque módulos JS e o service worker não funcionam abrindo o arquivo direto. Na pasta do projeto, use um destes:

```bash
python3 -m http.server 8080
# ou
npx serve .
```

Depois abra `http://localhost:8080`.

### Abrir no celular durante o desenvolvimento

O navegador só libera a criptografia, o service worker e a instalação como app em conexões seguras: HTTPS ou `localhost`. Por isso, abrir `http://192.168.x.x:8080` no celular mostra um aviso, e o app não abre. Há três alternativas:

- **Túnel HTTPS, funciona em qualquer celular:** com o servidor rodando, execute `cloudflared tunnel --url http://localhost:8080` e abra o endereço `https://…trycloudflare.com` que aparecer. Para testar o login com Google por esse endereço, adicione o domínio aos domínios autorizados do Firebase.
- **Android com cabo USB:** no Chrome do computador, abra `chrome://inspect`, vá em Port forwarding e mapeie `8080` para `localhost:8080`. No celular, abra `http://localhost:8080`.
- **GitHub Pages:** já é HTTPS. Veja a seção "Publicar no GitHub Pages".

Sem configurar o Firebase, o app já funciona por completo neste dispositivo. Para conhecer tudo sem cadastrar nada, use o modo de teste: "Experimentar no modo de teste" na tela inicial, ou Ajustes, Modo de teste.

---

## Configurar o Firebase (sincronização e uso compartilhado)

### 1. Criar o projeto

1. Acesse https://console.firebase.google.com e clique em **Adicionar projeto**.
2. O Google Analytics não é necessário.

### 2. Ativar o login com Google

1. No menu, vá em **Authentication**, depois **Começar** e então **Sign-in method**.
2. Ative **Google**, informe um e-mail de suporte e salve.
3. Ainda em Authentication, abra **Configurações** e depois **Domínios autorizados**. Adicione os domínios onde o app vai rodar:
   - `localhost`, que já vem por padrão;
   - `seu-usuario.github.io`, se for usar o GitHub Pages.

### 3. Criar o Firestore

1. No menu, vá em **Firestore Database** e clique em **Criar banco de dados**.
2. Escolha uma região próxima, por exemplo `southamerica-east1`, que fica em São Paulo.
3. Comece em **modo de produção**. As regras do projeto serão publicadas no passo 5.

### 4. Registrar o app Web e colar a configuração

1. Abra **Configurações do projeto**, desça até **Seus apps** e adicione um app **Web** (`</>`). Não é preciso ativar o Hosting.
2. Copie o objeto `firebaseConfig` mostrado.
3. Cole os valores em `js/firebase-config.js`:

```js
export const cloudConfig = {
  apiKey: '...',
  authDomain: 'seu-projeto.firebaseapp.com',
  projectId: 'seu-projeto',
  storageBucket: 'seu-projeto.appspot.com',
  messagingSenderId: '...',
  appId: '...',
};
```

Esses valores não são secretos e podem ir para o GitHub. Quem protege os dados são as regras do Firestore e a criptografia feita no aparelho.

### 5. Publicar as regras e o índice

Com o [Firebase CLI](https://firebase.google.com/docs/cli):

```bash
npm install -g firebase-tools
firebase login
firebase use --add            # escolha o projeto criado
firebase deploy --only firestore
```

Também dá para fazer sem o CLI:

- **Regras:** no console, abra **Firestore**, depois **Regras**, cole o conteúdo de `firestore.rules` e publique.
- **Índice:** em **Índices**, crie um índice composto na coleção `records` com os campos `del` (crescente) e `ts` (crescente). Sem ele, o app funciona normalmente; só a limpeza automática de exclusões antigas no servidor fica parada.

### 6. Usar

- **Primeiro aparelho:** escolha **Entrar com Google** e depois **Criar um espaço**. Defina a senha do espaço.
- **Outra pessoa entrar:**
  1. Em **Ajustes**, toque em **Convidar pessoa** e envie o código.
  2. A pessoa entra com a conta Google dela, escolhe **Entrar com convite** e informa o código e a senha do espaço.
  3. Combine a senha por outro canal.
- **Começou no modo "só neste dispositivo"?** Em **Ajustes**, use **Conectar conta Google**. Os dados locais sobem para a nuvem.

---

## Publicar no GitHub Pages

1. Suba o conteúdo desta pasta para um repositório.
2. Em **Settings**, abra **Pages** e configure:
   - **Source:** Deploy from a branch;
   - **Branch:** `main`, pasta `/ (root)`.
3. Adicione `seu-usuario.github.io` aos domínios autorizados do Firebase Authentication.
4. No celular, abra o endereço e instale o app:
   - **Android (Chrome):** menu ⋮, depois **Instalar app**;
   - **iPhone (Safari):** Compartilhar, depois **Adicionar à Tela de Início**.

Todos os caminhos são relativos, então o app funciona em subpastas, por exemplo `usuario.github.io/pago/`.

### Atualizações

Ao publicar uma nova versão, aumente `VERSION` em `sw.js` e `app.version` em `js/main.js`. O app mostra "Nova versão disponível" e atualiza com um toque.

---

## Como o Pago organiza as finanças

**A dívida é calculada, não cadastrada.** A dívida total é a soma de:

- **Cheque especial em uso:** contas com saldo negativo.
- **Cartões de crédito:** tudo o que foi comprado e ainda não pago, incluindo parcelas futuras.
- **Acordos e parcelamentos:** parcelas restantes de renegociações, empréstimos, financiamentos e contas parceladas.

Cada lançamento do diário altera saldos e dívida na hora. Um salário que cai numa conta negativa abate o cheque especial automaticamente.

**Hierarquia da Carteira:**

- **Instituição:** banco ou emissor. Dentro dela ficam:
  - **Contas:** corrente (com limite de cheque especial) e poupança.
  - **Cartões de débito:** cada um ligado a uma conta, que é de onde a compra sai.
  - **Cartões de crédito:** limite, fechamento e vencimento. A fatura é calculada pelo dia de fechamento: compras feitas a partir desse dia vão para a fatura seguinte.
- **Dinheiro e vouchers:** espécie, vale-alimentação e vale-refeição. A recarga entra como entrada no voucher.
- **Investimentos:** FGTS, poupança, CDB e outros. Use **Atualizar saldo** quando o valor mudar; isso não conta como entrada do mês.

**Saldo inicial.** É o saldo no começo do dia informado. Lançamentos a partir dessa data alteram o saldo; os anteriores ficam só como histórico.

**Planejar** reúne num só lugar:

- **Contas recorrentes:** despesas e receitas fixas, inclusive de valor variável (luz, gás).
- **Parcelamentos e acordos:** um parcelamento pode ser **somado a uma conta recorrente**. Por exemplo, um débito de gás em 5x aparece no mês como "Mensal + Débito de gás parcelado 3/5" num único vencimento.
- **Faturas dos cartões:** entram automaticamente no calendário do mês.

**Forma de pagamento.** A conta ou o cartão dizem de onde o dinheiro saiu; a forma diz como saiu.

- **Conta bancária:** você escolhe entre Pix (o padrão), boleto, débito, débito automático, Pix Automático, TED ou outro.
- **Pix e TED:** dá para informar para quem foi ou de quem veio. Os nomes usados antes aparecem como sugestão.
- **Cartão de crédito:** tem a opção "Pix no crédito".
- **Formas implícitas:** cartão de débito, voucher e dinheiro já dizem a forma sozinhos.
- **Contas recorrentes e parcelamentos:** podem ter uma forma padrão, usada ao registrar o pagamento.
- **Filtro Pix no Diário:** mostra só os Pix do mês, com total enviado, total recebido e o saldo entre eles.

**Dívida total ou saldo total.** Na tela inicial, o destaque alterna entre os dois, e a escolha fica salva.

- **Saldo total:** soma os valores positivos nas contas correntes, poupanças e em dinheiro.
- **Contas no negativo:** não entram no saldo; elas aparecem como cheque especial na dívida.
- **Vouchers e investimentos:** aparecem à parte, abaixo do valor.

**Pagar uma fatura** é uma transferência da conta para o cartão de crédito. Ela não conta como gasto, porque a compra já contou quando foi feita.

**Resumo do dia.** Ao abrir o app num novo dia aparece o resumo do dia anterior. Se você passou dias sem abrir, o resumo cobre todo o período: variação da dívida, entradas, saídas, dias sem registro e o que ficou pendente.

---

## Sincronização

- Cada entidade (conta, cartão, lançamento etc.) é um registro independente, versionado por um **Hybrid Logical Clock**.
- Em caso de conflito entre aparelhos, vence a versão mais nova daquele registro.
- As **regras do Firestore** só aceitam uma gravação se a versão for maior que a já salva. Assim, um aparelho que estava offline nunca sobrescreve uma alteração mais recente; ele baixa a versão nova.
- **Offline primeiro:** tudo é gravado no IndexedDB e numa fila de envio. A fila sobe ao reconectar.
- O aparelho só baixa o que mudou desde a última sincronização.
- **Exclusões viram tombstones,** ou seja, registros marcados como excluídos. Elas são removidas do servidor quando duas condições se cumprem:
  - todos os membros ativos já sincronizaram depois da exclusão;
  - já se passaram 30 dias.
- Um aparelho que ficou fora além desse prazo faz uma **reconciliação completa** ao voltar.

## Segurança

- **Chave do espaço:** os registros são cifrados no aparelho com AES-256-GCM, usando uma chave aleatória do espaço. Essa chave é protegida pela senha do espaço (PBKDF2-SHA256, 600 mil iterações).
- **O servidor não lê os dados:** ele guarda apenas o conteúdo cifrado e metadados (id, versão, autor, data).
- **Chave não extraível:** no aparelho, a chave é guardada como não extraível. O código, inclusive pelo console, consegue usá-la, mas não consegue ler seus bytes.
- **Proteção contra adulteração:** cada registro é autenticado junto com seu id, versão e marca de exclusão. Qualquer alteração manual no IndexedDB faz o registro ser rejeitado; com a nuvem ativa, ele é baixado de novo.
- **Senha ao abrir:** em Ajustes é possível exigir a senha a cada abertura ou bloquear na hora.
- **Limite honesto:** com o app aberto e desbloqueado, os dados decifrados estão na memória da página. Nenhum app web consegue impedir que quem tem o aparelho desbloqueado nas mãos os veja. A proteção vale para os dados guardados, os dados em trânsito e a nuvem.
- **A senha não pode ser recuperada.** Faça backups (Ajustes, Dados) de vez em quando.

## Volume de dados e limites

- **O que cabe no plano gratuito:** 1 GiB de armazenamento, 50 mil leituras e 20 mil gravações por dia. Cada lançamento ocupa cerca de 1 KB, então o uso diário de uma família fica muito abaixo desses limites.
- **Arquivamento** (Ajustes, Dados): os lançamentos de meses antigos viram **um único registro comprimido e cifrado por mês**.
  - Na nuvem, isso troca centenas de documentos por um e reduz as leituras quando um aparelho novo entra.
  - Saldos, gráficos e relatórios continuam completos; os lançamentos arquivados ficam somente leitura.
  - O padrão é manter 12 meses detalhados.
- **Exportações:**
  - backup completo em JSON, que pode ser importado de volta;
  - CSV do mês, compatível com Excel em português;
  - relatório do mês, que abre pronto para imprimir ou salvar em PDF.

## Lembretes

- **Com o app aberto ou ao abrir:** notificação de contas e faturas a vencer.
- **Android, com o app instalado (Chrome ou Edge):** verificação periódica em segundo plano, quando o sistema permite. Para isso fica salvo, sem cifra, apenas datas e quantidades; nenhum nome ou valor.
- **Qualquer aparelho, com o app fechado:** em Ajustes, Lembretes, toque em **Adicionar ao calendário (.ics)** e importe o arquivo no Google Agenda. Os avisos passam a vir do calendário.

## Modo de teste

- Abre um espaço separado, com dados fictícios, que não toca nos dados reais e não usa a nuvem.
- A barra no topo permite avançar +1, +7 ou +30 dias.
- Com **Simular uso** marcado, o app gera gastos aleatórios e quita a maior parte dos compromissos de cada dia que passou, e então mostra o resumo do período.
- **Hoje real** volta para a data atual. **Recomeçar dados de teste** gera tudo de novo.
