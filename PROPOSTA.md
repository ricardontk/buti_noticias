# Proposta — Bot de Notícias: Drones de Pulverização (BR + Mundo)

**Versão 4 — fluxo confirmado + ranking de popularidade.**
Status: proposta consolidada, aguardando "mandaballs" para implementar.

---

## 1. Fluxo confirmado

```
        [BOTÃO no painel web do celular]
                    │
                    ▼
        varredura das fontes na internet
                    │
        dedupe + filtro "é sobre drone de pulverização?"
                    │
        RANKING por popularidade do dia
                    │
        LLM local reescreve UMA frase (PT-BR) + normaliza o link
                    │
                    ▼
   ┌────────────────────────────────────────────────┐
   │  WhatsApp DM para o SEU número pessoal:       │
   │  📰 Notícia 1/5 — XAG apresenta P150...        │
   │  Resumo: ...                                    │
   │  Link: ...                                      │
   │  O que você achou?                              │
   │  1 gostei (publicar)  2 não gostei  3 editar    │
   └────────────────────────────────────────────────┘
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
    "1 gostei"            "2 não gostei"
         │                     │
         ▼                     ▼
   publica no CANAL     descarta + aprende
   (WhatsApp Channel)   (termos penalizados)
```

O bot **nunca publica sozinho**: ele pergunta, você responde.

### Como o bot fala com você
- Destino fixo: seu **número pessoal** (configurável, padrão vazio).
- O bot usa a **mesma conta** que publica no canal.
- Envio direto via `client.sendMessage("<seu-numero>@c.us", ...)`, com o mesmo padrão de
  `resolvePhoneNumber()` do `xag_bot` (trata `@lid` e `@c.us`).
- Respostas suas chegam em `client.on("message")` → o bot casa com a **fila pendente** em
  `state.json` (sobrevive a restart do container).

### Modo "as mais lidas do dia"
Além do botão, um resumo diário automático (ex.: 07:00 BRT) busca as notícias mais lidas
do dia e **também pede sua aprovação** antes de publicar. Mesmo fluxo, outra origem.

---

## 2. Como medir "mais lidas" (a parte delicada)

Não existe fonte pública gratuita com **contagem de leituras por matéria** para o nicho de
drones de pulverização. O que existe, e foi validado agora:

| Sinal | Fonte | Como funciona | Peso |
|---|---|---|---|
| **A. Alcance da notícia** | contagem de veículos |agrupar por similaridade de título; quantos veículos distintos cobriram o mesmo fato | **alto** |
| **B. "Mais lidas" dos portais** | G1, CNN Brasil, Terra, UOL, Agronet, Canal Rural, Portal do Agro, Poder360 | ⚠️ **renderizado por JS** — precisa de Puppeteer (o add-on já tem Chromium!) | **muito alto** |
| **C. Tendências do Google** | `trends.google.com/trending/rss?geo=BR` | ✅ **validado agora**: RSS funciona, traz `ht:approx_traffic` e `ht:news_item` com título+URL+imagem | **alto** quando casar |
| **D. Sinais de rede social** | Reddit (r/Agriculture, r/dronevideos, r/AgTech) | API JSON pública, `score` = upvotes. ⚠️ testei e o acesso sem User-Agent deu **403** — precisa de UA + pode falhar por IP | médio |
| **E. API com métricas (opcional)** | NewsData.io, GNews, YouTube Data API | métricas reais de views. Exige chave (e custo no NewsData) | alto (se configurado) |

**Estratégia de implementação:**
1. Sempre: **A** (cluster de veículos) + recência + peso da fonte. É gratuito, instantâneo e
   funciona bem em nicho — se 5 portais cobriram o mesmo lançamento, é a notícia do dia.
2. Opcional (ligável no `config.json`): **B** com Puppeteer, o mesmo Chromium do WhatsApp
   (~4 s por página, roda 1× por dia no resumo e sob demanda no botão).
3. **C** entra como bônus: se algum termo do dia casar com a notícia, ela sobe muito.
4. **D/E** ficam como plugins, ativados por configuração.

### Fórmula do score
```
score = 3.0 × normaliza(alcance)          // nº de veículos distintos
      + 4.0 × posicao_mais_lidas           // 0..1 conforme a posição na lista
      + 2.0 × normaliza(traffic_trends)    // se casar
      + 1.0 × recencia_24h                 // 0..1
      + 0.5 × peso_fonte + Σ perfil        // o que você aprovou/pulou
```

---

## 3. IA leve dentro do Home Assistant

