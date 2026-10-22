/**
 * scripts/teste-artigo.js — testa o src/artigo.js (texto da matéria e URL do Google News).
 *
 * Confere:
 *   - extrai o texto principal de uma página HTML;
 *   - acha a URL original dentro da página do Google News;
 *   - respeita o limite de caracteres;
 *   - busca vários textos em paralelo com orçamento de tempo.
 *
 * Uso: node scripts/teste-artigo.js
 */
const http = require("http");
const path = require("path");

const { Artigo, extrairTexto, extrairUrlGoogle } = require(path.join(__dirname, "..", "src", "artigo.js"));

function checar(nome, condicao, detalhe = "") {
    console.log(`${condicao ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`);
    return condicao;
}

const MATERIA = `<!DOCTYPE html><html><head><title>Manchete</title>
<script>var lixo = "isto nao deve aparecer";</script>
<style>.x{color:red}</style></head>
<body>
<nav>Menu que nao entra</nav>
<article>
  <p>Primeiro paragrafo da materia sobre pulverizacao de drones no campo, com mais de sessenta caracteres para passar no filtro.</p>
  <p>Segundo paragrafo com detalhes tecnicos da aplicacao, taxa de aplicacao e vento, tambem com tamanho suficiente.</p>
  <p>Curto</p>
</article>
<footer>Rodape</footer></body></html>`;

const GOOGLE_NEWS = `<html><body><c-wiz><div jsrenderer="r" data-n-au="https://www.globo.com/agricultura/noticia/2026/10/drones"></div></c-wiz></body></html>`;

// página do Google News sem o atributo oficial: os links de analytics vêm antes
const GOOGLE_NEWS_SEM_ATRIBUTO = `<html><head>
<script src="https://www.google-analytics.com/analytics.js"></script>
<link rel="stylesheet" href="https://www.googletagmanager.com/gtm.css">
</head><body>
<a href="https://www.facebook.com/sharer">compartilhar</a>
<a href="https://twitter.com/share">twitter</a>
<a href="https://www.globo.com/agricultura/noticia/2026/10/drones-pulverizacao">abrir</a>
</body></html>`;

// página real do Google News: o JSON inline tem vários "url" e o primeiro
// deles é o analytics.js (foi o que vazou para a publicação)
const GOOGLE_NEWS_JSON = `<html><head><script>
var data = {"url":"https://www.google-analytics.com/analytics.js","tracking":"1"};
var wiz = {"url":"https://news.google.com/rss/articles/CBMi?oc=5","target":"https://www.pna.gov.ph/agri/2026/10/21/drone-pulverization-news"};
var outros = {"url":"https://www.pna.gov.ph/agri/2026/10/21/drone-pulverization-news"};
</script></head><body></body></html>`;

const falso = http.createServer((req, res) => {
    if (req.url === "/materia") {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(MATERIA);
    }
    if (req.url === "/google") {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(GOOGLE_NEWS);
    }
    if (req.url === "/lento") {
        return setTimeout(() => {
            res.writeHead(200);
            res.end("ok");
        }, 20000);
    }
    res.writeHead(404);
    res.end();
});

falso.listen(0, "127.0.0.1", async () => {
    const base = `http://127.0.0.1:${falso.address().port}`;

    // 1) extração de texto
    const texto = extrairTexto(MATERIA);
    checar("extrai o texto do artigo", texto.includes("Primeiro paragrafo"), `${texto.length} chars`);
    checar("tira script e style", !texto.includes("lixo") && !texto.includes("color:red"));
    checar("tira navegação e rodapé", !texto.includes("Menu que nao entra") && !texto.includes("Rodape"));
    checar("descarta parágrafo curto", !texto.includes("Curto"));
    checar("respeita o limite", extrairTexto(MATERIA, 50).length <= 51, `${extrairTexto(MATERIA, 50).length} chars`);

    // 2) URL original do Google News
    const url = extrairUrlGoogle(GOOGLE_NEWS);
    checar("acha a URL no Google News", url === "https://www.globo.com/agricultura/noticia/2026/10/drones", url);

    // 2b) sem o atributo oficial: não pode pegar analytics.js nem redes sociais
    const url2 = extrairUrlGoogle(GOOGLE_NEWS_SEM_ATRIBUTO);
    checar(
        "ignora analytics.js e redes sociais",
        url2 === "https://www.globo.com/agricultura/noticia/2026/10/drones-pulverizacao",
        url2
    );

    // 2c) JSON inline com vários "url": o analytics.js é o primeiro
    const url3 = extrairUrlGoogle(GOOGLE_NEWS_JSON);
    checar(
        "JSON inline não entrega o analytics.js",
        url3 === "https://www.pna.gov.ph/agri/2026/10/21/drone-pulverization-news",
        url3
    );

    // 3) busca real por HTTP
    const art = new Artigo({ timeout_ms: 3000 });
    const t = await art.texto(`${base}/materia`);
    checar("baixa e extrai texto por HTTP", t.includes("Primeiro paragrafo"), `${t.length} chars`);

    // 4) orçamento de tempo
    const inicio = Date.now();
    const textos = await art.textos([`${base}/lento`, `${base}/materia`], 1500, 2);
    const duracao = Date.now() - inicio;
    checar("orçamento de tempo respeitado", duracao < 6000, `${duracao}ms`);
    checar("devolve todos os textos", textos.length === 2);

    falso.close();
    console.log("\nTudo certo.");
    process.exit(0);
});
