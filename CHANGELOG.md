# Changelog

Todas as mudanças relevantes deste app.

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
