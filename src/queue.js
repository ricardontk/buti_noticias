/**
 * src/queue.js — máquina de estados da aprovação.
 *
 * O bot pergunta, você responde. Cada resposta avança a fila.
 */
const { cardAprovacao, mensagemCanal, resumoFim } = require("./formatter");

const ACEITAR = ["1", "1️⃣", "sim", "s", "ok", "gostei", "gosto", "publicar", "bota", "manda"];
const PULAR = ["2", "2️⃣", "nao", "não", "n", "pular", "descartar", "nao gostei", "não gostei"];
const EDITAR = ["3", "3️⃣", "editar", "mudar", "ajustar"];
const ABRIR = ["4", "4️⃣", "abrir", "original", "ver"];
const TODOS = ["5", "5️⃣", "todos", "publicar tudo", "tudo"];
const CANCELAR = ["cancelar", "cancela", "parar", "stop"];

class Queue {
    constructor({ state, publisher, cfg, meuNumero }) {
        this.state = state;
        this.publisher = publisher;
        this.cfg = cfg;
        this.meuNumero = meuNumero;
        this.editando = false;
    }

    get pendentes() {
        return this.state.fila.filter((i) => i.status === "aguardando");
    }

    get atual() {
        return this.state.fila.find((i) => i.status === "aguardando");
    }

    /** Recebe os candidatos e começa a perguntar, um a um. */
    async iniciar(candidatos) {
        this.state.limparFila();
        const lote = Date.now().toString(36);
        candidatos.forEach((c, i) => {
            this.state.adicionarItem({ ...c, id: `${lote}-${i}`, ordem: i + 1, status: "aguardando" });
        });
        this.state.saveNow();
        return this.enviarProximo();
    }

    /** Acha um item da fila pelo id (ou pela ordem). */
    achar(id) {
        const fila = this.state.fila;
        let item = fila.find((i) => i.id && String(i.id) === String(id));
        // itens antigos (sem id) — procura pela ordem que aparece no painel
        if (!item && /^\d+$/.test(String(id))) {
            const ordem = parseInt(id, 10);
            item = fila.find((i) => i.ordem === ordem);
            if (!item) item = fila.find((i) => i.status === "aguardando" && i.ordem === ordem);
        }
        return item;
    }

    /**
     * Ação vinda do painel web: publica ou pula um item específico.
     * Se for o item que está esperando resposta no WhatsApp, o fluxo continua lá.
     * @param {string} id
     * @param {"publicar"|"pular"} acao
     */
    async agir(id, acao) {
        const item = this.achar(id);
        if (!item) return { ok: false, erro: "item não encontrado na fila" };
        if (item.status === "publicando") {
            return { ok: false, erro: "esta notícia já está sendo publicada" };
        }
        if (item.status === "publicada") {
            return { ok: false, erro: "esta notícia já foi publicada" };
        }
        if (item.status !== "aguardando" && item.status !== "falhou") {
            return { ok: false, erro: `este item já está ${item.status}` };
        }
        const eraAtual = item === this.atual;

        if (acao === "publicar") {
            const ok = await this.publicarItem(item);
            if (eraAtual) await this.enviarProximo();
            if (!ok.ok) {
                // mensagem que faz sentido para quem está olhando o painel
                const causa = String(ok.erro || "");
                if (/not authenticated|not logged|logged out|session|disconnected|ECONN/i.test(causa)) {
                    return {
                        ok: false,
                        erro: "📱 WhatsApp desconectado — escaneie o QR Code no painel e tente de novo.",
                    };
                }
            }
            return { ok: ok.ok, erro: ok.erro, item: { id: item.id, status: item.status } };
        }

        if (acao === "pular") {
            item.status = "pulada";
            this.state.registrarPulada(item);
            this.state.aprender(item, false);
            console.log(`⏭️  Pulada pelo painel: ${item.titulo}`);
            if (eraAtual) await this.enviarProximo();
            return { ok: true, item: { id: item.id, status: item.status } };
        }

        return { ok: false, erro: `ação desconhecida: ${acao}` };
    }

    /** Publica tudo que está na fila (usado pelo painel web). */
    async publicarTodas() {
        const publicados = [];
        for (const pend of this.pendentes) {
            const ok = await this.publicarItem(pend);
            if (ok.ok) publicados.push(pend);
        }
        console.log(`✅ Publicadas ${publicados.length} notícia(s) pelo painel.`);
        return publicados;
    }

