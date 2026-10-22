/**
 * src/formatter.js — monta as mensagens (card de aprovação para você, post do canal).
 */
const moment = require("moment-timezone");

const TZ = "America/Sao_Paulo";

function dataCurta(iso) {
    if (!iso) return "hoje";
    return moment(iso).tz(TZ).format("DD/MM/YYYY");
}

const { ehLinkPublicavel } = require("./artigo");

/**
 * Link final: o resolvido (veículo real) quando for um link válido;
 * senão o link original do feed.
 *
 * Links inválidos acontecem quando a resolução falha: o Chromium devolve
 * "chrome-error://chromewebdata/" e publicar isso quebraria a notícia.
 */
function linkFinal(item) {
    const resolvido = String(item.linkReal || item.link || "");
    if (ehLinkPublicavel(resolvido)) return resolvido;
    const original = String(item.linkOriginal || "");
    if (ehLinkPublicavel(original)) return original;
    return ""; // nenhum link publicável
}

function horaAgora() {
    return moment().tz(TZ).format("DD/MM/YYYY HH:mm");
}

/** Card enviado para o seu WhatsApp pessoal, pedindo a aprovação. */
function cardAprovacao(item, indice, total) {
    const regiao = item.regiao === "BR" ? "🇧🇷 Brasil" : "🌍 Mundo";
    const linhas = [
        `📰 *Notícia ${indice}/${total}*  ·  ${regiao}`,
        "",
        `*${item.titulo}*`,
    ];
    if (item.comentario || item.resumo) {
        linhas.push("", `_${item.comentario || item.resumo}_`);
    }
    linhas.push("", `🔗 ${linkFinal(item)}`);
    linhas.push(
        "",
        `Fonte: ${item.fonte} · ${dataCurta(item.data)}`,
        item.detalhesPopularidade?.length ? `Sinais: ${item.detalhesPopularidade.join(", ")}` : "",
        "",
        "*O que você achou?*",
        "1️⃣ Gostei — publicar no canal",
        "2️⃣ Não gostei — descartar",
        "3️⃣ Editar o texto antes de publicar",
        "4️⃣ Ver o original (link completo)",
        "5️⃣ Publicar todas as restantes"
    );
    return linhas.filter((l) => l !== undefined).join("\n");
}

/** Mensagem publicada no canal — tom de influencer de campo, não de comunicado. */
function mensagemCanal(item, cfg = {}) {
    const pub = cfg.publicacao || {};
    const prefixo = pub.prefixo || "🚁";
    const linhas = [`${prefixo} *${item.titulo}*`];

    // comentário da IA (2-3 frases, no tom do canal)
    const comentario = String(item.comentario || item.resumo || "").trim();
    if (comentario) linhas.push("", comentario);

    // gancho: o que o leitor faz com a informação
    linhas.push("", pub.gancho || "💬 Se você também aplica com drone, me conta aqui.");

    const link = linkFinal(item);
    if (link) linhas.push("", `🔗 ${link}`);

    const rodape = (pub.rodape || "Fonte: {fonte} | {data}")
        .replace("{fonte}", item.fonte)
        .replace("{data}", dataCurta(item.data));
    linhas.push(`_${rodape}_`);

    return linhas.join("\n");
}

/** Resumo do que foi publicado, enviado para você depois da fila. */
function resumoFim(publicados, pulados) {
    if (!publicados.length) {
        return `📭 Nada publicado.\n\nVocê pulou ${pulados} notícia(s).\n\nDica: use "3" para editar o texto — às vezes a manchete original é truncada.`;
    }
    const lista = publicados.map((p, i) => `${i + 1}. ${p.titulo}`).join("\n");
    return [
        `✅ *${publicados.length} notícia(s) publicada(s) no canal.*`,
        "",
        lista,
        "",
        `_Enviado em ${horaAgora()}_`,
    ].join("\n");
}

/** Aviso de erro/sem resultado. */
function semResultado(motivo) {
    return `🔍 Varredura concluída — nada novo por enquanto.\n\n${motivo}\n\nTente de novo mais tarde ou mande "fontes" para ver o estado das fontes.`;
}

module.exports = { cardAprovacao, mensagemCanal, resumoFim, semResultado, dataCurta, horaAgora, linkFinal };
