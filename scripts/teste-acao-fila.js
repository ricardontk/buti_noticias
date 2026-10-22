/**
 * scripts/teste-acao-fila.js — testa as ações do painel web na fila de aprovação.
 *
 * Confere:
 *   - achou o item pelo id e também pela ordem (itens antigos, sem id);
 *   - publicar marca como publicada e chama o publicador;
 *   - pular marca como pulada;
 *   - erro do publicador vira mensagem clara (ex.: WhatsApp desconectado).
 *
 * Uso: node scripts/teste-acao-fila.js
 */
const path = require("path");

const { Queue } = require(path.join(__dirname, "..", "src", "queue.js"));

function checar(nome, condicao, detalhe = "") {
    console.log(`${condicao ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`);
    return condicao;
}

function estadoFalso(itens, eventos) {
    return {
        fila: itens,
        queue: itens,
        limparFila() {
            this.queue = [];
            this.fila = this.queue;
        },
        adicionarItem(i) {
            this.queue.push(i);
            this.fila = this.queue;
        },
        save() {},
        saveNow() {},
        registrarPulada(item) {
            eventos.push(`pulada:${item.titulo}`);
        },
        registrarPublicada(item) {
            eventos.push(`publicada:${item.titulo}`);
        },
        aprender() {},
    };
}

(async () => {
    const publicados = [];
    const publisher = {
        async publicar(item) {
            publicados.push(item.titulo);
            return { ok: true };
        },
        async enviarPara() {},
    };

    // --- item com id (formato novo) ---
    const eventos = [];
    let state = estadoFalso(
        [
            { id: "abc-0", ordem: 1, status: "aguardando", titulo: "Notícia A" },
            { id: "abc-1", ordem: 2, status: "aguardando", titulo: "Notícia B" },
        ],
        eventos
    );
    let fila = new Queue({ state, publisher, cfg: {}, meuNumero: "5511999999999" });

    let r = await fila.agir("abc-1", "publicar");
    checar("acha pelo id", r.ok === true, JSON.stringify(r.erro || ""));
    checar("publicou o item certo", publicados[0] === "Notícia B", publicados.join(","));
    checar("registrou a publicação", eventos.includes("publicada:Notícia B"), eventos.join(","));

    r = await fila.agir("abc-0", "pular");
    checar("pula pelo id", r.ok === true, JSON.stringify(r.erro || ""));
    checar("registrou o pulo", eventos.includes("pulada:Notícia A"), eventos.join(","));

    // --- item sem id (fila antiga): a ordem é o número mostrado no painel ---
    const eventos2 = [];
    state = estadoFalso(
        [
            { ordem: 1, status: "aguardando", titulo: "Antiga 1" },
            { ordem: 2, status: "aguardando", titulo: "Antiga 2" },
        ],
        eventos2
    );
    fila = new Queue({ state, publisher, cfg: {}, meuNumero: "5511999999999" });
    publicados.length = 0;
    r = await fila.agir("2", "publicar");
    checar("acha pela ordem (item sem id)", r.ok === true && publicados[0] === "Antiga 2", publicados.join(","));

    // --- erro do publicador: mensagem clara para o painel ---
    const publisherQuebrado = {
        async publicar() {
            return { ok: false, erro: "WhatsApp is not authenticated" };
        },
        async enviarPara() {},
    };
    const eventos3 = [];
    state = estadoFalso([{ id: "x-0", ordem: 1, status: "aguardando", titulo: "Falha" }], eventos3);
    fila = new Queue({ state, publisher: publisherQuebrado, cfg: {}, meuNumero: "5511999999999" });
    r = await fila.agir("x-0", "publicar");
    checar("erro vira mensagem clara", /WhatsApp desconectado/.test(r.erro || ""), r.erro);

    // --- item já tratado ---
    const eventos4 = [];
    state = estadoFalso([{ id: "y-0", ordem: 1, status: "publicada", titulo: "Já foi" }], eventos4);
    fila = new Queue({ state, publisher, cfg: {}, meuNumero: "5511999999999" });
    r = await fila.agir("y-0", "publicar");
    checar("item já publicado é recusado", r.ok === false, r.erro);

    // --- dois cliques ao mesmo tempo: publica só uma vez ---
    let chamadas = 0;
    const publisherLento = {
        async publicar() {
            chamadas += 1;
            await new Promise((res) => setTimeout(res, 120)); // publica devagar
            return { ok: true };
        },
        async enviarPara() {},
    };
    const eventos5 = [];
    state = estadoFalso([{ id: "z-0", ordem: 1, status: "aguardando", titulo: "Clique duplo" }], eventos5);
    fila = new Queue({ state, publisher: publisherLento, cfg: {}, meuNumero: "5511999999999" });
    const [r1, r2] = await Promise.all([
        fila.agir("z-0", "publicar"),
        fila.agir("z-0", "publicar"),
    ]);
    checar("publicou só uma vez", chamadas === 1, `${chamadas} publicação(ões)`);
    checar("a segunda tentativa é recusada", r2.ok === false, r2.erro);
    checar("a primeira deu certo", r1.ok === true);

    console.log("\nTudo certo.");
    process.exit(0);
})();
