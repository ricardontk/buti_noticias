# Bot de Notícias — Drones de Pulverização

Coleta notícias sobre **drones de pulverização** (Brasil e mundo), reescreve no tom do
seu canal e publica no **canal do WhatsApp** — mas **sempre depois da sua aprovação**.

Você manda um comando no seu WhatsApp (ou aperta o botão), o bot varre as fontes,
separa o que é realmente sobre pulverização, ordena por relevância e te manda um
**card por notícia**. Você responde `1` para publicar, `2` para pular. Só o que você
aprova vai para o canal.

## O que ele faz

- 🔎 Varre RSS/Atom de dozens de fontes e do Google Trends
- 🎯 Filtra só o que é sobre pulverização e descarta o que já mandou antes
- 🤖 Reescreve o texto em português com o tom do canal (Groq, Assist do HA ou Ollama)
- ✅ **Nada é publicado sem você aprovar** — o card chega no seu WhatsApp pessoal
- 🖥️ Painel web completo: **veja as notícias e aprove/­pule por lá mesmo**
- 📱 Painel web integrado ao Home Assistant (o botão fica dentro do HA)
- 📲 QR Code do WhatsApp direto no painel web (para conectar sem olhar o log)
- 🔢 Publica em **um ou mais canais**, com opção de reserva
- 🔔 Avisa no celular quando chega notícia nova
- ⏰ Resumo automático diário no horário que você escolher

## Instalação

1. No Home Assistant: **Ajustes → Aplicativos → Adicionar repositório**
2. Cole a URL do repositório e clique em **Adicionar**
3. Abra o app **Bot de Notícias** e clique em **Instalar**
4. Configure as opções (canal, seu número, chave da IA) e abra o app para
   escanear o QR Code do WhatsApp

Requisitos: Home Assistant OS em **Raspberry Pi 4 (aarch64)** e uma conta de
WhatsApp para conectar.

## Opções principais

| Opção | Para que serve |
|---|---|
| `canal_id` | ID do canal de newsletter onde as notícias aprovadas serão publicadas |
| `meu_numero` | Seu WhatsApp — é para cá que chegam os cards de aprovação |
| `llm_provedor` | `groq` (nuvem, leve), `ha_assist` (local), `ollama` ou `heuristica` |
| `groq_api_key` | Chave da Groq (usada quando `llm_provedor` = `groq`) |
| `resumo_diario_hora` | Horário do resumo automático (ex.: `07:00`) |
| `notificar_ha` | Avisar no celular pelo app do Home Assistant |
| `painel_token` | Senha do painel (vazio = painel aberto) |

A lista completa está na [documentação](DOCS.md).

## Documentação

Tudo o que você precisa saber está em **[DOCS.md](DOCS.md)**: opções, comandos do
WhatsApp, integração com o Home Assistant, solução de problemas e notas para
desenvolvedores.
