/**
 * scripts/teste-fila.js — testa a máquina de estados de aprovação SEM WhatsApp.
 *
 * Simula: você recebe o card → responde 1 (gostei) → a notícia é publicada;
 * responde 2 (não gostei) → é descartada e o perfil aprende.
 */
const path = require("path");
const config = require("../src/config");
const { State } = require("../src/state");
const { Queue } = require("../src/queue");

const cfg = config.load();
const ARQ_TESTE = path.join(require("os").tmpdir(), "bot_noticias_teste_fila.json");
try {
    require("fs").unlinkSync(ARQ_TESTE);
} catch (_) {}
const estado = new State(ARQ_TESTE);

const publicados = [];
const enviados = [];

const publisher = {
    async enviarPara(numero, texto) {
        enviados.push({ numero, texto });
        console.log(`\n📨 MENSAGEM PARA ${numero}:\n${texto}`);
    },
    async publicar(item, texto) {
        publicados.push({ titulo: item.titulo, texto });
        console.log(`\n📢 PUBLICADO NO CANAL:\n${texto}`);
        return { ok: true };
    },
};

const fila = new Queue({ state: estado, publisher, cfg, meuNumero: "5511999999999" });

const candidatos = [
    { titulo: "XAG apresenta P150 com tanque de 60 L", link: "https://exemplo.com/1", resumo: "", fonte: "G1", regiao: "BR", data: new Date().toISOString() },
    { titulo: "DJI launches Agras T50 in Europe", link: "https://exemplo.com/2", resumo: "", fonte: "DroneXL", regiao: "MUNDO", data: new Date().toISOString() },
];

(async () => {
    console.log("=== 1) inicia a fila ===");
    await fila.iniciar(candidatos);

    console.log("\n=== 2) você responde 2 (não gostei) ===");
    let r = await fila.tratarResposta("2");
    console.log(`→ ação: ${r.acao}`);

    console.log("\n=== 3) você responde 1 (gostei) ===");
    r = await fila.tratarResposta("1");
    console.log(`→ ação: ${r.acao}`);

    console.log("\n=== 4) fila terminou ===");
    console.log(`Publicados: ${publicados.length} | Enviados: ${enviados.length}`);
    console.log(`Perfil aprendido: ${JSON.stringify(estado.data.profile).slice(0, 300)}`);
    console.log(`Stats: ${JSON.stringify(estado.data.stats)}`);

    if (publicados.length === 1 && publicados[0].titulo.includes("Agras T50")) {
        console.log("\n✅ TESTE PASSOU: a notícia pulada foi descartada, a aprovada foi publicada e o perfil aprendeu.");
    } else {
        console.log("\n❌ TESTE FALHOU");
        process.exitCode = 1;
    }
})();