    async enviarProximo() {
        const item = this.atual;
        if (!item) {
            await this.finalizar();
            return { fim: true };
        }
        const total = this.pendentes.length + 1;
        const texto = cardAprovacao(item, item.ordem, total);
        try {
            await this.publisher.enviarPara(this.meuNumero, texto);
            console.log(`❓ Perguntando (${item.ordem}) a você: ${item.titulo}`);
            return { item, texto };
        } catch (err) {
            console.error("❌ não consegui perguntar:", err.message);
            return { erro: err.message };
        }
    }

    /**
     * Processa a resposta do usuário.
     * @returns {Promise<{acao:string, mensagem?:string}>}
     */
    async tratarResposta(bruto) {
        const texto = String(bruto || "").trim().toLowerCase();

        // modo edição: o próximo texto é o novo título
        if (this.editando) {
            this.editando = false;
            const item = this.atual;
            if (!item) return { acao: "nada" };
            item.titulo = String(bruto).trim();
            item.editado = true;
            this.state.save();
            const ok = await this.publicarItem(item);
            await this.enviarProximo();
            return { acao: ok.ok ? "publicada" : "falhou", item, mensagem: ok.erro };
        }

        if (CANCELAR.includes(texto)) {
            this.state.limparFila();
            this.editando = false;
            return { acao: "cancelada" };
        }

        const item = this.atual;
        if (!item) return { acao: "nada" };

        if (ACEITAR.includes(texto)) {
            const ok = await this.publicarItem(item);
            await this.enviarProximo();
            return { acao: ok.ok ? "publicada" : "falhou", item, mensagem: ok.erro };
        }

        if (PULAR.includes(texto)) {
            item.status = "pulada";
            this.state.registrarPulada(item);
            this.state.aprender(item, false);
            await this.enviarProximo();
            return { acao: "pulada", item };
        }

        if (EDITAR.includes(texto)) {
            this.editando = true;
            return { acao: "editando", item };
        }

        if (ABRIR.includes(texto)) {
            const detalhes = [
                `📄 *${item.titulo}*`,
                "",
                item.resumo || "(sem resumo no feed)",
                "",
                `🔗 ${item.linkReal || item.link}`,
                `Fonte: ${item.fonte}`,
                `Região: ${item.regiao === "BR" ? "Brasil" : "Mundo"}`,
                item.data ? `Data: ${new Date(item.data).toLocaleString("pt-BR")}` : "",
            ]
                .filter(Boolean)
                .join("\n");
            await this.publisher.enviarPara(this.meuNumero, detalhes);
            return { acao: "detalhes", item };
        }

        if (TODOS.includes(texto)) {
            const publicados = [];
            for (const pend of this.pendentes) {
                const ok = await this.publicarItem(pend);
                if (ok.ok) publicados.push(pend);
            }
            await this.publisher.enviarPara(this.meuNumero, resumoFim(publicados, 0));
            return { acao: "publicadas_todas", publicados };
        }

        return { acao: "desconhecida" };
    }

    async publicarItem(item) {
        // Trava na hora: dois cliques quase juntos (ou painel + WhatsApp ao
        // mesmo tempo) não podem publicar a mesma notícia duas vezes.
        if (item.status === "publicando") {
            return { ok: false, erro: "esta notícia já está sendo publicada" };
        }
        item.status = "publicando";

        const texto = mensagemCanal(item, this.cfg);
        const resultado = await this.publisher.publicar(item, texto);
        if (resultado.ok) {
            item.status = "publicada";
            this.state.registrarPublicada(item);
            this.state.aprender(item, true);
            console.log(`✅ Publicada: ${item.titulo}`);
        } else {
            item.status = "falhou";
            this.state.save();
            console.error(`❌ Falha ao publicar "${item.titulo}": ${resultado.erro || ""}`);
        }
        return resultado;
    }

    async finalizar() {
        const publicadas = this.state.fila.filter((i) => i.status === "publicada");
        const puladas = this.state.fila.filter((i) => i.status === "pulada");
        if (publicadas.length) {
            await this.publisher.enviarPara(this.meuNumero, resumoFim(publicadas, puladas.length));
        }
        this.state.limparFila();
    }
}

module.exports = { Queue };
