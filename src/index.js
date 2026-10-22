/**
 * src/index.js — bootstrap do Bot de Notícias.
 *
 * Fluxo:
 *   [botão no painel] ou [comando no WhatsApp] ou [resumo diário automático]
 *        → varredura das fontes → filtro → ranking → LLM (traduz + persona)
 *        → o bot pergunta no seu WhatsApp → você responde → publica no canal
 */
const fs = require("fs");
const moment = require("moment-timezone");
const cron = require("node-cron");

const config = require("./config");
const { State } = require("./state");
const { LLM } = require("./llm");
const { WhatsAppClient } = require("./client");
const { Publisher } = require("./publisher");
const { Queue } = require("./queue");
const { Api } = require("./api");
const { HA } = require("./ha");
const { ResolverLink } = require("./resolver");
const { Artigo } = require("./artigo");
const fetcher = require("./fetcher");
const relevance = require("./relevance");
const popularity = require("./popularity");
const { cardAprovacao, semResultado, horaAgora, linkFinal } = require("./formatter");

const TZ = "America/Sao_Paulo";

// ------------------------------------------------------------------ setup --
const cfg = config.load();
fs.mkdirSync(cfg.caminhos.auth, { recursive: true });

const state = new State(cfg.caminhos.estado);
const llm = new LLM(cfg);
const wa = new WhatsAppClient(cfg);
const publisher = new Publisher(wa.client, cfg);
const fila = new Queue({ state, publisher, cfg, meuNumero: cfg.meu_numero });
const resolverLinks = new ResolverLink(wa.client, {
    orcamento_ms: cfg.busca?.resolver_orcamento_ms,
    paralelismo: cfg.busca?.resolver_paralelismo,
});
const artigo = new Artigo({ timeout_ms: cfg.busca?.texto_timeout_ms });

let fontes = { fontes: [], tendencias: [] };
try {
    fontes = JSON.parse(fs.readFileSync(cfg.caminhos.fontes, "utf-8"));
} catch (err) {
    console.error("⚠️ sources.json inválido:", err.message);
}
relevance.carregarPalavras(cfg.caminhos.fontes);

// Configuração incompleta: o app ainda funciona, mas avisa o que falta.
const faltando = [];
if (!cfg.canal_id) faltando.push("canal_id (canal do WhatsApp onde publicar)");
if (!cfg.meu_numero) faltando.push("meu_numero (seu WhatsApp, para onde vão os avisos)");
if (faltando.length) {
    console.warn(`⚠️ Configure no painel do app: ${faltando.join(" · ")}`);
    console.warn("   (Ajustes → Aplicativos → Bot de Notícias → Configuração, e reinicie o app)");
}

