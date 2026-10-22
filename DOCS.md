# Documentação — Bot de Notícias (Drones de Pulverização)

> Bot que varre fontes de notícias, **pede a sua aprovação** e publica no canal do
> WhatsApp. Nada é publicado sem você autorizar.

---

## 1. Para onde vão as mensagens

Esta é a dúvida mais comum, então fica explícito:

| Tipo de mensagem | Destino | Onde você configura |
|---|---|---|
| Card de aprovação ("1 publicar, 2 pular…") | **Seu WhatsApp particular** | opção `meu_numero` |
| Avisos ("varredura concluída", erros, resumo do dia) | **Seu WhatsApp particular** | opção `meu_numero` |
| Notícia aprovada (texto + imagem) | **Canal de newsletter** | opção `canal_id` |
| Notícia aprovada (quando o canal não existe) | Grupo alternativo | `canais_alternativos` no `config.json` |

Ou seja: **os avisos vão para o seu WhatsApp particular**; só o conteúdo publicado
vai para o canal. O bot nunca manda mensagem de controle para o canal.

O número do app (`meu_numero`) é também quem pode conversar com ele: qualquer
outro número é ignorado.

---

## 2. Instalação

### Requisitos

- Home Assistant OS com Supervisor (Raspberry Pi 4 / aarch64)
- ~600 MB de RAM livres (o app roda o Chromium para o WhatsApp Web)
- Uma conta de WhatsApp para conectar (o app usa o QR Code)

### Passos

1. **Ajustes → Aplicativos → Adicionar repositório** → cole a URL do repositório
2. **Adicionar** → abra o app **Bot de Notícias** → **Instalar**
3. Clique em **Configurar** e preencha as opções (seção 3)
4. Abra o app e clique em **Iniciar** — aparece o QR Code do WhatsApp
5. Escaneie com o celular (WhatsApp → Aparelhos conectados → Conectar)
6. Pronto: mande `noticias` no seu WhatsApp ou use o painel

> O login fica salvo no volume `/share/bot_noticias/.wwebjs_auth` — você não
> precisa escanear de novo a cada reinício.

---

## 3. Opções do app

Todas em **Ajustes → Aplicativos → Bot de Notícias → Configuração**.

| Opção | Padrão | Para que serve |
|---|---|---|
| `canal_id` | vazio | ID do canal onde as notícias aprovadas são publicadas (`120363...@newsletter`) |
| `meu_numero` | vazio | **Seu** WhatsApp: chegam os cards de aprovação e os avisos |
| `llm_provedor` | `groq` | `groq` (nuvem), `ha_assist` (Assist/Ollama do HA), `ollama`, `heuristica` |
| `groq_api_key` | vazio | Chave da Groq (só usada com `llm_provedor` = `groq`) |
| `groq_modelo` | `qwen/qwen3.8-27b` | Modelo de texto da Groq |
| `resumo_diario_hora` | `07:00` | Horário do resumo automático (fuso America/Sao_Paulo) |
| `max_noticias` | `5` | Quantas notícias entram no resumo diário |
| `painel_token` | vazio | Senha do painel web. **Vazio = painel aberto** na sua rede |
| `notificar_ha` | `true` | Avisa o celular (pelo app do HA) quando entra notícia na fila |
| `dispositivo_notificacao` | vazio | Qual celular avisar. Vazio = escolhe o primeiro `mobile_app_*` encontrado |
| `publicar_estado_ha` | `true` | Publica a fila em `sensor.bot_noticias_pendentes` |

Opções que não aparecem aqui (fontes, janela de horário, limite por dia,
popularidade, canal alternativo) ficam no `config.json`, dentro do volume
`/share/bot_noticias/` — são editáveis sem reiniciar o app.

### Escolher a IA

