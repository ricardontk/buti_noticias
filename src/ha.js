/**
 * src/ha.js — ponte com o Home Assistant.
 *
 * O add-on roda com `homeassistant: true` no config.yaml, então o Supervisor
 * injeta a variável SUPERVISOR_TOKEN e expõe o Core em http://supervisor/core/api.
 * Com isso o bot:
 *   - avisa o celular quando chega notícia nova (notify.mobile_app_*);
 *   - publica a fila de aprovação em sensor.bot_noticias_pendentes;
 *   - dispara eventos (bot_noticias_*) para automações do HA.
 *
 * Nada disso exige mexer no configuration.yaml do Home Assistant.
 * Se o token não existir (rodando fora do add-on), tudo aqui simplesmente
 * desliga e o bot continua funcionando normal.
 */
const http = require("http");
const https = require("https");
const { URL } = require("url");

class HA {
    constructor(cfg) {
        this.cfg = cfg;
        this.opcoes = cfg.ha || {};
        this.base = String(this.opcoes.url || "http://supervisor/core/api").replace(/\/+$/, "");
        this.token = this.opcoes.token || process.env.SUPERVISOR_TOKEN || "";
        this.dispositivo = String(this.opcoes.dispositivo || "").trim();
        this.dispositivos = [];
        this.conectado = false;
        this.avisoSemDispositivo = false;
        this.avisoFalha = false;
        this.tentouConectar = false;
    }

    get _headers() {
        const h = { "Content-Type": "application/json" };
        if (this.token) h.Authorization = `Bearer ${this.token}`;
        return h;
    }

    /** Requisição JSON no Core do HA (via proxy do Supervisor). */
    _req(method, caminho, corpo) {
        return new Promise((resolve) => {
            let u;
            try {
                u = new URL(this.base + caminho);
            } catch (err) {
                return resolve({ status: 0, erro: err.message });
            }
            const lib = u.protocol === "https:" ? https : http;
            const dados = corpo === undefined ? null : JSON.stringify(corpo);
            const headers = { ...this._headers };
            if (dados) headers["Content-Length"] = Buffer.byteLength(dados);

            const req = lib.request(u, { method, headers }, (res) => {
                let txt = "";
                res.on("data", (c) => (txt += c));
                res.on("end", () => {
                    let json = null;
                    try {
                        json = txt ? JSON.parse(txt) : null;
                    } catch (_) {}
                    resolve({ status: res.statusCode, json, texto: txt });
                });
            });
            req.on("error", (err) => resolve({ status: 0, erro: err.message }));
            req.setTimeout(this.opcoes.timeout_ms || 10000, () => {
                req.destroy();
                resolve({ status: 0, erro: "tempo esgotado" });
            });
            if (dados) req.write(dados);
            req.end();
        });
    }

    /** Testa a conexão e descobre os celulares disponíveis para notificar. */
    async iniciar() {
        if (!this.token) {
            if (!this.avisoFalha) {
                console.log("ℹ️ Home Assistant não configurado (sem SUPERVISOR_TOKEN) — recursos de HA desligados.");
                this.avisoFalha = true;
            }
            this.tentouConectar = true;
            return false;
        }
        const r = await this._req("GET", "/config");
        this.tentouConectar = true;
        if (r.status !== 200) {
            if (!this.avisoFalha) {
                console.warn(`⚠️ Não consegui falar com o Home Assistant (${r.status || r.erro}).`);
                this.avisoFalha = true;
            }
            return false;
        }
        this.conectado = true;
        this.avisoFalha = false;
        const versao = r.json?.version || "?";
        console.log(`🏠 Home Assistant conectado (v${versao}).`);
        await this._detectarDispositivos();
        return true;
    }

    /** Lista os serviços notify.mobile_app_* (um por celular com o app instalado). */
    async _detectarDispositivos() {
        const r = await this._req("GET", "/services");
        if (r.status !== 200 || !Array.isArray(r.json)) return;
        const achados = [];
        for (const grupo of r.json) {
            if (grupo.domain !== "notify") continue;
            for (const nome of Object.keys(grupo.services || {})) {
                if (nome.startsWith("mobile_app_")) achados.push(nome);
            }
        }
        this.dispositivos = achados;
        if (!achados.length) {
            console.log("ℹ️ Nenhum celular com o app do HA encontrado — sem notificações push.");
            return;
        }
        const alvo = this.dispositivo && achados.includes(this.dispositivo)
            ? this.dispositivo
            : achados[0];
        if (this.dispositivo && !achados.includes(this.dispositivo)) {
            console.warn(`⚠️ Dispositivo "${this.dispositivo}" não encontrado. Usando ${alvo}.`);
        }
        this.alvo = alvo;
        console.log(`🔔 Notificações do HA serão enviadas para: ${alvo}`);
    }

    /** Manda uma notificação push para o celular. */
    async notificar(titulo, mensagem) {
        if (!this.conectado) return false;
        const alvo = this.alvo || this.dispositivo;
        if (!alvo) {
            if (!this.avisoSemDispositivo) {
                console.warn("⚠️ Sem serviço de notificação disponível (notify.mobile_app_*).");
                this.avisoSemDispositivo = true;
            }
            return false;
        }
        const r = await this._req("POST", `/services/notify/${alvo}`, {
            title: titulo,
            message: mensagem,
        });
        if (r.status >= 400) {
            console.warn(`⚠️ Falha na notificação do HA (${r.status}): ${r.texto?.slice(0, 120) || r.erro}`);
            return false;
        }
        return true;
    }

    /** Publica o estado do bot numa entidade do HA. */
    async publicarEstado(entityId, estado, atributos = {}) {
        if (!this.conectado) return false;
        const r = await this._req("POST", `/states/${entityId}`, {
            state: String(estado),
            attributes: atributos,
        });
        if (r.status >= 400) {
            console.warn(`⚠️ Falha ao publicar estado no HA (${r.status}): ${r.texto?.slice(0, 120) || r.erro}`);
            return false;
        }
        return true;
    }

    /** Dispara um evento no HA (para automações criadas na interface). */
    async dispararEvento(tipo, dados = {}) {
        if (!this.conectado) return false;
        const r = await this._req("POST", `/events/${tipo}`, { event_data: dados });
        return r.status < 400;
    }
}

module.exports = { HA };