// De onde veio a configuração (opções do app têm prioridade sobre o config.json)
const mascara = (v) => (v ? `${"*".repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : "(vazio)");
console.log(
    `⚙️ Configuração: canal=${cfg.canal_id || "(vazio)"} | meu_numero=${mascara(cfg.meu_numero)}` +
        ` | canais=${publisher.destinos.length} (${publisher.modoPublicacao}) | ia=${cfg.llm.provedor}` +
        ` | porta=${cfg.painel.porta}`
);

let emVarredura = false;
const statusFontes = {};

// ------------------------------------------------------------- Home Assistant -
const ha = new HA(cfg);
let ultimoAvisoFila = 0;

/**
 * Publica o estado do bot no HA e avisa o celular quando a fila cresce.
 * Roda sozinho: não precisa de nenhuma configuração no Home Assistant.
 */
async function atualizarHA() {
    try {
        if (!cfg.ha.publicar_estado && !cfg.ha.notificar) return;
        if (!ha.conectado) {
            const ok = await ha.iniciar();
            if (!ok) return;
        }
        const pendentes = fila.pendentes.length;

        if (cfg.ha.publicar_estado) {
            await ha.publicarEstado(cfg.ha.sensor_fila, String(pendentes), {
                friendly_name: "Bot Notícias - Pendentes",
                status: pendentes > 0 ? "aguardando aprovação" : "sem pendências",
                icone: "mdi:newspaper-variant",
                ultima_varredura: state.data.lastScan,
                ultima_publicacao: state.data.lastPublish,
                ia: llm.cfg.provedor,
                modelo: llm.modeloAtivo,
            });
        }

        if (cfg.ha.notificar && pendentes > ultimoAvisoFila) {
            const enviado = await ha.notificar(
                "Notícias de drones",
                `${pendentes} notícia(s) aguardando sua aprovação no bot.`
            );
            if (enviado) {
                console.log(`🔔 HA avisado: ${pendentes} notícia(s) na fila.`);
                ultimoAvisoFila = pendentes;
            }
        }
        if (!pendentes) ultimoAvisoFila = 0;
    } catch (err) {
        console.warn("⚠️ Falha ao falar com o Home Assistant:", err.message);
    }
}

// ------------------------------------------------------------------ scan ---
/**
 * Executa a varredura completa e manda a fila de aprovação para o seu WhatsApp.
 * @param {"manual"|"painel"|"painel-mais-lidas"|"diario"} origem
 */
async function varredura(origem = "manual") {
    if (emVarredura) {
        console.log("⏳ Já existe uma varredura em andamento.");
        return;
    }
    if (!cfg.meu_numero) {
        console.error("❌ meu_numero não configurado — não sei para quem perguntar.");
        return;
    }
    emVarredura = true;
    const inicio = Date.now();

    try {
        console.log(`\n🔍 Varredura iniciada (${origem}) — ${horaAgora()}`);

        // 1) coleta
        const brutos = await fetcher.buscarTodas(fontes.fontes || []);

        // 2) filtra o que é sobre pulverização
        const maxIdadeDias = cfg.busca?.max_idade_dias ?? 7;
        const analisados = [];
        for (const item of brutos) {
            const analise = relevance.analisar(item);
            if (!analise.relevante) continue;
            if (state.jaViu(item.link)) continue;
            analisados.push({ ...item, ...analise });
        }
        const relevantes = relevance.filtrarRecentes(analisados, maxIdadeDias);
        console.log(
            `🎯 Relevantes: ${analisados.length} → ${relevantes.length} dentro de ${maxIdadeDias} dia(s)`
        );

        if (!relevantes.length) {
            await publisher.enviarPara(cfg.meu_numero, semResultado("Nenhuma notícia nova sobre pulverização."));
            return;
        }

        // 3) deduplica (mesma matéria em vários feeds) e mede o alcance
        const unicos = popularity.calcularAlcance(relevantes);
        console.log(`🧩 Após deduplicar: ${unicos.length} notícia(s) única(s)`);

        // 4) popularidade
        let tendencias = null;
        if (cfg.busca?.usar_tendencias_google) {
            tendencias = await popularity.carregarTendencies(fontes.tendencias || []);
        }
        popularity.aplicarPopularidade(unicos, tendencias);

        // 5) ranking (relevância + popularidade + o que você já aprovou/pulou)
        const ranqueados = relevance.ranquear(unicos, {
            pesoPerfil: (c) => {
                const palavras = c.titulo.toLowerCase().match(/[a-zà-ÿ]{4,}/g) || [];
                return palavras.reduce((soma, p) => soma + state.pesoTermo(p), 0);
            },
        });

        // 6) limita
        const limite = origem === "diario" ? cfg.resumo_diario.max_noticias : cfg.busca.max_noticias_por_varredura;
        let sel = ranqueados.slice(0, limite);

        if (origem === "painel-mais-lidas" || origem === "diario") {
            sel = sel.sort((a, b) => (b.popularidade || 0) - (a.popularidade || 0));
        }

        // 7) resolve o link real (o Google News manda um redirect) — só dos que vão pro card
        console.log(`🔗 Resolvendo ${sel.length} link(s)...`);
        const resolvidos = await resolverLinks.resolverVarios(
            sel.map((item) => item.link),
            (feitas, total) => console.log(`   ${feitas}/${total} resolvido(s)`)
        );
        sel.forEach((item, i) => {
            const real = resolvidos[i];
            if (real && real !== item.link) {
                item.linkOriginal = item.link;
                item.link = real;
            }
        });

        // 8) busca o texto das matérias (por HTTP, sem abrir navegador) para a
        //    IA escrever o comentário com base no conteúdo real
        console.log("📄 Buscando o texto das matérias...");
        const textos = await artigo.textos(
            sel.map((item) => item.link),
            cfg.busca?.texto_orcamento_ms,
            cfg.busca?.texto_paralelismo
        );
        sel.forEach((item, i) => {
            if (textos[i]) item.texto = textos[i];
        });
        const comTexto = sel.filter((i) => i.texto).length;
        console.log(`   ${comTexto}/${sel.length} matéria(s) com texto`);

        // 9) LLM: traduz e reescreve no tom do canal
        sel = await llm.reescrever(sel);

        // 9) pergunta para você
        state.data.stats.varreduras += 1;
        state.data.lastScan = new Date().toISOString();
        state.saveNow();

        await fila.iniciar(sel);
        console.log(`✅ Varredura concluída em ${((Date.now() - inicio) / 1000).toFixed(1)}s — ${sel.length} card(s) enviado(s).`);
        await atualizarHA();
        await ha.dispararEvento("bot_noticias_varredura", {
            origem,
            noticias: sel.length,
            pendentes: fila.pendentes.length,
        });
    } catch (err) {
        console.error("❌ Erro na varredura:", err);
        try {
            await publisher.enviarPara(cfg.meu_numero, `❌ Erro na varredura: ${err.message}`);
        } catch (_) {}
    } finally {
        emVarredura = false;
    }
}

// -------------------------------------------------------------- comandos ---
async function comandos(texto, numero) {
    const t = String(texto || "").trim();
    const cmd = t.toLowerCase();

    // qualquer coisa durante a fila é tratada como resposta de aprovação
    if (fila.pendentes.length && /^[1-5]$|^todos$|^publicar tudo$|^cancelar$|^sim$|^não$|^nao$/.test(cmd)) {
        const r = await fila.tratarResposta(cmd);
        console.log(`↩️  resposta "${cmd}" → ${r.acao}`);
        return true;
    }

    if (["noticias", "notícia", "buscar", "scan", "pesquisar", "vai"].includes(cmd)) {
        await varredura("manual");
        return true;
    }
    if (["mais lidas", "maislidas", "populares", "trending"].includes(cmd)) {
        await varredura("painel-mais-lidas");
        return true;
    }
    if (cmd === "status" || cmd === "estado") {
        const s = await statusGeral();
        await publisher.enviarPara(numero, s);
        return true;
    }
    if (cmd === "fontes") {
        await publisher.enviarPara(numero, await textoFontes());
        return true;
    }
    if (cmd === "modelos" || cmd === "modelos de texto" || cmd === "ia") {
        await publisher.enviarPara(numero, await textoModelos());
        return true;
    }
    if (cmd.startsWith("modelo ")) {
        const id = t.slice(7).trim();
        const r = llm.cfg;
        if (llm.cfg.provedor === "groq") r.groq_modelo = id;
        else if (llm.cfg.provedor === "ollama") r.ollama_modelo = id;
        else if (llm.cfg.provedor === "ha_assist") r.agent_id = id;
        await publisher.enviarPara(numero, `✅ Modelo ativo agora: *${id}*`);
        return true;
    }
    if (cmd === "cancelar" || cmd === "parar") {
        fila.state.limparFila();
        await publisher.enviarPara(numero, "🛑 Fila cancelada.");
        return true;
    }
    if (cmd === "ajuda" || cmd === "help" || cmd === "?") {
        await publisher.enviarPara(numero, textoAjuda());
        return true;
    }
    return false;
}

function textoAjuda() {
    return [
        "🤖 *Bot de Notícias — Drones de Pulverização*",
        "",
        "Comandos disponíveis:",
        "*noticias* — varre as fontes e pergunta sobre as novidades",
        "*mais lidas* — varre priorizando o que mais rendeu no dia",
        "*status* — estado do bot",
        "*fontes* — como estão as fontes",
        "*modelos* — modelos de texto (IA) disponíveis",
        "*modelo \\<id\\>* — troca o modelo ativo",
        "*cancelar* — descarta a fila atual",
        "",
        "Durante a fila de aprovação:",
        "1 gostei · 2 não gostei · 3 editar · 4 ver original · 5 publicar todas",
    ].join("\n");
}

async function statusGeral() {
    const s = state.data;
    return [
        "📊 *Status do Bot de Notícias*",
        "",
        `Canal: \`${cfg.canal_id || "não configurado"}\``,
        `Você: ${cfg.meu_numero ? `+${cfg.meu_numero}` : "não configurado"}`,
        `IA: ${llm.cfg.provedor} / ${llm.modeloAtivo}`,
        `Última varredura: ${s.lastScan ? new Date(s.lastScan).toLocaleString("pt-BR") : "nunca"}`,
        `Última publicação: ${s.lastPublish ? new Date(s.lastPublish).toLocaleString("pt-BR") : "nunca"}`,
        `Fila aguardando você: ${fila.pendentes.length}`,
        "",
        `Varreduras: ${s.stats.varreduras} · Publicadas: ${s.stats.publicadas} · Puladas: ${s.stats.puladas}`,
    ].join("\n");
}