| Provedor | Peso no RPi4 | Qualidade | Observação |
|---|---|---|---|
| `groq` | nenhum (nuvem) | alta | **Recomendado** no Raspberry Pi 4 |
| `ha_assist` | alto (roda no HA) | média | Não precisa de token: o app usa o `SUPERVISOR_TOKEN` sozinho |
| `ollama` | muito alto | média | Só para máquina forte |
| `heuristica` | nenhum | baixa | Sem IA: filtra por palavras-chave. Bom plano B |

---

## 4. Como funciona

```
[botão no painel] ou [comando no WhatsApp] ou [resumo diário automático]
        ↓
   varredura das fontes (RSS + Google Trends)
        ↓
   filtra o que é sobre pulverização e o que você ainda não viu
        ↓
   ordena por relevância + popularidade + o que você já aprovou/pulou
        ↓
   reescreve em português no tom do canal (IA)
        ↓
   manda um card por notícia para o SEU WhatsApp
        ↓
   você responde 1 (publicar) · 2 (pular) · 3 (editar) · 4 (ver original)
        ↓
   o que foi aprovado vai para o canal
```

### Comandos do WhatsApp

| Comando | O que faz |
|---|---|
| `noticias` (ou `buscar`, `scan`, `vai`) | dispara uma varredura |
| `mais lidas` (ou `populares`) | varredura priorizando popularidade |
| `status` | mostra o estado do bot |
| `fontes` | lista as fontes e o resultado da última varredura |
| `modelos` | lista os modelos de texto disponíveis |
| `modelo <id>` | troca o modelo de IA ativo |
| `cancelar` | limpa a fila de aprovação |
| `ajuda` | lista os comandos |

Durante a fila de aprovação, `1`–`5` publicam/pulam, `todos` publica tudo e
`publicar tudo` idem.

---

## 5. Home Assistant

O app **já roda dentro do Home Assistant** e se integra sozinho. Não é preciso
mexer em `configuration.yaml` nem criar automação.

### O que você recebe

| Recurso | Onde aparece |
|---|---|
| Painel do bot com os botões | *Ajustes → Aplicativos → Bot de Notícias → Abrir interface web*, ou como painel do dashboard (*Painéis → Adicionar painel → Aplicativo*) |
| Aviso de notícia nova | Notificação push no celular (via app do Home Assistant) |
| Fila de aprovação | `sensor.bot_noticias_pendentes` (*Ferramentas do desenvolvedor → Estados*) |
| Eventos | `bot_noticias_varredura` — útil em automações da interface |

### Automação opcional (só na interface)

*Ajustes → Automations & Scenes → Criar automação → Acionador: Evento → Tipo:
`bot_noticias_varredura`* → Ação: *Notificar*. Isso substitui o aviso padrão
por um do seu jeito.

### Modo alternativo: o HA puxa o bot

Se você preferir que o Home Assistant **consuma** a API do bot em vez de o bot
falar com o HA, existe o modelo "clássico" em [`ha/opcional/`](ha/opcional/):
sensores `rest`, scripts e dashboard prontos. **Esse modelo exige** editar o
`configuration.yaml` do HA e reiniciar — por isso ele é opcional.

---

## 6. Solução de problemas

| Sintoma | O que fazer |
|---|---|
| App não conecta ao WhatsApp | Abra o app e clique em **Iniciar** para ver o QR Code. Confirme que o celular está na mesma conta. |
| "Chromium não encontrado" | A imagem aarch64 do Home Assistant já traz o Chromium. Se você montou a imagem à mão, instale `chromium` no Dockerfile. |
| Nenhum aviso no celular | O app do Home Assistant precisa estar instalado no celular e com as notificações ativas. Veja o log do app: ele avisa se não encontrar nenhum `notify.mobile_app_*`. |
| Varredura volta sem nada | Normal quando não há novidade relevante. Use `status` para conferir a última varredura. |
| "Já existe uma varredura em andamento" | Espere terminar — o log mostra o tempo de cada varredura. |
| Publicação falhou | O ID do canal pode ter mudado. Use `scripts/listar_canais.js` (dentro do repositório) para conferir. |
| Bot ignorando suas mensagens | Só o número em `meu_numero` conversa com ele. |

