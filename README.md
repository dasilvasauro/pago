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

Copie só os valores. O console também mostra as linhas `import { initializeApp } from "firebase/app"` e `const app = initializeApp(firebaseConfig)`; elas são para projetos com npm e quebram o Pago se forem coladas no arquivo. O Pago já carrega o Firebase sozinho.

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
  1. Em **Ajustes**, toque em **Convidar pessoa**. Aparece um QR Code, o código e o botão Compartilhar link.
  2. A pessoa entra por um destes caminhos:
     - **Câmera comum do celular:** aponta para o QR, e o Pago abre já com o convite;
     - **Leitor do app:** em **Entrar com convite**, toca em **Ler QR Code**;
     - **Link:** recebe o link por mensagem e abre.
  3. A pessoa entra com a conta Google dela e informa a senha do espaço. A senha nunca vai no QR nem no link: combine por outro canal.
  4. Depois que ela entrar, gere um novo código (isso invalida o QR anterior; quem já entrou continua no espaço).
- **No iPhone:** o QR lido pela câmera abre no Safari. Se a pessoa usa o Pago instalado na tela de início, basta entrar de novo com a mesma conta Google dentro do app instalado.
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

Ao publicar uma nova versão, aumente `VERSION` em `sw.js` e `app.version` em `js/main.js`. O app guarda os arquivos para funcionar offline e só os renova quando `VERSION` muda. A exceção é `js/firebase-config.js`, que é sempre buscado na rede primeiro: alterar só a configuração não exige mudar a versão. O app mostra "Nova versão disponível" e atualiza com um toque.

---

## Como o Pago organiza as finanças

**A dívida é calculada, não cadastrada.** A dívida total é a soma de:

- **Cheque especial em uso:** contas com saldo negativo.
- **Cartões de crédito:** tudo o que foi comprado e ainda não pago, incluindo parcelas futuras.
- **Acordos e parcelamentos:** parcelas restantes e entrada ainda não paga de renegociações, empréstimos, financiamentos e contas parceladas.
- **Outras dívidas:** saldos devedores sem parcelas definidas (Carteira, Outras dívidas).
- **Contas em atraso:** contas recorrentes vencidas e não pagas desde o mês de início de cada conta. Meses pagos fora do app podem ser marcados como "Já paga".

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

**Outras dívidas.** Quando o banco tira o cheque especial da conta e o coloca numa dívida à parte, cadastre em Carteira, Outras dívidas, com a opção "Veio de uma conta negativa".

- **O que acontece:** a conta volta a zero, o valor passa para a dívida, e a dívida total não muda.
- **Pagamentos:** são transferências para a dívida.
- **Juros e encargos:** entram em Atualizar saldo.

**Renegociar.** Para transformar dívidas em um acordo com entrada e parcelas, use o botão Renegociar em Planejar. Ele também aparece no detalhe de uma conta negativa, de um cartão ou de uma dívida avulsa.

1. **Marque o que entrou no acordo:**
   - contas recorrentes em atraso;
   - saldos negativos de contas;
   - cartões;
   - dívidas avulsas;
   - um valor informado, para dívidas que não estão no Pago, como contas que atrasaram antes de você usar o app.
2. **Informe as condições:** entrada (com data), valor das parcelas, quantidade e mês da primeira. O app mostra quanto o acordo custa a mais (ou a menos) que o valor original.
3. **Ao criar o acordo:**
   - as contas atrasadas ficam como "Renegociada";
   - os saldos renegociados são zerados por ajustes ligados ao acordo;
   - a dívida total passa a refletir o acordo.

Excluir o acordo desfaz tudo isso.
- **Vouchers e investimentos:** aparecem à parte, abaixo do valor.

**Ajustar um mês de uma conta recorrente.** Em Planejar, toque no nome de uma conta recorrente ainda não paga, em qualquer mês, passado ou futuro. Dá para:

- **Mudar o valor só daquele mês:** por exemplo, a conta de luz de agosto veio R$ 312,70.
- **Mudar o vencimento.**
- **Marcar "Não haverá cobrança neste mês".** Fica uma linha com Desfazer.
- **"Usar este valor daqui em diante":** muda o valor padrão. Os meses anteriores ainda não pagos mantêm o valor antigo.

Os ajustes valem para o calendário, as contas em atraso, a dívida total, a projeção e a renegociação.

**Cofrinhos.** Ficam em Carteira, seção Cofrinhos. Cada um tem:

- **Instituição e meta:** a instituição é obrigatória; a data para atingir é opcional.
- **Progresso:** em porcentagem e em valor.
- **Detalhe:** mostra há quantos dias o cofrinho está sem receber nenhum valor e, com data definida, quanto guardar por mês.
- **Movimentações:**
  - **Guardar e Resgatar:** são transferências entre a conta e o cofrinho, por isso não contam como gasto.
  - **Rendimentos:** entram em Atualizar saldo e não contam como depósito.