async function textoFontes() {
    const linhas = ["📡 *Fontes*", ""];
    for (const f of fontes.fontes || []) {
        const st = statusFontes[f.id];
        const marca = st?.ok ? "✅" : st?.erro ? "❌" : "…";
        linhas.push(`${marca} ${f.nome}${st?.itens ? ` (${st.itens} itens)` : ""}${st?.erro ? ` — ${st.erro}` : ""}`);
    }
    return linhas.join("\n");
}

async function textoModelos() {
    const r = await llm.listarModelos();
    if (!r.ok) {
        return [
            `⚠️ Não consegui listar os modelos (${r.provedor}): ${r.erro}`,
            "",
            r.provedor === "groq"
                ? "Verifique a GROQ_API_KEY (https://console.groq.com/keys) — o free tier não pede cartão."
                : "Verifique a configuração do provedor de IA.",
        ].join("\n");
    }
    const linhas = [`🧠 *Modelos de texto* — provedor: ${r.provedor}`, ""];
    if (!r.modelos.length) linhas.push("(nenhum modelo encontrado)");
    for (const m of r.modelos.slice(0, 40)) {
        const extras = [m.contexto ? `${(m.contexto / 1000).toFixed(0)}k ctx` : null, m.tamanho, m.nome]
            .filter(Boolean)
            .join(" · ");
        linhas.push(`• \`${m.id}\`${extras ? ` — ${extras}` : ""}`);
    }
    linhas.push("", `Ativo agora: *${llm.modeloAtivo}*`, "Troque com: modelo <id>");
    return linhas.join("\n");
}