A tarefa do LLM é minúscula: **reescrever uma frase curta em PT-BR + normalizar o link**.

- **Principal:** `POST /api/conversation/process` do HA (usando o Ollama local instalado no HA).
  Requer um **LLM token** do HA. Modelo recomendado: `qwen2.5:1.5b-instruct` (~1 GB, melhor PT-BR
  da categoria leve). Alternativas: `llama3.2:1b`, `gemma3:1b`.
- **Fallback automático:** heurística — 1ª frase do feed, HTML limpo, corte em 140 chars.
  Se o Ollama cair, o bot publica assim mesmo.

**Uma chamada para N títulos** (formato `1. TÍTULO | LINK`), não N chamadas.

---

## 4. Add-on Home Assistant (irmão do `xag_bot`)

```yaml
name: "Bot de Notícias - Drones de Pulverização"
version: "1.0"
slug: "bot_noticias"
description: "Coleta e publica notícias de drones de pulverização em canal do WhatsApp, com aprovação do usuário"
startup: application
boot: auto
init: false
arch:
  - aarch64
options:
  canal_id: ""            # ex.: 120363168650684996@newsletter
  meu_numero: ""          # seu WhatsApp pessoal (só dígitos, com DDI+DDD)
  resumo_diario: "07:00"  # horário do resumo "mais lidas do dia" (BRT)
  max_noticias: 5
ingress: true
ports:
  8090/tcp: 8090
map:
  - share:rw
  - homeassistant_config:rw
homeassistant: true
```

- Sessão WhatsApp: `/share/bot_noticias/.wwebjs_auth`
- Estado/fila/histórico: `/share/bot_noticias/state.json`
- Fontes: `/share/bot_noticias/sources.json` (editável pelo painel)
- `homeassistant: true` → habilita o add-on a usar a API do HA (para o Assist/Ollama).

---

## 5. Painel web (o botão) — porta 8090

Mobile-first, servido pelo add-on, aberto no celular na mesma rede:

```
┌──────────────────────────────────┐
│  🚁 Drones de Pulverização       │
│  ────────────────────────────    │
│  [ 🔍 Buscar notícias agora ]    │
│  [ 📈 Ver as mais lidas do dia ]  │
│                                  │
│  Status: pronto                   │
│  Último envio: 21/10 09:12        │
│  Fontes OK: 24 / 26               │
│  Fila aguardando você: 3          │
└──────────────────────────────────┘
```

O painel **dispara**; a **aprovação é no WhatsApp** (um lugar só, com histórico do bot).
Extras: status das fontes, link para editar `sources.json`, log das últimas publicações.

---

## 6. Fontes

**Brasil** — G1 Agro (`/rss/g1/agronegocios/`, `/rss/g1/agro/`), Globo Rural, CNA, AgroSapiens,
Rural Centro, AgroNews, Portal do Agro, Agronet, DroneAg, Poder360 Agro, MAPA, ANAC, XAG Brasil.
**Mundo** — Reuters, AgFunder, Precision Agriculture, Ag Drone Report, UAV News/Aerial News,
FlightGlobal, The Drone Report, Unmanned Air, EASA, FAA, DJI Agras.
**Rede de segurança** — Google News RSS (`"drone de pulverização"`, `"spray drone"`,
`"agricultural drone"`) + RSS do YouTube dos canais oficiais.

O RSS do G1 foi validado: traz `atom:subtitle` (resumo pronto), `media:content` (imagem) e
`pubDate` — ou seja, **quase tudo que o LLM precisa já vem no feed**.

---

## 6.1 Como descobrir o ID do canal — **RESOLVIDO** ✅

O **JID do canal** tem o formato `120363198765432100@newsletter` e **não é** o código de convite
do link (`https://whatsapp.com/channel/0029VaXXXX` → esse `0029Va...` é *invite code*, não JID).

**Já resolvidos para este projeto (21/10/2026):**

**Modelo dos canais (exemplo — os seus IDs reais ficam no `config.json`):**

| Invite code | Nome | JID | Papel da conta |
|---|---|---|---|
| `0029VbDlFsg2P59ixQI5MS0h` | **Drones de Pulverização** | `120363198765432100@newsletter` | owner |
| `0029Vb9GuFtEwEjw8LgOfI0i` | **Drone De Pulverização** | `120363198765432101@newsletter` | owner |

A conta que publica é a mesma que você usa no celular (o app faz login com QR Code).
Ela precisa ser **dona** dos canais — por isso o bot tem duas entradas em
`canais_alternativos` no `config.json`: o canal principal e o duplicado.

