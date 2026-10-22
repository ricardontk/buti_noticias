/**
 * scripts/teste-publicacao.js — teste do src/publisher.js com um cliente falso.
 *
 * Confere os dois modos de publicação em vários canais:
 *   - "reserva": publica no primeiro canal que funcionar
 *   - "todos":   publica em todos os canais da lista
 *
 * Uso: node scripts/teste-publicacao.js
 */
const path = require("path");

const { Publisher } = require(path.join(__dirname, "..", "src", "publisher.js"));

function clienteFalso(quebrados = []) {
    const enviados = [];
    return {
        enviados,
        async getChatById(destino) {
            if (quebrados.includes(destino)) throw new Error("canal indisponível");
            return {
                async sendMessage(texto) {
                    enviados.push({ destino, texto });
                },
            };
        },
        async sendMessage(destino) {
            if (quebrados.includes(destino)) throw new Error("canal indisponível");
            enviados.push({ destino });
        },
    };
}

function checar(nome, condicao, detalhe = "") {
    console.log(`${condicao ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`);
    return condicao;
}

async function principal() {
    const cfg = {
        canal_id: "111@newsletter",
        canais: ["222@newsletter", "333@newsletter"],
        modo_publicacao: "reserva",
        publicacao: { incluir_imagem: false },
    };

    // --- modo reserva: publica só no primeiro ---
    let cli = clienteFalso();
    let pub = new Publisher(cli, cfg);
    let r = await pub.publicar({ titulo: "t" }, "texto");
    checar("reserva publica em 1 destino", cli.enviados.length === 1, cli.enviados.map((e) => e.destino).join(","));
    checar("reserva devolve ok", r.ok === true);

    // --- modo reserva: se o primeiro falha, usa o segundo ---
    cli = clienteFalso(["111@newsletter"]);
    pub = new Publisher(cli, cfg);
    r = await pub.publicar({ titulo: "t" }, "texto");
    checar("reserva cai para o 2º canal", cli.enviados.length === 1 && cli.enviados[0].destino === "222@newsletter",
        cli.enviados.map((e) => e.destino).join(","));
    checar("reserva com fallback devolve ok", r.ok === true);

    // --- modo todos: publica em todos ---
    const cfgTodos = { ...cfg, modo_publicacao: "todos" };
    cli = clienteFalso();
    pub = new Publisher(cli, cfgTodos);
    r = await pub.publicar({ titulo: "t" }, "texto");
    checar("todos publica em 3 destinos", cli.enviados.length === 3, cli.enviados.map((e) => e.destino).join(","));
    checar("todos devolve a lista", Array.isArray(r.destinos) && r.destinos.length === 3);

    // --- modo todos: um canal quebrado não impede os outros ---
    cli = clienteFalso(["222@newsletter"]);
    pub = new Publisher(cli, cfgTodos);
    r = await pub.publicar({ titulo: "t" }, "texto");
    checar("todos aguenta canal quebrado", r.ok === true && cli.enviados.length === 2,
        cli.enviados.map((e) => e.destino).join(","));

    // --- sem canal nenhum ---
    cli = clienteFalso();
    pub = new Publisher(cli, { ...cfg, canal_id: "", canais: [] });
    r = await pub.publicar({ titulo: "t" }, "texto");
    checar("sem destino devolve erro", r.ok === false, r.erro);

    // --- só a lista "canais", sem "canal_id" (configuração pelo app) ---
    const soLista = { ...cfg, canal_id: "", canais: ["111@newsletter", "222@newsletter"] };
    cli = clienteFalso();
    pub = new Publisher(cli, soLista);
    checar("só a lista canais vira destino", pub.destinos.length === 2, pub.destinos.join(","));
    r = await pub.publicar({ titulo: "t" }, "texto");
    checar("publica usando só a lista canais", r.ok === true && cli.enviados.length === 1, cli.enviados.map((e) => e.destino).join(","));

    // --- lista como texto separado por vírgula (vem do app assim) ---
    const comoTexto = { ...cfg, canal_id: "", canais: "111@newsletter, 222@newsletter" };
    cli = clienteFalso();
    pub = new Publisher(cli, comoTexto);
    checar("lista por vírgula é entendida", pub.destinos.length === 2, pub.destinos.join(","));
}

principal().then(() => process.exit(0));