// -------------------------------------------------------------------- API --
const api = new Api({
    cfg,
    acoes: {
        status: async () => ({
            pronto: true,
            canal_id: cfg.canal_id,
            canais: publisher.destinos,
            modo_publicacao: publisher.modoPublicacao,
            meu_numero: cfg.meu_numero,
            ia: { provedor: llm.cfg.provedor, modelo: llm.modeloAtivo, degradado: llm.degradado },
            whatsapp: { conectado: wa.conectado },
            ultima_varredura: state.data.lastScan,
            ultima_publicacao: state.data.lastPublish,
            fila: fila.pendentes.length,
            stats: state.data.stats,
        }),
        qr: async () => ({
            conectado: wa.conectado,
            qr: await wa.qrDataUrl(),
        }),
        fila: async () => ({
            itens: fila.pendentes.map((i) => ({
                id: i.id || null,
                ordem: i.ordem,
                titulo: i.titulo,
                resumo: i.resumo || "",
                // mesmo link que vai ser publicado (o painel nunca mostra
                // um link quebrado)
                link: linkFinal(i),
                linkOriginal: i.linkOriginal || "",
                fonte: i.fonte,
                regiao: i.regiao,
                data: i.data,
            })),
        }),
        agirFila: async (id, acao) => fila.agir(id, acao),
        publicarTodas: async () => {
            const publicadas = await fila.publicarTodas();
            return { ok: true, publicadas: publicadas.length };
        },
        fontes: async () => ({ fontes: fontes.fontes || [], status: statusFontes }),
        ultimas: async () => ({
            ultimas: state.data.publicados.slice(0, 10).map((p) => ({
                ...p,
                link: linkFinal(p),
            })),
        }),
        modelos: async () => llm.listarModelos(),
        trocarModelo: async (id) => {
            if (!id) return { ok: false, erro: "id obrigatório" };
            if (llm.cfg.provedor === "groq") llm.cfg.groq_modelo = id;
            else if (llm.cfg.provedor === "ollama") llm.cfg.ollama_modelo = id;
            else if (llm.cfg.provedor === "ha_assist") llm.cfg.agent_id = id;
            return { ok: true, modelo: llm.modeloAtivo };
        },
        buscar: (origem) => {
            varredura(origem);
        },
    },
});
api.iniciar();

