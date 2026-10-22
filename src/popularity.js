/**
 * src/popularity.js — estima o quanto a notícia "rendeu" no dia.
 *
 * Sinais usados (todos sem chave de API):
 *   A. ALCANCE  → quantos veículos distintos cobriram o mesmo fato (cluster por título)
 *   B. TENDÊNCIAS → casou com as buscas em alta do Google (traffic real)
 *   C. POSIÇÃO  → posição na lista "Mais lidas" dos portais (usa o Chromium do add-on)
 */
const { http, limparHtml } = require("./fetcher");
const Parser = require("rss-parser");

const parser = new Parser({
    customFields: {
        item: [
            ["ht:approx_traffic", "traffic"],
            ["ht:news_item", "newsItems", { keepArray: true }],
        ],
    },
});

const STOP = new Set([
    "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas", "um", "uma", "para", "com",
    "por", "que", "the", "a", "an", "of", "in", "on", "for", "to", "and", "with", "is", "are",
    "new", "how", "why", "what", "após", "sobre", "pelo", "pela", "como", "mais", "entre", "ano",
    "anos", "dia", "dias", "diz", "vai", "ser", "são", "tem", "ter",
]);

function tokenizar(texto) {
    return new Set(
        String(texto || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((t) => t.length > 3 && !STOP.has(t))
    );
}

function similaridade(a, b) {
    const ta = tokenizar(a);
    const tb = tokenizar(b);
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter += 1;
    return inter / Math.min(ta.size, tb.size);
}

/**
 * A. Alcance: agrupa notícias parecidas e devolve quantos veículos cobriram cada uma.
 *    Também remove duplicatas: quando a mesma matéria aparece em vários feeds,
 *    fica só a melhor (maior score, mais recente) — as demais viram "veículos" da mesma.
 */
function calcularAlcance(candidatos) {
    const grupos = [];
    for (const c of candidatos) {
        let encontrado = null;
        for (const g of grupos) {
            if (similaridade(g.titulo, c.titulo) >= 0.45) {
                encontrado = g;
                break;
            }
        }
        if (encontrado) {
            encontrado.itens.push(c);
            if (c.fonte && !encontrado.fontes.has(c.fonte)) {
                encontrado.fontes.add(c.fonte);
            }
        } else {
            grupos.push({ titulo: c.titulo, itens: [c], fontes: new Set([c.fonte]) });
        }
    }

    const saida = [];
    for (const g of grupos) {
        // melhor primeiro: score, depois data mais recente
        g.itens.sort(
            (a, b) =>
                (b.score || 0) - (a.score || 0) ||
                new Date(b.data || 0).getTime() - new Date(a.data || 0).getTime()
        );
        const melhor = g.itens[0];
        melhor.veiculos = g.fontes.size;
        melhor.cluster = g.itens.length;
        melhor.outrosTitulos = g.itens.slice(1, 4).map((i) => i.titulo);
        saida.push(melhor);
    }
    return saida;
}

/** B. Tendências do Google: RSS público com traffic estimado. */
async function carregarTendencies(fontesTendencias) {
    const resultado = { consultas: [], noticias: [] };
    for (const f of fontesTendencias || []) {
        try {
            const r = await http.get(f.url);
            const feed = await parser.parseString(String(r.data));
            for (const item of feed.items || []) {
                const consulta = String(item.title || "").trim();
                const traffic = parseInt(String(item.traffic || "0").replace(/\D/g, ""), 10) || 0;
                resultado.consultas.push({ consulta, traffic, fonte: f.nome });
                for (const ni of item.newsItems || []) {
                    resultado.noticias.push({
                        titulo: limparHtml(ni.title || ""),
                        link: ni.url || "",
                        fonte: ni.source || "",
                        consulta,
                        traffic,
                    });
                }
            }
        } catch (err) {
            console.log(`   ⚠️  tendências ${f.id}: falhou (${err.message})`);
        }
    }
    return resultado;
}

/** Aplica os sinais de popularidade nos candidatos. */
function aplicarPopularidade(candidatos, tendencias) {
    const maxTraffic = Math.max(1, ...(tendencias?.consultas || []).map((c) => c.traffic));

    for (const c of candidatos) {
        let pop = 0;
        const detalhes = [];

        // A. alcance (normalizado entre 1 e 5 veículos distintos)
        const alcance = Math.min(c.veiculos || 1, 5);
        pop += (alcance / 5) * 3.0;
        if (alcance > 1) detalhes.push(`alcance:${alcance}`);

        // B. tendência do Google
        if (tendencias) {
            for (const n of tendencias.noticias) {
                if (n.link && n.link === c.link) {
                    pop += (n.traffic / maxTraffic) * 2.0;
                    detalhes.push("tendência");
                    break;
                }
            }
            if (!detalhes.includes("tendência")) {
                for (const q of tendencias.consultas) {
                    const sim = similaridade(q.consulta, c.titulo);
                    if (sim > 0.4) {
                        pop += (q.traffic / maxTraffic) * 1.5;
                        detalhes.push("tendência-busca");
                        break;
                    }
                }
            }
        }

        // C. posição em "Mais lidas" (preenchido por popularidade_maislidas.js, se existir)
        if (typeof c.maisLidasPosicao === "number") {
            pop += Math.max(0, 1 - c.maisLidasPosicao / 20) * 4.0;
            detalhes.push(`mais-lidas:#${c.maisLidasPosicao + 1}`);
        }

        c.popularidade = pop;
        c.detalhesPopularidade = detalhes;
    }
    return candidatos;
}

module.exports = { calcularAlcance, carregarTendencies, aplicarPopularidade, similaridade, tokenizar };
