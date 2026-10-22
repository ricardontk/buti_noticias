/**
 * src/config.js — carrega e normaliza a configuração do bot.
 *
 * Ordem de precedência:
 *   1) valores padrão (DEFAULTS)
 *   2) config.json (na raiz do projeto ou $CONFIG_PATH)
 *   3) variáveis de ambiente (têm prioridade — usadas no Docker/add-on)
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const DEFAULTS = {
    canal_id: "",
    canais: [], // lista de canais (JID) — além do canal_id
    modo_publicacao: "reserva", // "reserva" (primeiro que funcionar) | "todos"
    canais_alternativos: {},
    meu_numero: "",
    admin_phone: "",
    destino_padrao: "canal", // "canal" | "grupo"
    destino_grupo: "",
    resumo_diario: {
        ativo: true,
        hora: "07:00",
        timezone: "America/Sao_Paulo",
        max_noticias: 5,
    },
    busca: {
        max_noticias_por_varredura: 8,
        max_noticias_por_dia: 10,
        janela_horaria: { inicio: "06:00", fim: "21:00" },
        usar_mais_lidas: true,
        usar_tendencias_google: true,
        // resolução de links do Google News (travava o scan no Raspberry Pi)
        resolver_orcamento_ms: 25000, // tempo total para resolver todos os links
        resolver_paralelismo: 3, // quantos links resolver ao mesmo tempo
        // texto das matérias (por HTTP, sem abrir navegador)
        texto_timeout_ms: 8000,
        texto_orcamento_ms: 20000, // tempo total para buscar todos os textos
        texto_paralelismo: 4,
    },
    llm: {
        provedor: "heuristica", // "groq" | "ha_assist" | "ollama" | "heuristica"
        groq_url: "https://api.groq.com/openai/v1",
        groq_api_key: "",
        groq_modelo: "qwen/qwen3.8-27b",
        ha_url: "http://supervisor/core/api/conversation/process",
        ha_token: "",
        agent_id: null,
        ollama_url: "http://localhost:11434/api/generate",
        ollama_modelo: "qwen2.5:1.5b-instruct",
        timeout_ms: 60000,
        fallback_heuristico: true,
        // Teto de texto da matéria enviado para a IA (protege o free tier)
        max_chars_texto: 900, // por matéria
        max_chars_total: 9000, // no total de um scan (~2,5 mil tokens)
    },
    publicacao: {
        incluir_imagem: true,
        prefixo: "🚁",
        rodape: "Fonte: {fonte} | {data}",
        gancho: "💬 Se você também aplica com drone, me conta aqui.",
    },
    painel: {
        porta: 8090,
        porta_ingress: 8090, // porta usada pelo ingress do Home Assistant
        token: "",
    },
    // Ponte com o Home Assistant (o add-on já vem com `homeassistant: true`,
    // então o token chega sozinho por SUPERVISOR_TOKEN).
    ha: {
        url: "http://supervisor/core/api",
        token: "",
        notificar: true, // avisa o celular quando entra notícia na fila
        dispositivo: "", // "" = escolhe o primeiro celular encontrado
        publicar_estado: true, // publica a fila em sensor.bot_noticias_pendentes
        sensor_fila: "sensor.bot_noticias_pendentes",
        timeout_ms: 10000,
    },
    caminhos: {
        auth: path.join(ROOT, ".wwebjs_auth"),
        estado: path.join(ROOT, "state.json"),
        fontes: path.join(ROOT, "sources.json"),
        config: path.join(ROOT, "config.json"),
    },
    chromium: process.env.CHROMIUM_PATH || "",
};

function deepMerge(base, over) {
    if (!over || typeof over !== "object" || Array.isArray(over)) return over === undefined ? base : over;
    const out = Array.isArray(base) ? [...base] : { ...base };
    for (const [k, v] of Object.entries(over)) {
        out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge(base?.[k] ?? {}, v) : v;
    }
    return out;
}

function load() {
    const cfgPath = process.env.CONFIG_PATH || DEFAULTS.caminhos.config;
    let cfg = {};
    if (fs.existsSync(cfgPath)) {
        try {
            const raw = fs.readFileSync(cfgPath, "utf-8");
            cfg = JSON.parse(raw);
            delete cfg._comentario;
        } catch (err) {
            console.error(`⚠️ config.json inválido (${cfgPath}):`, err.message);
        }
    } else {
        console.log(`ℹ️ config.json não encontrado em ${cfgPath} — usando padrões.`);
    }

    cfg = deepMerge(DEFAULTS, cfg);

    // Sobrescritas por ambiente (úteis no add-on, sem precisar editar arquivo)
    if (process.env.CANAL_ID) cfg.canal_id = process.env.CANAL_ID;
    if (process.env.CANAIS) {
        cfg.canais = String(process.env.CANAIS)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    }
    if (process.env.MODO_PUBLICACAO) cfg.modo_publicacao = process.env.MODO_PUBLICACAO;
    if (process.env.MEU_NUMERO) cfg.meu_numero = process.env.MEU_NUMERO;
    if (process.env.ADM_PHONE) cfg.admin_phone = process.env.ADM_PHONE;
    if (process.env.HA_TOKEN) cfg.llm.ha_token = process.env.HA_TOKEN;
    if (process.env.GROQ_API_KEY) cfg.llm.groq_api_key = process.env.GROQ_API_KEY;
    if (process.env.GROQ_MODELO) cfg.llm.groq_modelo = process.env.GROQ_MODELO;
    if (process.env.LLM_PROVEDOR) cfg.llm.provedor = process.env.LLM_PROVEDOR;
    if (process.env.LLM_MODELO) cfg.llm.ollama_modelo = process.env.LLM_MODELO;
    if (process.env.PORT) cfg.painel.porta = parseInt(process.env.PORT, 10);
    if (process.env.INGRESS_PORT) cfg.painel.porta_ingress = parseInt(process.env.INGRESS_PORT, 10);
    if (process.env.PAINEL_TOKEN) cfg.painel.token = process.env.PAINEL_TOKEN;
    if (process.env.AUTH_PATH) cfg.caminhos.auth = process.env.AUTH_PATH;
    if (process.env.ESTADO_PATH) cfg.caminhos.estado = process.env.ESTADO_PATH;
    if (process.env.FONTES_PATH) cfg.caminhos.fontes = process.env.FONTES_PATH;

    // Home Assistant: tokens e opções vindas do add-on
    const paraBool = (v) => /^(1|true|sim|on|yes)$/i.test(String(v).trim());
    if (process.env.HA_URL) {
        cfg.ha.url = process.env.HA_URL;
        cfg.llm.ha_url = process.env.HA_URL.replace(/\/+$/, "") + "/conversation/process";
    }
    if (process.env.HA_TOKEN) cfg.ha.token = process.env.HA_TOKEN;
    if (process.env.NOTIFICAR_HA) cfg.ha.notificar = paraBool(process.env.NOTIFICAR_HA);
    if (process.env.PUBLICAR_ESTADO_HA) cfg.ha.publicar_estado = paraBool(process.env.PUBLICAR_ESTADO_HA);
    if (process.env.DISPOSITIVO_NOTIFICACAO) cfg.ha.dispositivo = process.env.DISPOSITIVO_NOTIFICACAO;
    if (process.env.RESUMO_DIARIO_HORA) cfg.resumo_diario.hora = process.env.RESUMO_DIARIO_HORA;
    if (process.env.MAX_NOTICIAS) cfg.resumo_diario.max_noticias = parseInt(process.env.MAX_NOTICIAS, 10);

    // No add-on, o token do Supervisor já serve para o Assist do HA.
    if (!cfg.llm.ha_token && process.env.SUPERVISOR_TOKEN) {
        cfg.llm.ha_token = process.env.SUPERVISOR_TOKEN;
    }

    // Saneamento
    cfg.canal_id = (cfg.canal_id || "").trim();
    cfg.meu_numero = String(cfg.meu_numero || "").replace(/\D/g, "");
    cfg.admin_phone = String(cfg.admin_phone || cfg.meu_numero || "").replace(/\D/g, "");

    return cfg;
}

module.exports = { load, DEFAULTS, ROOT };
