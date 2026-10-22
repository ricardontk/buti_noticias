/**
 * src/relevance.js — filtra o que é realmente sobre drone de pulverização
 * e classifica a região (BR / MUNDO).
 */
const fs = require("fs");
const path = require("path");

let PALAVRAS = { fortes: [], contexto: [], negativas: [] };

function carregarPalavras(arquivo) {
    try {
        const dados = JSON.parse(fs.readFileSync(arquivo, "utf-8"));
        PALAVRAS = dados.palavras_chave || PALAVRAS;
    } catch (err) {
        console.error("⚠️ não foi possível carregar palavras-chave:", err.message);
    }
}

const norm = (t) =>
    String(t || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

const BR_TERMOS = [
    "brasil", "brazil", "brasileir", "sao paulo", "são paulo", "mato grosso", "goias", "goias",
    "parana", "rio grande do sul", "bahia", "pernambuco", "ceara", "espirito santo", "amazonia",
    "maranhao", "piaui", "alagoas", "sergipe", "paraiba", "rio grande do norte", "distrito federal",
    "matogrosso do sul", "cna", "embrapa", "MAPA", "agricultura brasileira",
];

const EN_TERMOS = [
    "spray drone", "spray drones", "agricultural drone", "agricultural drones", "crop spraying",
    "uav", "uavs", "drone", "drones", "agricultural spraying", "crop protection", "aerial spraying",
];

/**
 * Analisa um item e devolve { relevante, score, regiao, precisaTraduzir, motivos }
 */
function analisar(item) {
    const texto = norm(`${item.titulo} ${item.resumo || ""}`);
    const motivos = [];

    // 1) forte: é sobre pulverização?
    const fortes = PALAVRAS.fortes.filter((p) => texto.includes(norm(p)));
    if (fortes.length) motivos.push(`forte:${fortes.length}`);

    // 2) contexto: tem a palavra "drone" E contexto de agro?
    const contexto = PALAVRAS.contexto.filter((p) => texto.includes(norm(p)));
    const temDrone = /\b(drone|drones|uav|uavs|drone\s*\w+)\b/.test(texto);
    const temAgro = contexto.some((c) =>
        [
            "agricultura", "agro", "lavoura", "soja", "milho", "algodao", "cana", "cafe",
            "pastagem", "rebanho", "agricultural", "crop", "farm", "farmer", "tanker",
            "pulverizacao", "pulverizador", "spraying", "ag spray",
        ].includes(norm(c))
    );
    if (temDrone && temAgro) motivos.push("drone+agro");
    else if (temDrone && contexto.length >= 2) motivos.push("drone+contexto");

    // 3) negativas: é sobre outra coisa (drone de guerra, entrega, filme...)
    const negativas = PALAVRAS.negativas.filter((p) => texto.includes(norm(p)));
    if (negativas.length) motivos.push(`negativo:${negativas.length}`);

    let score = 0;
    score += fortes.length * 3;
    if (temDrone) score += 2;
    if (temAgro) score += 2;
    score += Math.min(contexto.length, 6) * 0.4;
    score -= negativas.length * 2.5;

    // recência: notícia de hoje vale mais que de uma semana atrás (+1 a 0)
    let idadeHoras = null;
    if (item.data) {
        idadeHoras = (Date.now() - new Date(item.data).getTime()) / 3600000;
        if (idadeHoras >= 0) score += Math.max(0, 1 - idadeHoras / 72);
    }

    // região
    const temBR = BR_TERMOS.some((t) => texto.includes(norm(t)));
    const regiao = temBR || item.regiao === "BR" ? "BR" : "MUNDO";

    // precisa traduzir? (título em inglês)
    const titulo = item.titulo || "";
    const temLetrasASCII = /[A-Za-z]/.test(titulo);
    const pareceIngles =
        temLetrasASCII &&
        (/\b(the|and|for|with|from|new|how|why|drone|spray|farm|crop|launch|unveil|announce)\b/i.test(titulo) ||
            EN_TERMOS.some((t) => norm(titulo).includes(norm(t))));

    const relevante = motivos.some((m) => m.startsWith("forte") || m === "drone+agro" || m === "drone+contexto") && score >= 3;

    return {
        relevante,
        score,
        regiao,
        idadeHoras,
        precisaTraduzir: precisaTraduzir(regiao, pareceIngles, item),
        motivos,
    };
}

// Ajudante separado para o lint do Node não reclamar de uso antes da declaração
function precisaTraduzir(regiao, pareceIngles, item) {
    if (regiao === "MUNDO" && pareceIngles) return true;
    if (item && item.fonteId && item.fonteId.startsWith("gn-mundo")) return true;
    return false;
}

/** Filtra o que é antigo demais (notícia de pulverização envelhece rápido). */
function filtrarRecentes(candidatos, maxDias = 7) {
    return candidatos.filter((c) => {
        if (c.idadeHoras === null || c.idadeHoras === undefined) return true; // sem data: mantém
        return c.idadeHoras <= maxDias * 24;
    });
}

/** Ordena candidatos por score final (relevância + popularidade + perfil aprendido) */
function ranquear(candidatos, extras = {}) {
    return candidatos
        .map((c) => {
            const perfil = extras.pesoPerfil ? extras.pesoPerfil(c) : 0;
            const popularidade = c.popularidade || 0;
            const final = c.score + popularidade + perfil;
            return { ...c, scoreFinal: final, perfil, popularidade };
        })
        .sort((a, b) => b.scoreFinal - a.scoreFinal);
}

module.exports = { carregarPalavras, analisar, ranquear, filtrarRecentes, PALAVRAS };
