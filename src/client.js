/**
 * src/client.js — conexão com o WhatsApp.
 *
 * Mesma arquitetura do bot do XAG (whatsapp-web.js + Puppeteer + LocalAuth), com:
 *   - sessão persistente no volume `share`
 *   - retry com backoff no client.initialize()
 *   - guarda de unhandledRejection
 *   - resolução de @lid -> número puro
 */
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");
const QRCodeImage = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

process.on("unhandledRejection", (reason) => {
    console.error("⚠️ [UNHANDLED REJECTION] Promise rejeitada sem tratamento:", reason);
});

class WhatsAppClient {
    constructor(cfg) {
        this.cfg = cfg;
        this.lidCache = {};
        this.lidCacheFile = path.join(path.dirname(cfg.caminhos.estado), "lid_cache.json");
        this.qrAtual = null; // último QR Code recebido (para mostrar no painel web)
        this.conectado = false;
        this.ultimoReinicio = 0; // quando foi o último reinício da sessão
        this.intervaloReinicioMs = cfg.intervalo_reinicio_ms ?? 60000; // freio anti-loop
        this.falhasConsecutivas = 0; // falhas de injeção em sequência
        this.maxFalhas = cfg.max_falhas_injecao ?? 3; // depois disso: QR novo
        this.pedindoQR = false; // já estou pedindo um QR novo?
        this._carregarLidCache();

        const puppeteerConfig = {
            protocolTimeout: 300000,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--disable-ipc-flooding-protection",
                "--disable-extensions",
                "--no-first-run",
                "--no-zygote",
                "--js-flags=--max-old-space-size=512",
            ],
        };
        if (cfg.chromium) puppeteerConfig.executablePath = cfg.chromium;
        this.puppeteerConfig = puppeteerConfig;

