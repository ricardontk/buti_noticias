/**
 * src/resolver.js — resolve o link real da notícia.
 *
 * O Google News entrega um link de redirecionamento (news.google.com/rss/articles/...)
 * que vira a URL do veículo depois de um redirect feito por JavaScript.
 *
 * Estratégia (do mais barato pro mais caro):
 *   1. HTTP: um GET simples seguindo os redirects (ms). Resolve a maioria.
 *   2. Navegador: só se o HTTP falhar. Abre uma aba no Chromium do Puppeteer.
 *
 * O passo 2 é caro (cada aba ~2-10s, mais no Raspberry Pi), então:
 *   - as resoluções rodam em paralelo (3 por vez);
 *   - há um orçamento de tempo total: o que não der tempo volta com o link
 *     original do Google News (que funciona, só não é o link "limpo").
 */
const axios = require("axios");
const { extrairUrlGoogle, ehLinkPublicavel } = require("./artigo");

const USER_AGENT =
    "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

class ResolverLink {
    constructor(client, cfg = {}) {
        this.client = client;
        this.cache = new Map();
        this.orcamentoMs = cfg.orcamento_ms ?? 25000; // tempo total para resolver
        this.timeoutNavegador = cfg.timeout_navegador ?? 10000;
        this.timeoutHttp = cfg.timeout_http ?? 6000;
        this.paralelismo = cfg.paralelismo ?? 3;
        this.http = axios.create({
            timeout: this.timeoutHttp,
            maxRedirects: 5,
            headers: { "User-Agent": USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9" },
        });
    }

    _ehGoogle(link) {
        return /news\.google\.com/i.test(link || "");
    }

    /** Link que faz sentido publicar: http(s), que não é do Google News e que é
     *  de verdade uma matéria (não script, analytics ou rede social). */
    _ehLinkUtil(link) {
        return ehLinkPublicavel(link);
    }

    /**
     * @param {string} link link do feed
     * @param {number} [deadline] timestamp-limite (ms) para abandonar a resolução
     * @returns {Promise<string>} link final (o original, se não der para resolver)
     */
    async resolver(link, deadline = Infinity) {
        if (!link) return link;
        if (this.cache.has(link)) return this.cache.get(link);
        if (!this._ehGoogle(link)) {
            this.cache.set(link, link);
            return link;
        }

        // 1) caminho rápido: só HTTP, seguindo redirects
        const viaHttp = await this._tentarHttp(link, deadline);
        if (viaHttp) {
            this.cache.set(link, viaHttp);
            return viaHttp;
        }
        if (Date.now() >= deadline) {
            this.cache.set(link, link);
            return link;
        }

        // 2) caminho caro: navegador (Chromium que já existe no container)
        console.log(`   🌐 abrindo no navegador (${link.slice(0, 60)}…)`);
        const viaNavegador = await this._tentarNavegador(link, deadline);
        this.cache.set(link, viaNavegador);
        if (viaNavegador === link) {
            console.log(`   ⚠️  não consegui o link final — mantendo o do feed`);
        }
        return viaNavegador;
    }

    /** Tempo que ainda resta dentro do orçamento (mínimo 1s). */
    _restante(deadline) {
        if (!Number.isFinite(deadline)) return Infinity;
        return Math.max(1000, deadline - Date.now());
    }

    async _tentarHttp(link, deadline) {
        try {
            const r = await this.http.get(link, {
                validateStatus: () => true,
                timeout: Math.min(this.timeoutHttp, this._restante(deadline)),
            });

            // a) redirect direto (o browser já cairia no site final)
            const final = r?.request?.res?.responseUrl || r?.config?.url || "";
            if (this._ehLinkUtil(final)) return final;

            // b) redirect por JavaScript: a URL original está dentro do HTML
            const achado = extrairUrlGoogle(typeof r.data === "string" ? r.data : "");
            if (achado && this._ehLinkUtil(achado)) return achado;
        } catch (_) {
            /* segue para o navegador */
        }
        return null;
    }

    async _tentarNavegador(link, deadline) {
        let pagina = null;
        const tempo = Math.min(this.timeoutNavegador, this._restante(deadline));
        try {
            const browser = this.client?.pupPage?.browser?.();
            if (!browser) return link;

            pagina = await browser.newPage();
            await pagina.setUserAgent(USER_AGENT);
            await pagina.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9" });

            // domcontentloaded é bem mais rápido que networkidle2 (que espera
            // a rede ficar parada — páginas com ads nunca ficam).
            await pagina.goto(link, { waitUntil: "domcontentloaded", timeout: tempo });
            await new Promise((r) => setTimeout(r, 400));

            const final = pagina.url();
            // Se a navegação falhou, o Chromium devolve a página de erro
            // (chrome-error://chromewebdata/) — nesse caso fica o link original.
            const resultado = this._ehLinkUtil(final) ? final : link;
            return resultado;
        } catch (err) {
            console.log(`   ⚠️  não consegui resolver o link: ${err.message}`);
            return link;
        } finally {
            if (pagina) {
                try {
                    await pagina.close();
                } catch (_) {}
            }
        }
    }

    /**
     * Resolve vários links em paralelo, com orçamento de tempo.
     * @param {string[]} links
     * @param {(feitas:number,total:number)=>void} [progresso]
     */
    async resolverVarios(links, progresso) {
        const saida = new Array(links.length);
        const fila = links.map((l, i) => ({ l, i }));
        const deadline = Date.now() + this.orcamentoMs;
        let feitas = 0;

        const worker = async () => {
            while (fila.length) {
                if (Date.now() >= deadline) {
                    // Tempo esgotado: o que sobrou fica com o link original.
                    while (fila.length) {
                        const { l, i } = fila.shift();
                        saida[i] = l;
                    }
                    break;
                }
                const { l, i } = fila.shift();
                saida[i] = await this.resolver(l, deadline);
                feitas += 1;
                if (progresso) progresso(feitas, links.length);
            }
        };

        const workers = Array.from({ length: Math.min(this.paralelismo, links.length) }, worker);
        await Promise.all(workers);
        return saida;
    }
}

module.exports = { ResolverLink };
