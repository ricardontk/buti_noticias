# Changelog

Todas as mudanças relevantes deste app.

### Corrigido

- **A aba do WhatsApp Web "se desanexa"** (`Attempted to use detached Frame`):
  é a causa real do erro de injeção — a página recarrega ou cai e a biblioteca
  fica com a referência velha. Melhorias:
  - a recuperação agora **espera a sessão ficar pronta** (evento `ready`) antes de
    reenviar, em vez de só recarregar a página;
  - o erro "detached Frame" também é reconhecido como falha de injeção;
  - **freio anti-loop**: dois reinícios em menos de 1 minuto não são permitidos
    (evita o bot ficar reiniciando e queimando CPU/RAM do RPi 4);
  - o log dá a dica de que, se repetir muito, o problema pode ser memória.

### Corrigido

- **"🔌 [DESCONECTADO] LOGOUT"**: o WhatsApp encerrou a sessão deste
  dispositivo. Antes, o bot ficava tentando usar a credencial morta (daí o
  "Execution context was destroyed" e o "getChat" quebrando). Agora, ao detectar
  LOGOUT/CONFLICT/UNPAIRED, ele **descarta a credencial salva e pede um QR Code
  novo** — que aparece no painel web e é salvo em `qrcode.png`.
- **Vigia do app**: se o WhatsApp ficar desconectado por mais de 15 minutos
  (aba caiu e não voltou), o app sai com erro — o Supervisor reinicia ele limpo
  e o bot volta a funcionar sozinho, sem depender de você.
- **Sessão quebrada sem saída**: depois de 3 falhas de injeção seguidas, o bot
  **descarta a credencial salva e pede um QR Code novo** (o arquivo
  `qrcode.png` é gerado de novo e aparece no painel para você escanear).

## 1.6.0

### Corrigido

- **O link publicado continuava sendo do Google News** (`news.google.com/rss/articles/...`).
  O Google mudou o formato: a página do artigo não tem mais o atributo `data-n-au`
  (o método antigo) — agora ela devolve uma assinatura (`data-n-a-sg`) e um
  carimbo (`data-n-a-ts`), que são usados na API `batchexecute` do Google para
  devolver a URL do veículo. O bot agora usa essa API: **3 links resolvidos em
  ~2,5 s, sem abrir navegador**. Ordem: redirect → atributo antigo → API do
  Google → navegador (último recurso).
- **A IA ficava "degradada" para sempre** depois de um erro (cota por minuto,
  modelo inexistente): o bot nunca mais tentava. Agora há **cooldown de 1 minuto**
  (`llm.cooldown_ms`): durante a espera ele usa o texto original, e depois
  tenta a IA de novo. O painel mostra quanto falta para a próxima tentativa.

## 1.5.2

### Corrigido

- **Os títulos saíam em inglês**: quando a IA falha, o bot cai no modo reserva
  (heurística), que só limpa o título — sem traduzir. Agora:
  - no boot, o bot **confere se o modelo configurado existe no provedor** e
    avisa no log qual é o problema (com a lista de modelos disponíveis);
  - o erro fica visível no painel (🔴 em vez de "degradado") e no status do
    WhatsApp;
  - a mensagem no log diz na hora quando o problema é o **nome do modelo**;
  - dá para **trocar o modelo com um clique** na lista "Modelos de texto" do
    painel (além do comando `modelo <id>` no WhatsApp).
- O link original do feed (Google News) voltou a ser usado como reserva — ele
  redireciona para a matéria e é publicável.

## 1.5.1

### Corrigido

- **O link publicado saía como `https://www.google-analytics.com/analytics.js`**:
  a página do Google News tem vários `"url"` no JSON inline e o primeiro deles é
  o script de analytics. Agora **todos** os padrões de extração (atributo
  oficial, JSON inline, `href` e `src`) passam pelo mesmo filtro — só é aceito
  link http(s) que pareça matéria. Se nenhum candidato servir, o bot usa o
  navegador; se também falhar, publica o link original do feed.
- O log agora mostra quando o navegador é aberto e quando o link final não
  pôde ser resolvido.

## 1.5.0

### Corrigido

- **"Canal: não configurado" mesmo com a lista `canais` preenchida**: as
  mensagens de status, o log de boot e o aviso de "pronto" olhavam só o
  `canal_id`. Agora tudo usa a lista real de destinos (canal_id + canais) e
  mostra quantos são e o modo de publicação.
- **O link publicado saía como `https://www.google-analytics.com/analytics.js`**:
  ao extrair a URL da página do Google News, o fallback pegava o primeiro link
  externo — que era o script de analytics. Agora são ignorados analytics,
  tags de social, scripts e imagens, e o link precisa parecer uma matéria.
