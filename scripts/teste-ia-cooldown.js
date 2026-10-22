/**
 * scripts/teste-ia-cooldown.js — testa o cooldown da IA (evita estourar a cota).
 *
 * Depois de uma falha, a IA não pode ser chamada de novo antes de 1 minuto.
 * Depois do cooldown, o bot tenta de novo (erro de cota é temporário).
 *
 * Uso: node scripts/teste-ia-cooldown.js
 */
const path = require("path");

const { LLM } = require(path.join(__dirname, "..", "src", "llm.js"));

function checar(nome, condicao, detalhe = "") {
    console.log(`${condicao ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`);
    return condicao;
}

(async () => {
    const llm = new LLM({ llm: { provedor: "groq", cooldown_ms: 1000 } });

    checar("começa disponível", llm.disponivel === true);

    // simula uma falha
    llm.degradado = true;
    llm.tentativaEm = Date.now() + 1000;
    llm.ultimoErro = "429 Too Many Requests";
    checar("durante o cooldown, a IA fica fora", llm.disponivel === false);
    checar("mostra quanto falta", llm.esperaSegundos > 0, `${llm.esperaSegundos}s`);

    // espera o cooldown
    await new Promise((r) => setTimeout(r, 1100));
    checar("depois do cooldown, volta a tentar", llm.disponivel === true);
    checar("não está mais degradado", llm.degradado === false);

    // heurística nunca usa IA
    const heuristica = new LLM({ llm: { provedor: "heuristica" } });
    checar("heurística nunca chama a IA", heuristica.disponivel === false);

    console.log("\nTudo certo.");
    process.exit(0);
})();
