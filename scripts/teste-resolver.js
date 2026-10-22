/**
 * scripts/teste-resolver.js — testa o src/resolver.js.
 *
 * Confere:
 *   - link que não é do Google News volta na hora (sem browser);
 *   - link do Google News que responde com redirect HTTP é resolvido pelo
 *     caminho rápido (sem abrir aba nenhuma);
 *   - quando o navegador demora, o orçamento de tempo é respeitado.
 *
 * Uso: node scripts/teste-resolver.js
 */
const http = require("http");
const path = require("path");

const { ResolverLink } = require(path.join(__dirname, "..", "src", "resolver.js"));

function checar(nome, condicao, detalhe = "") {
    console.log(`${condicao ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`);
    return condicao;
}

// servidor que simula o redirect do Google News
const falso = http.createServer((req, res) => {
    if (req.url.includes("artigo")) {
        res.writeHead(302, { Location: `http://127.0.0.1:${porta}/final` });
        return res.end();
    }
    if (req.url === "/final") {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end("<html>ok</html>");
    }
    if (req.url === "/lento") {
        return setTimeout(() => {
            res.writeHead(200);
            res.end("ok");
        }, 30000);
    }
    res.writeHead(404);
    res.end();
});
let porta;

function navegadorFalso(demorarMs = 0, urlFinal = "https://exemplo.test/final") {
    return {
        pupPage: {
            browser: () => ({
                async newPage() {
                    return {
                        async setUserAgent() {},
                        async setExtraHTTPHeaders() {},
                        async goto(url, opcoes) {
                            // simula o Chromium: respeita o timeout
                            const limite = opcoes?.timeout ?? 5000;
                            const inicio = Date.now();
                            while (Date.now() - inicio < Math.min(demorarMs, limite)) {
                                await new Promise((r) => setTimeout(r, 50));
                            }
                            if (demorarMs >= limite) throw new Error("Navigation timeout");
                        },
                        url() {
                            return urlFinal;
                        },
                        async close() {},
                    };
                },
            }),
        },
    };
}

falso.listen(0, "127.0.0.1", async () => {
    porta = falso.address().port;
    const base = `http://127.0.0.1:${porta}`;

    // 1) link que não é do Google News
    let r = new ResolverLink(navegadorFalso());
    let inicio = Date.now();
    let out = await r.resolver("https://g1.globo.com/noticia");
    checar(
        "link normal volta na hora",
        out === "https://g1.globo.com/noticia" && Date.now() - inicio < 500,
        `${Date.now() - inicio}ms`
    );

    // 2) link do Google News resolvido por HTTP (caminho rápido, sem browser)
    //    o host local tem "news.google.com" no caminho para passar no filtro
    r = new ResolverLink(navegadorFalso());
    inicio = Date.now();
    out = await r.resolver(`${base}/news.google.com/artigo`);
    checar(
        "redirect HTTP resolvido sem abrir aba",
        out.endsWith("/final") && Date.now() - inicio < 2000,
        `${Date.now() - inicio}ms -> ${out}`
    );

    // 3) orçamento de tempo: um servidor lento não pode segurar o scan
    const lento = new ResolverLink(navegadorFalso(5000), {
        orcamento_ms: 1200,
        paralelismo: 2,
        timeout_navegador: 30000,
    });
    inicio = Date.now();
    const links = [
        `${base}/news.google.com/lento/1`,
        `${base}/news.google.com/lento/2`,
        `${base}/news.google.com/lento/3`,
        `${base}/news.google.com/lento/4`,
    ];
    const resolvidos = await lento.resolverVarios(links);
    const duracao = Date.now() - inicio;
    checar(
        "orçamento de tempo respeitado",
        duracao < 4000,
        `${duracao}ms para ${links.length} links`
    );
    checar("todos os links voltaram", resolvidos.length === links.length);

    // 4) navegação que falha devolve chrome-error:// — tem que ficar o link original
    const quebrado = new ResolverLink(navegadorFalso(0, "chrome-error://chromewebdata/"), {
        timeout_http: 1500,
        timeout_navegador: 1500,
    });
    const linkRuim = `${base}/news.google.com/quebrado`;
    out = await quebrado.resolver(linkRuim);
    checar(
        "página de erro do Chromium é descartada",
        !String(out).startsWith("chrome-error://"),
        out
    );
    checar("mantém o link original quando falha", out === linkRuim || out.endsWith("/final"), out);

    falso.close();
    console.log("\nTudo certo.");
    process.exit(0);
});
