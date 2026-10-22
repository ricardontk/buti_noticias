/**
 * scripts/teste-pipeline.js — teste do pipeline SEM WhatsApp.
 *
 * Busca nas fontes, filtra, ranqueia e mostra o que seria perguntado a você.
 * Útil para validar feeds, filtro e ranking sem depender do WhatsApp.
 *
 * Uso: node scripts/teste-pipeline.js [quantidade]
 */
const config = require("../src/config");
const fetcher = require("../src/fetcher");
const relevance = require("../src/relevance");
const popularity = require("../src/popularity");
const { LLM } = require("../src/llm");
const { cardAprovacao } = require("../src/formatter");

(async () => {
    const cfg = config.load();
    const limite = parseInt(process.argv[2], 10) || 5;

    const fontes = require(cfg.caminhos.fontes);
    relevance.carregarPalavras(cfg.caminhos.fontes);

    const brutos = await fetcher.buscarTodas(fontes.fontes || []);
    console.log(`\n📦 Brutos: ${brutos.length}`);

    const relevantes = [];
    for (const item of brutos) {
        const a = relevance.analisar(item);
        if (a.relevante) relevantes.push({ ...item, ...a });
    }
    const recentes = relevance.filtrarRecentes(relevantes, 7);
    console.log(`🎯 Relevantes: ${relevantes.length} → ${recentes.length} dentro de 7 dias`);

    const unicos = popularity.calcularAlcance(recentes);
    console.log(`🧩 Após deduplicar: ${unicos.length} notícia(s) única(s)`);

    popularity.calcularAlcance(relevantes);
    const tend = await popularity.carregarTendencies(fontes.tendencias || []);
    popularity.aplicarPopularidade(unicos, tend);

    const ranqueados = relevance.ranquear(unicos).slice(0, limite);
    console.log(`🏆 Top ${ranqueados.length}:\n`);

    const llm = new LLM(cfg);
    const reescritos = await llm.reescrever(ranqueados);

    reescritos.forEach((c, i) => {
        console.log("─".repeat(60));
        console.log(cardAprovacao(c, i + 1, reescritos.length));
        console.log(`   [score=${c.scoreFinal?.toFixed(2)} popularidade=${(c.popularidade || 0).toFixed(2)} veiculos=${c.veiculos}]`);
    });
})();
