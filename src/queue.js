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
        candidatos.forEach((c, i) => {
            this.state.adicionarItem({ ...c, ordem: i + 1, status: "aguardando" });
        });
        this.state.saveNow();
        return this.enviarProximo();
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