        this.client = new Client({
            authStrategy: new LocalAuth({ dataPath: cfg.caminhos.auth }),
            authTimeoutMs: 120000,
            qrMaxRetries: 5,
            syncFullHistory: false,
            receivePendingNotifications: false,
            puppeteer: puppeteerConfig,
        });
    }

    _carregarLidCache() {
        try {
            if (fs.existsSync(this.lidCacheFile)) {
                this.lidCache = JSON.parse(fs.readFileSync(this.lidCacheFile, "utf-8")) || {};
            }
        } catch (err) {
            console.error("⚠️ cache de lid inválido:", err.message);
        }
    }

    _salvarLidCache() {
        try {
            fs.writeFileSync(this.lidCacheFile, JSON.stringify(this.lidCache, null, 2));
        } catch (err) {
            console.error("⚠️ falha ao salvar cache de lid:", err.message);
        }
    }

    /** Resolve @lid -> número puro (mesma lógica do xag_bot). */
    async resolverNumero(rawFrom) {
        if (!rawFrom || !rawFrom.endsWith("@lid")) return String(rawFrom || "").replace(/\D/g, "");
        if (this.lidCache[rawFrom]) return this.lidCache[rawFrom];

        try {
            if (typeof this.client.getContactLidAndPhone === "function") {
                const results = await this.client.getContactLidAndPhone([rawFrom]);
                const match = Array.isArray(results) ? results[0] : null;
                const pn = match?.pn ? match.pn.replace(/\D/g, "") : null;
                if (pn) {
                    this.lidCache[rawFrom] = pn;
                    this._salvarLidCache();
                    return pn;
                }
            }
        } catch (err) {
            console.error(`⚠️ erro ao resolver lid ${rawFrom}:`, err.message);
        }
        return String(rawFrom).replace(/\D/g, "");
    }

    /** Registra os listeners. `handlers` = { onMessage(msg, numero), onReady() } */
    registrar(handlers) {
        this.handlers = handlers || {};
        const c = this.client;

        c.on("qr", (qr) => {
            this.qrAtual = qr;
            this.conectado = false;
            console.log("\n📱 QR Code novo — escaneie com o WhatsApp do celular:");
            console.log("   (WhatsApp → Aparelhos conectados → Conectar com número de telefone → Conectar usando este código)");
            console.log("   Também aparece no painel web do bot.");
            qrcode.generate(qr, { small: true });
            const destino = path.join(path.dirname(this.cfg.caminhos.estado), "qrcode.png");
            QRCodeImage.toFile(destino, qr, { margin: 2, width: 500 }, (err) => {
                if (!err) console.log(`🖼️  QR salvo em: ${destino}`);
            });
        });

        c.on("authenticated", () => {
            this.qrAtual = null;
            console.log("🔑 [SESSÃO] Autenticado. Sincronizando...");
        });
        c.on("change_state", (s) => console.log(`🔄 [ESTADO] ${s}`));
        c.on("disconnected", (r) => {
            this.conectado = false;
            console.warn(`🔌 [DESCONECTADO] ${r}`);
            // LOGOUT = o WhatsApp encerrou/desconectou este dispositivo.
            // Não adianta reiniciar: a credencial salva não vale mais, então
            // pedimos um QR Code novo para você escanear.
            if (this._ehLogout(r)) {
                console.warn("🔑 Sessão encerrada pelo WhatsApp — vou pedir um QR Code novo.");
                this._pedirNovoQR();
            }
        });
        c.on("auth_failure", (m) => console.error("❌ [FALHA SESSÃO]", m));

        c.on("ready", async () => {
            this.conectado = true;
            this.qrAtual = null;
            console.log("✅ [PRONTO] Conectado ao WhatsApp.");
            const destino = path.join(path.dirname(this.cfg.caminhos.estado), "qrcode.png");
            if (fs.existsSync(destino)) {
                try { fs.unlinkSync(destino); } catch (_) {}
            }
            if (handlers.onReady) await handlers.onReady();
        });

        c.on("message", async (msg) => {
            try {
                if (msg.fromMe) return; // ignoramos o que nós mesmos escrevemos

                // Conversa consigo mesmo: quando o bot roda no SEU número, tudo que você
                // manda chega pelo chat "Eu" e o remetente vem como @lid do próprio
                // conta — que o WhatsApp não resolve via getContactLidAndPhone.
                // Nesse caso, o remetente somos nós (o dono do bot).
                const ownJid = c.info?.wid?._serialized || "";
                const isSelfChat = !!(msg.to && msg.to === msg.from);

                let numero;
                if (isSelfChat) {
                    numero = ownJid.replace(/\D/g, "");
                } else {
                    numero = await this.resolverNumero(msg.from);
                }

                if (handlers.onMessage) await handlers.onMessage(msg, numero, { isSelfChat });
            } catch (err) {
                console.error("⚠️ erro no handler de mensagem:", err);
            }
        });
    }

    /**
     * O whatsapp-web.js roda dentro da página do WhatsApp Web e usa
     * `window.WWebJS.getChat(...)`. Quando o WhatsApp recarrega a página, o
     * script injetado some e qualquer envio quebra com
     * "Cannot read properties of undefined (reading 'getChat')".
     *
     * Nesses casos reiniciamos a sessão e tentamos de novo.
     */
    _ehErroDeInjecao(err) {
        const msg = String(err?.message || err || "");
        return /WWebJS|getChat|Cannot read properties of undefined|detached Frame|detached frame/i.test(
            msg
        );
    }

    /** O WhatsApp encerrou a sessão (logout/conflict/desconexão definitiva)? */
    _ehLogout(motivo) {
        const m = String(motivo || "").toUpperCase();
        return /LOGOUT|CONFLICT|UNPAIRED|UNLINKED|REVOKED/.test(m);
    }

    /** Descarta a credencial salva e espera um QR Code novo. */
    async _pedirNovoQR() {
        if (this.pedindoQR) return;
        this.pedindoQR = true;
        try {
            // dá um tempo para a biblioteca assentar (a página está navegando)
            await new Promise((r) => setTimeout(r, 5000));
            await this.reiniciar(true);
        } catch (err) {
            console.error(`❌ Não consegui pedir o QR novo: ${err.message}`);
        } finally {
            this.pedindoQR = false;
        }
    }

    /** Recria o cliente do WhatsApp (mantém a sessão salva no volume). */
    async reiniciar(forcarNovoQR = false) {
        // Freio: não pode ficar reiniciando em loop (consome CPU/RAM do RPi4).
        const agora = Date.now();
        const desdeUltimo = agora - (this.ultimoReinicio || 0);
        if (!forcarNovoQR && desdeUltimo < this.intervaloReinicioMs) {
            throw new Error(
                `reinício recente (há ${Math.round(desdeUltimo / 1000)}s) — não vou reiniciar de novo agora`
            );
        }
        this.ultimoReinicio = agora;
        console.log(
            forcarNovoQR
                ? "🔑 Sessão salva descartada — vou pedir um QR Code novo."
                : "🔄 Sessão do WhatsApp sem script injetado — reiniciando..."
        );
        try {
            await this.client.destroy();
        } catch (_) {}

        if (forcarNovoQR) {
            // apaga a credencial salva: o WhatsApp vai pedir QR de novo
            try {
                const pasta = this.cfg.caminhos.auth;
                for (const arquivo of fs.readdirSync(pasta)) {
                    fs.rmSync(path.join(pasta, arquivo), { recursive: true, force: true });
                }
                console.log("🗑️  Credenciais antigas apagadas.");
            } catch (err) {
                console.warn(`⚠️ Não consegui apagar a sessão salva: ${err.message}`);
            }
            this.qrAtual = null;
            this.conectado = false;
        }

        this.client = new Client({
            authStrategy: new LocalAuth({ dataPath: this.cfg.caminhos.auth }),
            authTimeoutMs: 120000,
            qrMaxRetries: 5,
            syncFullHistory: false,
            receivePendingNotifications: false,
            puppeteer: this.puppeteerConfig,
        });
        this.registrar(this.handlers || {});
        //aguarda a sessão ficar pronta de verdade (não basta a página abrir)
        await new Promise((resolve, reject) => {
            const limite = setTimeout(
                () => reject(new Error("tempo esgotado esperando o WhatsApp conectar")),
                120000
            );
            this.client.once("ready", () => {
                clearTimeout(limite);
                resolve();
            });
            this.client.initialize().catch((err) => {
                clearTimeout(limite);
                reject(err);
            });
        });
        this.conectado = true;
        console.log("✅ Sessão do WhatsApp reiniciada.");
    }

    /**
     * Envia uma mensagem, se recovering de uma falha de injeção.
     * @param {string} jid ex.: 5511999999999@c.us
     */
    async enviarMensagem(jid, texto, opcoes) {
        try {
            const r = await this.client.sendMessage(jid, texto, opcoes);
            this.falhasConsecutivas = 0;
            return r;
        } catch (err) {
            if (!this._ehErroDeInjecao(err)) throw err;
            this.falhasConsecutivas += 1;
            console.warn(
                `⚠️ Falha de injeção no WhatsApp (${err.message}) — tentativa ${this.falhasConsecutivas}/${this.maxFalhas}.`
            );
            console.warn(
                "   💡 A aba do WhatsApp Web se desanexou (recarregou ou caiu). Se isso repetir muito, veja a memória do HA."
            );

            // Depois de várias falhas, a sessão salva está corrompida:
            // descarta e pede um QR Code novo.
            if (this.falhasConsecutivas >= this.maxFalhas) {
                this.falhasConsecutivas = 0;
                await this.reiniciar(true);
                throw new Error("sessão reiniciada com QR novo — conclua a conexão no painel");
            }

            try {
                await this.reiniciar();
            } catch (falha) {
                console.error(`❌ Não consegui reiniciar a sessão: ${falha.message}`);
                throw err;
            }
            const r = await this.client.sendMessage(jid, texto, opcoes);
            this.falhasConsecutivas = 0;
            return r;
        }
    }

    /** QR Code atual em PNG (data URL) para mostrar no painel web; null se já conectado. */
    async qrDataUrl() {
        if (!this.qrAtual) return null;
        try {
            return await QRCodeImage.toDataURL(this.qrAtual, { margin: 1, width: 360 });
        } catch (err) {
            console.error("⚠️ não consegui gerar a imagem do QR:", err.message);
            return null;
        }
    }

    /** Inicia com retry e backoff (não derruba o processo). */
    async iniciar() {
        let tentativa = 0;
        const tentar = async () => {
            tentativa += 1;
            console.log(`🚀 [INÍCIO] Conectando ao WhatsApp (tentativa ${tentativa})...`);
            try {
                await this.client.initialize();
            } catch (err) {
                console.error(`❌ Falha ao inicializar: ${err.message}`);
                const espera = Math.min(10000 * tentativa, 60000);
                setTimeout(tentar, espera);
            }
        };
        await tentar();
    }
}

module.exports = { WhatsAppClient };