- **"Cannot read properties of undefined (reading 'getChat')"**: o
  `whatsapp-web.js` roda dentro da página do WhatsApp Web e usa
  `window.WWebJS.getChat(...)`. Quando o WhatsApp recarrega a página, o script
  injetado some e todo envio quebra. Agora o bot **se recupera sozinho**:
  identifica a falha, reinicia a sessão do WhatsApp (mantendo o login salvo no
  volume) e tenta o envio de novo. Erros comuns (chat não encontrado, etc.)
  continuam sendo propagados, sem reiniciar nada.
- **O painel e a mensagem publicada usavam links diferentes**: o painel mostrava
  o link resolvido, mas a mensagem publicava o campo `linkReal` (que nunca
  existiu) e caía no link quebrado. Agora os dois usam a mesma função
  (`linkFinal`), que nunca devolve `chrome-error://` nem link inválido.
- **O link publicado saía como `chrome-error://chromewebdata/`**: quando a
  navegação falha, o Chromium devolve a página de erro e o bot publicava essa
  URL. Agora só links http(s) são aceitos — quando a resolução falha, fica o
  link original do feed.
- **A varredura travava em "Resolvendo links"**: cada link do Google News abria
  uma aba do Chromium, uma de cada vez, com 25 s de timeout (no Raspberry Pi 4,
  isso passava de 3 minutos). Agora:
  - o link é resolvido por **HTTP** (segue o redirect) e, quando o redirect é por
    JavaScript, a URL original é extraída do HTML — **sem abrir navegador**;
  - o navegador só é usado como último recurso, com `domcontentloaded` e 10 s;
  - os links são resolvidos **3 ao mesmo tempo**, com **orçamento de tempo
    total** (25 s): o que não der tempo fica com o link original;
  - o progresso aparece no log (`3/8 resolvido(s)`).

### Adicionado

- **O texto da matéria agora vai para a IA**: o bot busca o conteúdo por HTTP
  (sem navegador) e manda um trecho junto com o título, então o COMENTÁRIO
  publicado fala da notícia de verdade e não só da manchete.
- **Publicação mais "de influencer"**: o COMENTÁRIO passou de 1 para 2-3 frases,
  a persona da IA ficou mais de campo (fala do que muda na rotina de quem
  pulveriza, sem linguagem de comunicado) e a mensagem ganhou uma linha de
  engajamento — agora editável na **opção `publicacao_gancho` do app**.
- Tetos para não estourar o free tier da Groq: `llm.max_chars_texto` (900 por
  matéria) e `llm.max_chars_total` (9000 no total) — cerca de 2,5 mil tokens de
  entrada por varredura.
- `scripts/teste-resolver.js`, `scripts/teste-artigo.js` e `scripts/teste-link.js`
  (entram no `npm run verificar`).

## 1.4.0

### Corrigido

- **O painel web parou de carregar as informações** quando se define uma senha
  (`painel_token`): o navegador pede o `painel.js` sem a senha na URL, o
  servidor bloqueava, e a página ficava só com o HTML. Agora os arquivos do
  painel são servidos **sem** senha (não têm segredo) e a API é que pede a
  senha — o painel mostra um campo para digitá-la e lembra no navegador.
- **O painel dentro do Home Assistant não carregava nada**: o `painel.js` era
  carregado por caminho absoluto (`/painel.js`), que escapa do ingress e vai
  parar na API do Home Assistant em vez do bot. Agora o script é carregado com
  o prefixo do ingress, derivado do próprio endereço da página.
- O painel não quebra mais se o HTML estiver defasado no navegador (elementos
  novos ausentes) e o servidor manda `Cache-Control: no-store` para o HTML/JS.
- Aviso `DEP0169` (url.parse) eliminado: o servidor agora usa a API padrão de
  URL.

### Mudança

- Removida a opção `painel_porta`: a porta do painel vem do `config.json`
  (`painel.porta`) e o ingress da porta 8090. Menos um lugar para configurar.

### Adicionado

- `AGENTS.md` com as regras do projeto e `npm run verificar`, que valida o
  `config.yaml` contra o schema do Supervisor e roda todos os testes antes de
  publicar.

## 1.3.2

### Corrigido

- A integração com o Home Assistant retornava **401**: a chave errada estava no
  `config.yaml`. `hassio_api` libera a API do *Supervisor*; quem libera o proxy
  `/core/api` do Home Assistant é `homeassistant_api`. Agora está
  `homeassistant_api: true` (e `hassio_api: false`, que não usamos).
- O log agora mostra se o token foi encontrado e lembra de conferir a chave
  quando a resposta for 401.

## 1.3.1

### Corrigido

- `modo_publicacao` tinha o **schema** (`list(reserva|todos)`) no lugar do
  **valor padrão** nas opções do app. O Supervisor recusava a instalação com
  "value must be one of ['reserva', 'todos']". O valor padrão agora é `reserva`.