Os logs ficam em **Ajustes → Aplicativos → Bot de Notícias → Registros** (ou
`/share/bot_noticias/`).

---

## 7. Privacidade e dados

- O app guarda localmente: login do WhatsApp, histórico do que já mandou, o
  perfil do que você aprova/pula e a fila atual — tudo em `/share/bot_noticias/`.
- As fontes são públicas (RSS). O texto é reescrito pela IA escolhida
  (Groq, Ollama local ou o Assist do seu HA) — se você usa `ha_assist` ou
  `ollama`, **nenhum texto sai da sua casa**.
- O app só fala com o Home Assistant pela rede interna do Supervisor.

---

## 8. Para quem vai desenvolver

```
projeto bot noticias/
├── README.md              introdução (esta vitrine do app store)
├── DOCS.md                documentação completa
├── CHANGELOG.md           histórico de versões
├── config.yaml            configuração do App (add-on): opções, ingress, portas
├── Dockerfile             imagem aarch64 (Node + Chromium)
├── run.sh                 opções do app -> variáveis de ambiente -> Node
├── package.json
├── config.json            configuração do bot (canal, IA, busca…)
├── sources.json           feeds (editável sem rebuild)
├── painel/                painel web (o "botão")
│   ├── index.html
│   └── painel.js
├── ha/                    documentação da integração com o HA
│   ├── README.md
│   └── opcional/          modelo antigo (HA puxando o bot)
├── scripts/               utilitários e testes
│   ├── listar_canais.js   lista canais/grupos do WhatsApp
│   ├── modelos.js         lista modelos da IA
│   ├── probe.js           sonda de uma URL de feed
│   ├── status.js          estado do bot
│   ├── teste-fila.js      teste da fila de aprovação
│   ├── teste-pipeline.js  teste do pipeline de varredura
│   └── teste-ha.js        teste da ponte com o Home Assistant (sem HA)
└── src/
    ├── index.js           bootstrap: WhatsApp + API + fila + ponte com o HA
    ├── config.js          defaults + config.json + variáveis de ambiente
    ├── client.js          conexão WhatsApp (whatsapp-web.js)
    ├── api.js             HTTP local (painel + ingress do HA)
    ├── ha.js              ponte com o Home Assistant (notificações + estado)
    ├── fetcher.js         RSS/Atom com retry
    ├── relevance.js       filtro, score, tag BR/Mundo
    ├── popularity.js      alcance e popularidade (Google Trends)
    ├── resolver.js        resolve o link real (redirect do Google News)
    ├── llm.js             Groq / Assist do HA / Ollama / heurística
    ├── formatter.js       card de aprovação e mensagem final
    ├── publisher.js       envio ao canal (com fallback para grupo)
    ├── queue.js           fila de aprovação
    ├── state.js           persistência
    └── admin.js           comandos de administração
```

### Rodando fora do add-on

```bash
npm install
node src/index.js
```

Variáveis úteis: `CONFIG_PATH`, `ESTADO_PATH`, `FONTES_PATH`, `AUTH_PATH`,
`PORT`, `CANAL_ID`, `MEU_NUMERO`, `GROQ_API_KEY`, `GROQ_MODELO`, `LLM_PROVEDOR`,
`PAINEL_TOKEN`, `NOTIFICAR_HA`, `PUBLICAR_ESTADO_HA`, `DISPOSITIVO_NOTIFICACAO`,
`SUPERVISOR_TOKEN`.

### Testes

```bash
node scripts/teste-ha.js       # ponte com o HA (sobe um HA falso, não precisa de HA)
node scripts/teste-fila.js     # fila de aprovação
node scripts/teste-pipeline.js # pipeline de varredura
```
