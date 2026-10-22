# Changelog

Todas as mudanças relevantes deste app.

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
