#!/usr/bin/with-contenv bashio
set -e

echo "Iniciando o Bot de Notícias (Drones de Pulverização)..."

# O shebang acima (with-contenv bashio) é obrigatório: é o bashio que lê as
# opções configuradas no painel do app (/data/options.json). Sem ele, nenhuma
# opção do app chega ao bot.
if ! declare -F bashio::config >/dev/null 2>&1; then
    echo "❌ bashio indisponível — as opções do app NÃO serão aplicadas."
    echo "   Verifique o shebang do run.sh e a imagem base (ghcr.io/home-assistant/aarch64-base)."
fi

# Volume persistente do add-on
mkdir -p /share/bot_noticias

# Configuração: usa o config.json do volume se existir; senão copia o modelo
if [ ! -f /share/bot_noticias/config.json ] && [ -f /app/config.json ]; then
    cp /app/config.json /share/bot_noticias/config.json
    echo "ℹ️ config.json inicial copiado para /share/bot_noticias/"
fi

# Fontes: mantém a lista editável no volume
if [ ! -f /share/bot_noticias/sources.json ] && [ -f /app/sources.json ]; then
    cp /app/sources.json /share/bot_noticias/sources.json
    echo "ℹ️ sources.json inicial copiado para /share/bot_noticias/"
fi

export CONFIG_PATH=/share/bot_noticias/config.json
export FONTES_PATH=/share/bot_noticias/sources.json
export ESTADO_PATH=/share/bot_noticias/state.json
export AUTH_PATH=/share/bot_noticias/.wwebjs_auth
export CHROMIUM_PATH=/usr/bin/chromium-browser

# A porta do painel vem da opção do app (padrão 8090). O ingress do Home
# Assistant usa a porta 8090 (definida em ingress_port no config.yaml do app),
# então o app escuta nas duas quando elas são diferentes.
export PORT=8090
export INGRESS_PORT=8090

# --- Opções do add-on (config.yaml) -> variáveis de ambiente ------------------
# Tudo que estiver vazio nas opções continua vindo do config.json do volume.
opcao() {
    if ! declare -F bashio::config >/dev/null 2>&1; then
        return 0
    fi
    bashio::config "$1" 2>/dev/null || true
}

aplica() {
    local nome="$1" chave="$2" valor
    valor="$(opcao "$chave")"
    if [ -n "$valor" ]; then
        export "$nome=$valor"
        # não loga segredos
        case "$nome" in
            *KEY|*TOKEN|*SECRET|*PASSWORD) echo "⚙️  $nome = (definido)" ;;
            *) echo "⚙️  $nome = $valor" ;;
        esac
    fi
}

aplica CANAL_ID canal_id
aplica CANAIS canais
aplica MODO_PUBLICACAO modo_publicacao
aplica MEU_NUMERO meu_numero
aplica PORT painel_porta
aplica LLM_PROVEDOR llm_provedor
aplica GROQ_API_KEY groq_api_key
aplica GROQ_MODELO groq_modelo
aplica RESUMO_DIARIO_HORA resumo_diario_hora
aplica MAX_NOTICIAS max_noticias
aplica PAINEL_TOKEN painel_token
aplica NOTIFICAR_HA notificar_ha
aplica DISPOSITIVO_NOTIFICACAO dispositivo_notificacao
aplica PUBLICAR_ESTADO_HA publicar_estado_ha

node /app/src/index.js