// --------------------------------------------------------- resumo diário ---
if (cfg.resumo_diario?.ativo) {
    const [hh, mm] = String(cfg.resumo_diario.hora || "07:00").split(":");
    const cronExpr = `${parseInt(mm, 10)} ${parseInt(hh, 10)} * * *`;
    console.log(`⏰ Resumo diário programado para ${cfg.resumo_diario.hora} (${TZ}) — cron "${cronExpr}"`);
    cron.schedule(
        cronExpr,
        () => {
            const agora = moment().tz(TZ);
            const [inicio, fim] = [
                cfg.busca?.janela_horaria?.inicio || "00:00",
                cfg.busca?.janela_horaria?.fim || "23:59",
            ];
            if (agora.format("HH:mm") < inicio || agora.format("HH:mm") > fim) {
                console.log("⏰ Fora da janela de horário — resumo ignorado.");
                return;
            }
            varredura("diario");
        },
        { timezone: TZ }
    );
}

// ------------------------------------------------------------- WhatsApp ---
wa.registrar({
    onReady: async () => {
        console.log(`🤖 Bot de Notícias ativo. Canal: ${cfg.canal_id || "(não configurado)"}`);
        try {
            await publisher.enviarPara(
                cfg.meu_numero,
                `🤖 *Bot de Notícias pronto!*\n\nCanal: \`${cfg.canal_id || "não configurado"}\`\nIA: ${llm.cfg.provedor} / ${llm.modeloAtivo}\n\nMande *noticias* quando quiser, ou use o painel.\nAjuda: *ajuda*`
            );
        } catch (err) {
            console.error("⚠️ não consegui mandar a mensagem de prontidão:", err.message);
        }
    },
    onMessage: async (msg, numero) => {
        const texto = (msg.body || "").trim();
        if (!texto) return;

        // só o dono (ou o número configurado) interage
        const autorizado =
            (cfg.admin_phone && numero === cfg.admin_phone) ||
            (cfg.meu_numero && numero === cfg.meu_numero);
        if (!autorizado) {
            console.log(`🔒 Mensagem ignorada de número não autorizado: ${numero}`);
            return;
        }

        console.log(`📩 [${numero}] ${texto}`);
        const tratado = await comandos(texto, numero);
        if (!tratado && fila.pendentes.length) {
            // durante a fila, texto livre = novo título (modo edição) ou erro
            const r = await fila.tratarResposta(texto);
            if (r.acao === "desconhecida") {
                await publisher.enviarPara(numero, "🤔 Não entendi. Responda 1, 2, 3, 4 ou 5 — ou mande *ajuda*.");
            }
        }
    },
});

wa.iniciar();

// -------------------------------------------------------- Home Assistant ---
// Conecta no HA (aviso de celular + estado da fila) e mantém atualizado.
(async () => {
    await atualizarHA();
    // Não reavisa de notícias que já estavam na fila antes do bot subir.
    if (!ultimoAvisoFila) ultimoAvisoFila = fila.pendentes.length;
    setInterval(atualizarHA, 60000);
})();

module.exports = { varredura };
