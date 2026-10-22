/**
 * src/artigo.js — busca o conteúdo da matéria por HTTP, sem abrir navegador.
 *
 * Duas coisas:
 *   1. resolveUrlGoogle(html): acha a URL original dentro da página do Google
 *      News (que redireciona via JavaScript). Evita ter que abrir o Chromium.
 *   2. extrairTexto(html): limpa o HTML e devolve o texto da matéria, para a
 *      IA escrever o comentário com base no conteúdo real (e não só no título).
 *
 * É bem mais leve que abrir a página: uma requisição HTTP de poucos KB.
 */

const axios = require("axios");

const USER_AGENT =
    "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const ENTIDADES = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&#39;": "'",
    "&nbsp;": " ",
    "&mdash;": "—",
    "&ndash;": "–",
    "&hellip;": "…",
    "&laquo;": "«",
    "&raquo;": "»",
};

function decodir(texto) {
    return String(texto || "")
        .replace(/&[a-z]+;|&#\d+;/gi, (e) => ENTIDADES[e.toLowerCase()] || ENTIDADES[e] || e)
        .replace(/\s+/g, " ")
        .trim();
}

function limparTags(html) {
    return decodir(
        String(html || "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
            .replace(/<[^>]+>/g, " ")
    );
}

/**
 * Acha a URL original dentro do HTML do Google News.
 * @returns {string|null}
 */
function extrairUrlGoogle(html) {
    const texto = String(html || "");

    // 1) atributo oficial do Google News
    const padroes = [
        /data-n-au="(https?:\/\/[^"]+)"/i,
        /data-n-au='(https?:\/\/[^']+)'/i,
        /data-n-a-ts="(https?:\/\/[^"]+)"/i,
    ];
    for (const re of padroes) {
        const m = texto.match(re);
        if (m) return decodir(m[1]);
    }

    // 2) a URL aparece em JSON dentro da página
    const json = texto.match(/"url":"(https?:\/\/[^"\\]+)"/i);
    if (json) return decodir(json[1]);

    // 3) último recurso: o primeiro link externo da página
    const links = [...texto.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map((m) => decodir(m[1]));
    for (const link of links) {
        if (!/google\.com|gstatic\.com|googleusercontent\.com|youtube\.com/i.test(link)) {
            return link;
        }
    }
    return null;
}

/**
 * Extrai o texto principal da matéria.
 * @param {string} html
 * @param {number} [limite] máximo de caracteres
 * @returns {string}
 */
function extrairTexto(html, limite = 2500) {
    let texto = String(html || "");

    // fora: script, style, svg, iframe, navegação
    texto = texto.replace(
        /<(script|style|noscript|svg|iframe|nav|footer|header|aside|form)\b[\s\S]*?<\/\1>/gi,
        " "
    );

    // o corpo do artigo, se existir
    const artigo = texto.match(/<article\b[\s\S]*?<\/article>/i);
    if (artigo) texto = artigo[0];

    // os parágrafos
    const paragrafos = [...texto.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
        .map((m) => limparTags(m[1]))
        .filter((p) => p.length > 60);

    let saida = paragrafos.join("\n");
    if (saida.length < 200) {
        // alguns sites não usam <p>: cai para o texto corrido
        saida = limparTags(texto);
    }
    saida = saida.replace(/\n{3,}/g, "\n\n").trim();
    return saida.length > limite ? `${saida.slice(0, limite).trim()}…` : saida;
}

class Artigo {
    constructor(cfg = {}) {
        this.timeout = cfg.timeout_ms ?? 8000;
        this.http = axios.create({
            timeout: this.timeout,
            maxRedirects: 5,
            headers: { "User-Agent": USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9" },
            validateStatus: () => true,
        });
    }

    /**
     * Baixa uma página e devolve { html, urlFinal }.
     */
    async baixar(url) {
        const r = await this.http.get(url);
        return {
            html: typeof r.data === "string" ? r.data : "",
            urlFinal: r?.request?.res?.responseUrl || r?.config?.url || url,
        };
    }

    /** Texto da matéria (vazio se não conseguir). */
    async texto(url) {
        if (!url || !/^https?:\/\//i.test(url)) return "";
        try {
            const { html } = await this.baixar(url);
            return extrairTexto(html);
        } catch (_) {
            return "";
        }
    }

    /**
     * Busca o texto de vários links em paralelo, com orçamento de tempo.
     * @param {string[]} urls
     * @param {number} [orcamentoMs]
     * @param {number} [paralelismo]
     */
    async textos(urls, orcamentoMs = 20000, paralelismo = 4) {
        const saida = new Array(urls.length);
        const fila = urls.map((u, i) => ({ u, i }));
        const deadline = Date.now() + orcamentoMs;

        const worker = async () => {
            while (fila.length) {
                if (Date.now() >= deadline) {
                    while (fila.length) {
                        const { i } = fila.shift();
                        saida[i] = "";
                    }
                    break;
                }
                const { u, i } = fila.shift();
                saida[i] = await this.texto(u);
            }
        };

        await Promise.all(
            Array.from({ length: Math.min(paralelismo, urls.length) }, worker)
        );
        return saida;
    }
}

module.exports = { Artigo, extrairTexto, extrairUrlGoogle, limparTags };