- **Nos totais:** o valor dos cofrinhos entra no patrimônio, à parte do saldo total.

**Aviso de contas atrasadas.** Com contas recorrentes em atraso (luz, água, internet...), a tela inicial mostra um aviso com três opções. Cartão e cheque especial não entram nesse aviso.

- **Pagar agora:** abre a lista das contas atrasadas agrupadas por conta, com os meses de cada uma. Em cada mês dá para usar Pagar ou Já paga; em cada conta, Pagar todos ou Renegociar.
- **Lembre-me mais tarde:** o aviso volta em uma hora.
- **Não consigo pagar agora:** o aviso, e as notificações dessas contas, somem por 7 dias. Se outra conta atrasar nesse período, o aviso volta antes.

**Gráfico do Diário.** Mostra uma barra por dia do mês, com as saídas, ou com as entradas ou transferências conforme o filtro. Um ponto verde marca os dias com entrada.

- **Ver um dia:** toque numa barra ou arraste o dedo pelo gráfico. Ao soltar, a lista mostra só aquele dia.
- **Voltar ao mês inteiro:** toque de novo no mesmo dia ou em "Ver o mês inteiro".
- **No computador:** as setas do teclado navegam pelos dias.

**Calculadora.** Fica no botão do topo, em qualquer tela. A conta é montada como uma fita, operada na ordem em que aparece.

- **Valores livres:** digite normalmente. Depois de × ou ÷, o número digitado é um fator; por exemplo, ÷ 2 divide por dois.
- **Valores do app:** saldos, faturas, dívida de cada cartão, contas atrasadas, o que falta pagar no mês, acordos, dívida total e projeção.
  - Marque vários valores e eles entram juntos como uma soma.
- **Ícone de calculadora:** aparece no aviso de contas atrasadas, na tela de atrasadas (total e cada conta), no "Falta" de Planejar e no detalhe de contas e cartões. Ele leva aqueles valores direto para a fita.
- **Na fita:** cada linha pode ser removida, e as somas mostram os itens.
- **Lançar:** cria um lançamento com o resultado.
- **Persistência:** a fita fica salva no aparelho até você limpar.

**Prioridade.** Contas recorrentes, acordos e cartões podem ser marcados como Normal, Importante ou Essencial. Os essenciais e importantes ganham um selo no calendário e nas contas atrasadas.

**Sugestão de pagamento.** Fica em Planejar, na tela de atrasadas e no painel de vencimentos. Usa regras simples, sem IA:

1. **Valor disponível:** parte da soma dos saldos positivos. Você pode diminuir para guardar o dinheiro do dia a dia.
2. **Ordem dos compromissos:** até o próximo recebimento previsto, eles são ordenados por:
   - prioridade marcada;
   - tipo: parcela de acordo, que pode desfazer o acordo, e fatura, que vai para o rotativo;
   - atraso: um serviço essencial atrasado há 15 dias ou mais pode ser cortado;
   - proximidade do vencimento.
3. **Distribuição do dinheiro:** o valor disponível é distribuído nessa ordem.
   - Fatura pode ser paga em parte.
   - O que não couber aparece em "Pode esperar", com a data do próximo recebimento.

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
  - relatório do mês, que abre dentro do app, com os botões Imprimir ou PDF e Baixar.

## Lembretes

- **Com o app aberto ou ao abrir:** notificação de contas e faturas a vencer.
- **Android, com o app instalado (Chrome ou Edge):** verificação periódica em segundo plano, quando o sistema permite. Para isso fica salvo, sem cifra, apenas datas e quantidades; nenhum nome ou valor.
- **Qualquer aparelho, com o app fechado:** em Ajustes, Lembretes, toque em **Adicionar ao calendário (.ics)** e importe o arquivo no Google Agenda. Os avisos passam a vir do calendário.

## Modo de teste

- Abre um espaço separado, com dados fictícios, que não toca nos dados reais e não usa a nuvem.
- A barra no topo permite avançar +1, +7 ou +30 dias.
- Com **Simular uso** marcado, o app gera gastos aleatórios e quita a maior parte dos compromissos de cada dia que passou, e então mostra o resumo do período.
- **Hoje real** volta para a data atual. **Recomeçar dados de teste** gera tudo de novo.

## Licenças de terceiros

- `js/vendor/qrcode.js`: QR Code Generator for JavaScript, de Kazuhiko Arase, sob licença MIT.
- `js/vendor/jsqr.js`: jsQR, de Cosmo Wolfe, sob licença Apache 2.0. É usado para ler QR Code quando o navegador não tem leitor nativo.

"QR Code" é marca registrada da DENSO WAVE INCORPORATED.
