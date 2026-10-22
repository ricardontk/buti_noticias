/**
 * src/publisher.js — publica a notícia aprovada no canal do WhatsApp.
 *
 * Destinos:
 *   - canal   (newsletter): 120363...@newsletter
 *   - grupo   (fallback):   123-456@g.us
 *
 * Pode haver mais de um canal:
 *   - `cfg.canais`  lista de canais (separados por vírgula)
 *   - `cfg.modo_publicacao`:
 *       "reserva" -> publica no primeiro canal que funcionar (o resto é reserva)
 *       "todos"   -> publica em todos os canais da lista
 *
 * Observação importante: NÃO usamos window.WWebJS.getChannelMetadata() — essa função do
 * wwebjs está quebrada nas versões atuais do WhatsApp Web (getRoleByIdentifier removido).
 * Para consultar metadados use o job direto (ver scripts/listar_canais.js).
 */
const axios = require("axios");
const { MessageMedia } = require("whatsapp-web.js");

const http = axios.create({ timeout: 20000 });

class Publisher {
    constructor(client, cfg) {
        this.client = client;
        this.cfg = cfg;
    }

    get destino() {
        if (this.cfg.destino_padrao === "grupo" && this.cfg.destino_grupo) {
            return this.cfg.destino_grupo;
        }
        return this.cfg.canal_id;
    }

    /**
     * Todos os destinos de canal, em ordem de preferência.
     * Aceita `canais` como lista ou como texto separado por vírgula.
     */
    get destinos() {
        const lista = [];
        const bruto = this.cfg.canais;
        const partes = Array.isArray(bruto)
            ? bruto
            : String(bruto || "")
                  .split(",")
                  .map((s) => s.trim());
        for (const item of partes) {
            if (item && !lista.includes(item)) lista.push(item);
        }
        if (this.cfg.canal_id && !lista.includes(this.cfg.canal_id)) {
            lista.unshift(this.cfg.canal_id);
        }
        return lista;
    }

    get modoPublicacao() {
        return this.cfg.modo_publicacao === "todos" ? "todos" : "reserva";
    }

    /** Baixa a imagem da matéria (opcional) para reenviar junto da mensagem. */
    async _baixarImagem(url) {
        if (!url) return null;
        try {
            const r = await http.get(url, {
                responseType: "arraybuffer",
                headers: { "User-Agent": "Mozilla/5.0" },
                maxContentLength: 5 * 1024 * 1024,
            });
            const tipo = String(r.headers["content-type"] || "").split(";")[0];
            if (!tipo.startsWith("image/")) return null;
            return MessageMedia.fromBuffer(Buffer.from(r.data), tipo);
        } catch (err) {
            console.log(`   ⚠️  imagem não baixada: ${err.message}`);
            return null;
        }
    }

    /**
     * Publica um item aprovado.
     * Modos (cfg.modo_publicacao):
     *   "reserva" -> publica no primeiro canal que funcionar (os outros ficam de reserva)
     *   "todos"   -> publica em todos os canais da lista
     * @returns {Promise<{ok:boolean, erro?:string, destinos?:string[]}>}
     */
    async publicar(item, texto) {
        const modo = this.modoPublicacao;
        const alvos = this.destinos;
        if (!alvos.length) return { ok: false, erro: "nenhum destino configurado (canal_id)" };

        const opcoes = {};
        if (this.cfg.publicacao?.incluir_imagem && item.imagem) {
            const media = await this._baixarImagem(item.imagem);
            if (media) opcoes.media = media;
        }

        const publicados = [];
        const falhas = [];

        for (const destino of alvos) {
            const r = await this._enviarPara(destino, texto, opcoes);
            if (r.ok) {
                publicados.push(destino);
                if (modo === "reserva") break; // já publicou, os outros ficam de reserva
            } else {
                falhas.push(`${destino}: ${r.erro}`);
            }
        }

        if (publicados.length) {
            console.log(
                `📢 Publicado em ${publicados.length} destino(s): ${publicados.join(", ")}` +
                    (falhas.length ? ` — falhou: ${falhas.join(" | ")}` : "")
            );
            return { ok: true, destinos: publicados };
        }
        console.error("❌ Falha ao publicar em todos os destinos:", falhas.join(" | "));
        return { ok: false, erro: falhas.join(" | ") || "falha desconhecida" };
    }

    /** Envia a mensagem para um destino (canal ou grupo). */
    async _enviarPara(destino, texto, opcoes) {
        try {
            // Caminho 1: chat do canal (o método oficial para newsletters)
            try {
                const chat = await this.client.getChatById(destino);
                if (chat && typeof chat.sendMessage === "function") {
                    await chat.sendMessage(texto, opcoes);
                    return { ok: true };
                }
            } catch (err) {
                console.log(`   ⚠️  getChatById falhou (${err.message}) — tentando sendMessage direto`);
            }

            // Caminho 2: envio direto
            if (opcoes.media) {
                await this.client.sendMessage(destino, opcoes.media, { caption: texto });
            } else {
                await this.client.sendMessage(destino, texto);
            }
            return { ok: true };
        } catch (err) {
            return { ok: false, erro: err.message };
        }
    }

    /** Envia uma mensagem qualquer (usado para falar com você) */
    async enviarPara(numero, texto) {
        const jid = `${String(numero).replace(/\D/g, "")}@c.us`;
        return this.client.sendMessage(jid, texto);
    }
}

module.exports = { Publisher };
