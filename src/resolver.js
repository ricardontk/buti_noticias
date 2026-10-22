/**
 * src/resolver.js — resolve o link real da notícia.
 *
 * O Google News entrega um link de redirecionamento (news.google.com/rss/articles/...)
 * que só vira a URL do veículo depois de um redirect feito por JavaScript. Como o
 * add-on já tem um Chromium (o do Puppeteer do whatsapp-web.js), reaproveitamos esse
 * navegador para abrir a página e capturar a URL final.
 *
 * Só resolvemos os links que realmente vão ser publicados (poucos), para não
 *Spender CPU à toa — resolver ~8 links leva ~15s.
 */
class ResolverLink {
    constructor(client) {
        this.client = client;
        this.cache = new Map();
    }

    _ehGoogle(link) {
        return /news\.google\.com/i.test(link || "");
    }

    /**
     * @param {string} link link do feed
     * @returns {Promise<string>} link final (o original, se não for do Google)
     */
    async resolver(link) {
        if (!link) return link;
        if (this.cache.has(link)) return this.cache.get(link);
        if (!this._ehGoogle(link)) {
            this.cache.set(link, link);
            return link;
        }

        let pagina = null;
        try {
            const browser = this.client?.pupPage?.browser?.();
            if (!browser) return link;

            pagina = await browser.newPage();
            await pagina.setUserAgent(
                "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
            );
            await pagina.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9" });

            await pagina.goto(link, { waitUntil: "networkidle2", timeout: 25000 });
            await new Promise((r) => setTimeout(r, 600));

            const final = pagina.url();
            const resultado = final && !this._ehGoogle(final) ? final : link;
            this.cache.set(link, resultado);
            return resultado;
        } catch (err) {
            console.log(`   ⚠️  não consegui resolver o link: ${err.message}`);
            return link;
        } finally {
            if (pagina) {
                try { await pagina.close(); } catch (_) {}
            }
        }
    }

    /** Resolve vários links, um a um (evita abrir abas demais). */
    async resolverVarios(links) {
        const saida = [];
        for (const l of links) {
            saida.push(await this.resolver(l));
        }
        return saida;
    }
}

module.exports = { ResolverLink };
