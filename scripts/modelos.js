/**
 * scripts/modelos.js — lista os modelos de texto disponíveis e testa o LLM.
 *
 * Uso:
 *   node scripts/modelos.js            -> lista modelos do provedor configurado
 *   node scripts/modelos.js testar     -> testa o LLM com uma frase curta
 */
const config = require("../src/config");
const { LLM } = require("../src/llm");

(async () => {
    const cfg = config.load();
    const llm = new LLM(cfg);

    console.log(`\n🔧 Provedor: ${cfg.llm.provedor}`);

    if (cfg.llm.provedor === "groq") {
        console.log(`   Chave: ${cfg.llm.groq_api_key ? "configurada ✅" : "AUSENTE ❌ (GROQ_API_KEY)"}`);
        console.log(`   Modelo ativo: ${cfg.llm.groq_modelo}`);
        console.log("   (chave gratuita: https://console.groq.com/keys — não pede cartão)");
    }
    if (cfg.llm.provedor === "ha_assist") {
        console.log(`   Token HA: ${cfg.llm.ha_token ? "configurado ✅" : "AUSENTE ❌ (HA_TOKEN)"}`);
        console.log(`   URL: ${cfg.llm.ha_url}`);
    }
    if (cfg.llm.provedor === "ollama") {
        console.log(`   URL: ${cfg.llm.ollama_url}`);
        console.log(`   Modelo: ${cfg.llm.ollama_modelo}`);
    }

    const r = await llm.listarModelos();
    console.log(`\n📋 Modelos (${r.provedor}):`);
    if (!r.ok) {
        console.log(`   ❌ ${r.erro}`);
    } else if (!r.modelos.length) {
        console.log("   (nenhum)");
    } else {
        for (const m of r.modelos) {
            const extras = [m.contexto ? `${Math.round(m.contexto / 1000)}k ctx` : null, m.tamanho, m.nome]
                .filter(Boolean)
                .join(" · ");
            console.log(`   • ${m.id}${extras ? `  (${extras})` : ""}`);
        }
    }

    if (process.argv.includes("testar")) {
        console.log("\n🧪 Testando o LLM...");
        const t = await llm.testar();
        console.log(`   ${t.ok ? "✅" : "❌"} ${t.ms}ms — ${t.exemplo}`);
    }
    console.log("");
})();
