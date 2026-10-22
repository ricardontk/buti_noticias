/**
 * scripts/teste-fila-web.js — testa a fila de aprovação pela API (como o painel web usa).
 *
 * Sobe a API do bot com uma fila simulada e confere:
 *   - GET  /api/fila devolve os itens aguardando
 *   - POST /api/fila/:id/publicar publica o item
 *   - POST /api/fila/:id/pular pula o item
 *   - POST /api/fila/todas publica tudo
 *
 * Uso: node scripts/teste-fila-web.js
 */
const path = require("path");

const { Api } = require(path.join(__dirname, "..", "src", "api.js"));

function checar(nome, condicao, detalhe = "") {
    console.log(`${condicao ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`);
    return condicao;
}

// estado falso: 2 itens aguardando
const fila = [
    { id: "abc-0", ordem: 1, status: "aguardando", titulo: "Primeira notícia", resumo: "Resumo A", link: "https://a", fonte: "Fonte A", regiao: "BR" },
    { id: "abc-1", ordem: 2, status: "aguardando", titulo: "Segunda notícia", resumo: "Resumo B", link: "https://b", fonte: "Fonte B", regiao: "Mundo" },
];

const publicados = [];

const acoes = {
    status: async () => ({ ok: true }),
    qr: async () => ({ conectado: true, qr: null }),
    fila: async () => ({ itens: fila.filter((i) => i.status === "aguardando") }),
    agirFila: async (id, acao) => {
        const item = fila.find((i) => i.id === id);
        if (!item) return { ok: false, erro: "item não encontrado" };
        if (acao === "publicar") {
            item.status = "publicada";
            publicados.push(item);
            return { ok: true };
        }
        if (acao === "pular") {
            item.status = "pulada";
            return { ok: true };
        }
        return { ok: false, erro: "ação desconhecida" };
    },
    publicarTodas: async () => {
        const restantes = fila.filter((i) => i.status === "aguardando");
        restantes.forEach((i) => {
            i.status = "publicada";
            publicados.push(i);
        });
        return { ok: true, publicadas: restantes.length };
    },
    fontes: async () => ({}),
    ultimas: async () => ({}),
    modelos: async () => ({}),
};

const api = new Api({ cfg: { painel: { porta: 9123, porta_ingress: 9123, token: "" } }, acoes });

api.iniciar();

setTimeout(async () => {
    const base = "http://127.0.0.1:9123";

    const lista = await fetch(base + "/api/fila").then((r) => r.json());
    checar("GET /api/fila lista os itens", lista.itens.length === 2, `${lista.itens.length} item(ns)`);
    checar("item tem titulo e link", !!lista.itens[0].titulo && !!lista.itens[0].link, lista.itens[0].titulo);

    const pub = await fetch(base + "/api/fila/abc-0/publicar", { method: "POST" }).then((r) => r.json());
    checar("POST publicar funciona", pub.ok === true);
    checar("item virou publicada", fila[0].status === "publicada");

    const pul = await fetch(base + "/api/fila/abc-1/pular", { method: "POST" }).then((r) => r.json());
    checar("POST pular funciona", pul.ok === true);
    checar("item virou pulada", fila[1].status === "pulada");

    const todas = await fetch(base + "/api/fila/todas", { method: "POST" }).then((r) => r.json());
    checar("POST publicar todas funciona", todas.ok === true, `${todas.publicadas} publicada(s)`);

    const erro = await fetch(base + "/api/fila/nao-existe/publicar", { method: "POST" }).then((r) => r.json());
    checar("id inexistente devolve erro", erro.ok === false, erro.erro);

    console.log("\nTudo certo.");
    process.exit(0);
}, 500);
