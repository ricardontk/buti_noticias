/**
 * src/publisher.js — publica a notícia aprovada no canal do WhatsApp.
 *
 * Destinos:
 *   - canal   (newsletter): 120363...@newsletter
 *   - grupo   (fallback):   123-456@g.us
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
     * @returns {Promise<{ok:boolean, erro?:string}>}
     */
    async publicar(item, texto) {
        const destino = this.destino;
        if (!destino) return { ok: false, erro: "nenhum destino configurado (canal_id)" };

        const opcoes = {};
        if (this.cfg.publicacao?.incluir_imagem && item.imagem) {
            const media = await this._baixarImagem(item.imagem);
            if (media) opcoes.media = media;
        }

        try {
            // Caminho 1: chat do canal (o método oficial para newsletters)
            try {
                const chat = await this.client.getChatById(destino);
                if (chat && typeof chat.sendMessage === "function") {
                    await chat.sendMessage(texto, opcoes);
                    console.log(`📢 Publicado no destino ${destino}`);
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
            console.log(`📢 Publicado no destino ${destino}`);
            return { ok: true };
        } catch (err) {
            console.error(`❌ Falha ao publicar:`, err.message);
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
