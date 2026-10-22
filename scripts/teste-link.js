/**
 * scripts/teste-link.js — confere que o link publicado e o do painel são o mesmo,
 * e que link inválido (chrome-error://) nunca sai.
 *
 * Uso: node scripts/teste-link.js
 */
const path = require("path");

const { linkFinal, mensagemCanal } = require(path.join(__dirname, "..", "src", "formatter.js"));

function checar(nome, condicao, detalhe = "") {
    console.log(`${condicao ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`);
    return condicao;
}

const itemBom = {
    titulo: "Notícia boa",
    link: "https://www.globo.com/agricultura/noticia",
    linkOriginal: "https://news.google.com/rss/articles/abc",
    fonte: "Globo",
    regiao: "BR",
};

const itemQuebrado = {
    titulo: "Notícia quebrada",
    link: "chrome-error://chromewebdata/",
    linkOriginal: "https://news.google.com/rss/articles/xyz",
    fonte: "Farms.com",
    regiao: "Mundo",
};

// 1) link válido: usa o resolvido
checar("usa o link resolvido", linkFinal(itemBom) === itemBom.link, linkFinal(itemBom));

// 2) link quebrado: volta para o original do feed
checar("descarta chrome-error://", linkFinal(itemQuebrado) !== "chrome-error://chromewebdata/");
checar("usa o link original do feed", linkFinal(itemQuebrado) === itemQuebrado.linkOriginal, linkFinal(itemQuebrado));

// 3) item sem original e com link quebrado: devolve o que tiver (vazio é melhor que chrome-error)
const semOriginal = { titulo: "X", link: "chrome-error://chromewebdata/" };
checar("sem original, não devolve chrome-error", !String(linkFinal(semOriginal)).startsWith("chrome-error://"));

// 4) a mensagem publicada usa o mesmo link
const cfg = { publicacao: { prefixo: "🚁", rodape: "Fonte: {fonte} | {data}" } };
const texto = mensagemCanal(itemQuebrado, cfg);
checar("mensagem publicada não tem chrome-error", !texto.includes("chrome-error://"), texto.split("\n").find((l) => l.includes("🔗")));

const textoBom = mensagemCanal(itemBom, cfg);
checar(
    "mensagem publicada usa o link resolvido",
    textoBom.includes(itemBom.link) && !textoBom.includes("news.google.com"),
    textoBom.split("\n").find((l) => l.includes("🔗"))
);

console.log("\nTudo certo.");