- `scripts/validar-addon.py` agora confere o **valor** de cada opção contra o
  schema (o mesmo check que o Supervisor faz) — esse bug passa a ser pego antes
  de publicar.

## 1.3.0

### Adicionado

- **Aprovação pelo painel web**: o painel agora lista as notícias que estão
  esperando e permite **Publicar**, **Pular** ou **Publicar todas** — sem
  precisar responder no WhatsApp. A fila do painel e a do WhatsApp são a mesma:
  o que você aprovar num lugar não é perguntado de novo no outro.
- Rotas novas na API: `GET /api/fila`, `POST /api/fila/{id}/publicar`,
  `POST /api/fila/{id}/pular` e `POST /api/fila/todas`.
- `scripts/teste-fila-web.js` (testa a fila pela API) e
  `scripts/teste-publicacao.js` (testa os modos de canal).

### Corrigido

- **As opções do app não chegavam ao bot**: o `run.sh` usava
  `#!/usr/bin/env bash`, e é o *bashio* (via `#!/usr/bin/with-contenv bashio`)
  quem lê as opções configuradas no painel do app. Agora o shebang está correto
  e o script avisa no log se o bashio não estiver disponível.
- O log agora mostra a configuração no boot (canal, telefone mascarado, canais,
  IA e porta) e diz onde configurar o que faltar.

## 1.2.0

### Adicionado

- **Mais de um canal**: nova opção `canais` (lista separada por vírgula) e
  `modo_publicacao` com dois modos — `reserva` (publica no primeiro canal que
  funcionar, os outros ficam de reserva) e `todos` (publica em todos). Um canal
  quebrado não impede a publicação nos demais.
- **QR Code do WhatsApp no painel web**: o cartão "Conectar o WhatsApp" aparece
  no painel com o QR Code pronto para escanear, se atualizando sozinho a cada
  10 segundos. Não precisa mais olhar o log do app para conectar.
- O painel mostra o estado da conexão do WhatsApp e quantos canais estão
  configurados.
- Nova opção `painel_porta`: o painel passa a usar a porta configurada (antes
  o `run.sh` forçava 8090 e ignorava a configuração). O ingress do HA continua
  na 8090 — quando as duas diferem, o app escuta nas duas.
- `scripts/teste-publicacao.js` (testa os dois modos de publicação) e
  `scripts/validar-addon.py` (valida o `config.yaml` contra o schema do
  Supervisor antes de publicar).

### Corrigido

- `homeassistant: true` no `config.yaml` é inválido no Supervisor atual (o campo
  espera uma versão). Trocado por `hassio_api: true`, que funciona em todas as
  versões — era o que impedia o app de aparecer na loja.
- `ingress_panel` não existe mais: agora são `panel_icon`, `panel_title` e
  `panel_admin`.
- A opção `llm_provedor` usava um valor fora do padrão aceito pelo Supervisor;
  passou a ser `list(groq|ha_assist|ollama|heuristica)`.
- A ponte com o Home Assistant agora tenta com e sem token, em vez de desistir
  quando o `SUPERVISOR_TOKEN` não está disponível.

## 1.1.0

### Adicionado

- **Integração automática com o Home Assistant**: o app se conecta sozinho pela
  rede interna do Supervisor (`http://supervisor/core/api`) e:
  - avisa o celular (pelo app do HA) quando entra notícia na fila de aprovação;
  - publica a fila em `sensor.bot_noticias_pendentes`;
  - dispara o evento `bot_noticias_varredura` ao final de cada varredura.
- **Painel do bot dentro do Home Assistant** (`ingress`): o painel abre em uma aba
  do dashboard, sem digitar IP — e funciona também de fora de casa.
- Novas opções: `notificar_ha`, `dispositivo_notificacao`, `publicar_estado_ha`.
- As opções do add-on agora chegam ao bot por variáveis de ambiente (antes só o
  `config.json` era lido).
- Comprovante: `ha_assist` passa a usar o `SUPERVISOR_TOKEN` automaticamente —
  não precisa mais colar token no `config.json`.
- Documentação do app: `README.md` (vitrine), `DOCS.md` (completa), `icon.png`,
  `logo.png` e `CHANGELOG.md`.
- `scripts/teste-ha.js`: testa a ponte com o HA sem precisar de um HA de verdade.

### Corrigido

- `Boolean("false")` era tratado como `true` nas opções vindas do add-on — agora
  `notificar_ha` e `publicar_estado_ha` respeitam o valor `false`.
- O app não loga mais a cada minuto quando o Home Assistant está fora do ar.
- Notícias que já estavam na fila antes de o app subir não geram mais aviso
  duplicado.

## 1.0.0

- Primeira versão: coleta por RSS + Google Trends, filtro de pulverização,
  ranqueamento, reescrita por IA (Groq / Assist do HA / Ollama / heurística),
  fila de aprovação no WhatsApp, publicação no canal, painel web e resumo
  diário automático.
