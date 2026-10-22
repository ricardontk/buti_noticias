/**
 * src/fetcher.js — busca e normaliza itens das fontes RSS.
 *
 * Normaliza tudo para o mesmo formato:
 *   { titulo, link, resumo, imagem, data, fonte, fonteId, regiao, peso }
 */
const axios = require("axios");
const Parser = require("rss-parser");

const parser = new Parser({
    customFields: {
        item: [
            ["media:content", "mediaContent", { keepArray: false }],
            ["media:thumbnail", "mediaThumbnail"],
            ["atom:subtitle", "subtitle"],
        ],
    },
});

const http = axios.create({
    timeout: 25000,
    headers: {
        "User-Agent":
            "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
    },
    validateStatus: (s) => s >= 200 && s < 400,
});

function limparHtml(texto) {
    return String(texto || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
}

/** Link real da matéria: no Google News o <link> é um redirecionador e o <description> traz o destino. */
function extrairLinkReal(item) {
    const desc = item.contentSnippet || item.content || item.summary || "";
    const href = String(desc).match(/<a[^>]+href="([^"]+)"/i);
    if (href && /^https?:\/\//i.test(href[1]) && !/news\.google\.com/i.test(href[1])) {
        return href[1];
    }
    return item.link || "";
}

/** Título do Google News vem como "Manchete - veículo"; a fonte vem separada. */
function extrairFonte(item) {
    if (item.source && item.source.title) return item.source.title;
    const titulo = item.title || "";
    const partes = titulo.split(" - ");
    if (partes.length > 1) return partes[partes.length - 1].trim();
    return "";
}

function extrairTitulo(item) {
    const titulo = String(item.title || "").trim();
    const fonte = extrairFonte(item);
    if (fonte && titulo.endsWith(` - ${fonte}`)) {
        return titulo.slice(0, -(fonte.length + 3)).trim();
    }
    return titulo;
}

function extrairImagem(item) {
    const desc = item.contentSnippet || item.content || "";
    const imgDesc = String(desc).match(/<img[^>]+src="([^"]+)"/i);
    if (imgDesc) return imgDesc[1];
    if (item.mediaContent && item.mediaContent.$ && item.mediaContent.$.url) {
        return item.mediaContent.$.url;
    }
    if (item.mediaThumbnail && item.mediaThumbnail.$ && item.mediaThumbnail.$.url) {
        return item.mediaThumbnail.$.url;
    }
    if (item.enclosure && item.enclosure.url && /image/i.test(item.enclosure.type || "")) {
        return item.enclosure.url;
    }
    if (item.itunes && item.itunes.image && item.itunes.image.href) return item.itunes.image.href;
    return "";
}

function extrairResumo(item, titulo, fonte) {
    const bruto =
        item.subtitle ||
        item.contentSnippet ||
        item.content ||
        item.summary ||
        item["content:encoded"] ||
        "";
    let texto = limparHtml(bruto);

    // O Google News entrega "Manchete  Veículo" como descrição — não serve como resumo.
    if (titulo && fonte) {
        const soVeiculo = texto.replace(titulo, "").replace(fonte, "").trim();
        if (soVeiculo.length < 25) return "";
    }
    if (titulo && texto.toLowerCase() === titulo.toLowerCase()) return "";

    return texto.length > 420 ? `${texto.slice(0, 417)}...` : texto;
}

function normalizar(item, fonte) {
    const titulo = extrairTitulo(item);
    const link = extrairLinkReal(item);
    const resumo = extrairResumo(item, titulo, extrairFonte(item));
    let data = null;
    if (item.isoDate) data = new Date(item.isoDate);
    else if (item.pubDate) data = new Date(item.pubDate);
    if (data && isNaN(data.getTime())) data = null;

    return {
        titulo,
        link,
        resumo,
        imagem: extrairImagem(item),
        data: data ? data.toISOString() : null,
        fonte: extrairFonte(item) || fonte.nome,
        fonteId: fonte.id,
        regiao: fonte.regiao || "MUNDO",
        peso: fonte.peso ?? 1,
    };
}

/** Baixa um feed e devolve os itens normalizados. Nunca lança — devolve [] em caso de erro. */
async function buscarFeed(fonte) {
    try {
        const resposta = await http.get(fonte.url);
        const xml = typeof resposta.data === "string" ? resposta.data : String(resposta.data);
        const feed = await parser.parseString(xml);
        const itens = (feed.items || []).map((i) => normalizar(i, fonte)).filter((i) => i.titulo && i.link);
        console.log(`   ✅ ${fonte.id}: ${itens.length} item(ns)`);
        return itens;
    } catch (err) {
        console.log(`   ⚠️  ${fonte.id}: falhou (${err.message})`);
        return [];
    }
}

async function buscarTodas(fontes) {
    console.log(`🌐 Buscando ${fontes.length} fonte(s)...`);
    const resultados = await Promise.all(fontes.map((f) => buscarFeed(f)));
    const todos = resultados.flat();
    console.log(`🌐 Total bruto: ${todos.length} item(ns)`);
    return todos;
}

module.exports = { buscarTodas, buscarFeed, limparHtml, http };