> Os IDs reais (canal e telefone) **não** ficam neste repositório: eles são
> preenchidos por você nas opções do app, depois de instalar.

**Ferramenta criada:** `scripts/listar_canais.js` (comandos `listar`, `resolver`, `consultar`,
`criar`, `testar`).

> ⚠️ Armadilha técnica resolvida: `window.WWebJS.getChannelMetadata()` do wwebjs **está
> quebrado** na versão atual do WhatsApp Web — ele chama
> `WAWebNewsletterModelUtils.getRoleByIdentifier()`, função que foi removida
> (erro: *"getRoleByIdentifier is not a function"*). A correção é chamar o job de metadados
> direto com o papel `GUEST`:
> ```js
> window.require("WAWebNewsletterMetadataQueryJob")
>        .queryNewsletterMetadataByInviteCode(code, "GUEST")  // → resp.idJid
> ```
> Isso vale para o `publisher.js` também: **não** usar `getChannelMetadata()`.

---

## 7. Riscos

0. ⚠️ **A dependência do `xag_bot` está quebrada hoje.** O `package.json` aponta para
   `https://github.com/lindionez/whatsapp-web.js/archive/refs/heads/feat/fix-_serialized-id-fallback.tar.gz`
   e esse **branch foi deletado** (404 confirmado agora). O `main` do fork está em `1.34.7` —
   igual ao upstream `wwebjs/whatsapp-web.js@1.34.7` — e **já tem `getChannels()` e
   `createChannel()`**. Ou seja: o novo projeto deve usar `whatsapp-web.js@^1.34.7` do upstream,
   e o `xag_bot` provavelmente precisa do mesmo ajuste (ou o build do container falha).
1. **Canal (`@newsletter`)** — suportado pelo `whatsapp-web.js`, mas houve bug
   (`getLastMsgKeyForAction is not a function`, fechado em fev/2026) e seu `package.json` usa um
   **fork**, não a `master` oficial. → Publicar primeiro em **grupo** (garantido) e trocar o
   destino em 1 linha no `publisher.js` depois de validar. Alternativas: `master` oficial ou
   Baileys (newsletter nativo, mas reescreve a conexão).2. **Número dedicado** — o canal exige admin; o `xag_bot` já ocupa uma sessão. Duas sessões no
   mesmo número se conflitam → número novo, exclusivo.
3. **ToS do WhatsApp** — envio unidirecional, baixo volume, sempre com aprovação humana: risco
   baixo comparado ao bot de atendimento. Conta dedicada de qualquer forma.
4. **Direitos autorais** — publicar **título reescrito + 1 frase original + link**, nunca o texto
   completo. Imagem só se baixada do site da fonte (o RSS do G1 já entrega a URL).
5. **Puppeteer para "Mais lidas"** — usa o mesmo Chromium do WhatsApp; cuidado com memória
   (abrir 1 aba por vez, fechar após uso).

---

## 8. Arquivos

```
projeto bot noticias/
├── PROPOSTA.md · README.md · DOCS.md · CHANGELOG.md
├── config.yaml          manifesto do add-on
├── package.json · Dockerfile · run.sh · .env.example
├── sources.json         feeds iniciais
├── painel/              index.html · painel.js
└── src/
    ├── index.js         bootstrap (WhatsApp + HTTP + fila + agendador)
    ├── config.js · client.js · sources.js · fetcher.js
    ├── llm.js           ha_assist | ollama | heuristica
    ├── relevance.js     filtro "é sobre pulverização?" + tag BR/Mundo
    ├── popularity.js    score de alcance + mais lidas (Puppeteer) + trends
    ├── formatter.js     card de aprovação + mensagem final do canal
    ├── publisher.js     canal (fallback grupo)
    ├── queue.js         fila de aprovação (state.json)
    ├── state.js · profile.js · api.js · admin.js
```

## 9. Ordem de implementação

1. `config.js`, `state.js`, `sources.json`
2. `fetcher.js` + `sources.js` → primeira varredura real
3. `relevance.js` + `popularity.js` (A + C primeiro, B depois)
4. `llm.js` (heurística → HA/Ollama) + `formatter.js`
5. `client.js` (extrair do `bot.js`) + `publisher.js` → **grupo** primeiro
6. `queue.js` + comandos de aprovação no WhatsApp
7. `api.js` + `painel/` → o botão
8. `popularity.js` sinal B (mais lidas via Puppeteer)
9. Migrar destino grupo → **canal**
10. `profile.js` (aprendizado) + Dockerfile/`run.sh`/`config.yaml` do add-on
