# Bot de Notícias × Home Assistant

O add-on já faz a integração sozinho. **Nada de `configuration.yaml`, nada de
YAML no HA, nada de IP.** Tudo o que você configura fica nas **opções do app**.

---

## Como funciona (resumo em 4 linhas)

1. O app se conecta no Home Assistant pela rede interna do Supervisor
   (`http://supervisor/core/api`, token `SUPERVISOR_TOKEN`).
2. Quando uma varredura termina e a fila de aprovação cresce, o app **manda uma
   notificação no seu celular** pelo app do HA.
3. A fila fica publicada em `sensor.bot_noticias_pendentes` (visível em
   *Ferramentas do desenvolvedor → Estados*).
4. O painel do bot abre **dentro do HA** (painel de App), com os botões
   "Buscar notícias" e "Mais lidas" — sem digitar endereço nenhum.

## O que você faz no Home Assistant

Nada obrigatório. Se quiser, pode deixar ainda mais automático:

| Passo | Onde | Para quê |
|---|---|---|
| (opcional) Adicionar o app como painel | *Painéis → Adicionar painel → Aplicativo → Bot de Notícias* | Abre o painel do bot dentro de uma aba do dashboard |
| (opcional) Avisar quando chegar notícia | *Automações → Criar automação → Acionador: Evento → Tipo: `bot_noticias_varredura`* | Notificação push a cada varredura |

O segundo passo é opcional porque o app **já** notifica o celular sozinho
(opção `notificar_ha`). Serve se você quiser uma notificação diferente da que o
app manda.

---

## Opções do app (config.yaml do add-on)

Tudo aqui é editável em *Ajustes → Aplicativos → Bot de Notícias → Configuração*.

| Opção | Padrão | Para que serve |
|---|---|---|
| `notificar_ha` | `true` | Avisa o celular quando entra notícia na fila |
| `dispositivo_notificacao` | vazio | Qual celular avisar. Vazio = escolhe o primeiro `mobile_app_*` encontrado |
| `publicar_estado_ha` | `true` | Publica a fila em `sensor.bot_noticias_pendentes` |
| `painel_token` | vazio | Senha do painel. Vazio = painel aberto (só use em rede restrita) |
| `llm_provedor` | `groq` | `groq` (nuvem), `ha_assist` (Ollama/Assist do HA), `ollama`, `heuristica` |
| `groq_api_key` | vazio | Chave da Groq |
| `resumo_diario_hora` | `07:00` | Horário do resumo automático |

### `ha_assist` (usar o Assist do HA em vez da Groq)

Não precisa de token: o add-on já usa o `SUPERVISOR_TOKEN` automaticamente.
Lembre que **Ollama local no Raspberry Pi 4 é lento** — para o RPi4, nuvem
(`groq`) é mais leve.

---

## Eventos disparados pelo app

Podem ser usados em automações (acionador *Evento*):

| Evento | Dados | Quando |
|---|---|---|
| `bot_noticias_varredura` | `origem`, `noticias`, `pendentes` | Ao final de uma varredura |

---

## `ha/opcional/` — o modelo antigo (HA puxando o bot)

Se você preferir o **outro** modelo — em que o Home Assistant é quem puxa o bot
(GET `/api/status`, POST `/api/buscar`) — os arquivos continuam lá:

| Arquivo | Onde colar |
|---|---|
| `opcional/configuration.yaml` | `configuration.yaml` do HA (exige reiniciar o HA) |
| `opcional/scripts/buscar-noticias.yaml` | *Automations & Scenes → Scripts → Edit in YAML* |
| `opcional/scripts/buscar-mais-lidas.yaml` | *Automations & Scenes → Scripts → Edit in YAML* |
| `opcional/automations.yaml` | *Automations & Scenes → Automations → Edit in YAML* |
| `opcional/dashboard.yaml` | Lovelace → view nova → *Edit in YAML* |

Esse modelo **exige** mexer no `configuration.yaml` do HA e reiniciar, e usa o
endereço do bot (que muda se o IP do Raspberry mudar). O modelo automático
descrito acima não tem nenhum desses problemas — é o recomendado.
