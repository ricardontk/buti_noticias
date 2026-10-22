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
        const c = this.client;

        c.on("qr", (qr) => {
            this.qrAtual = qr;
            this.conectado = false;
            console.log("\n📱 Escaneie o QR Code com o WhatsApp do celular:");
            console.log("   (também disponível no painel web do bot)");
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
