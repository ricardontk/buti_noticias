/**
 * src/api.js — API HTTP local + painel web (o "botão" que você aperta no celular).
 *
 * Rotas:
 *   GET  /                 painel
 *   GET  /api/status       estado do bot
 *   GET  /api/qr           QR Code do WhatsApp (para conectar) e estado da sessão
 *   GET  /api/fila         notícias aguardando sua aprovação
 *   POST /api/fila/:id/:acao   publicar|pular um item da fila (painel web)
 *   POST /api/fila/todas   publicar tudo que está na fila
 *   GET  /api/fontes       fontes e último resultado
 *   GET  /api/ultimas      últimas publicações
 *   GET  /api/modelos      modelos de texto disponíveis no provedor de IA
 *   POST /api/modelo       { "id": "qwen/qwen3.8-27b" }  troca o modelo ativo
 *   POST /api/buscar       dispara a varredura ("Buscar notícias agora")
 *   POST /api/mais-lidas   dispara a varredura priorizando popularidade
 *
 * Autenticação: se `painel.token` estiver vazio, o painel é aberto (use só em rede
 * confiável). Se estiver preenchido, é preciso mandar ?token=... ou o header X-Token.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PAINEL_DIR = path.join(__dirname, "..", "painel");

const TIPOS = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
};

class Api {
    constructor({ cfg, acoes }) {
        this.cfg = cfg;
        this.acoes = acoes; // { status, fontes, ultimas, modelos, trocarModelo, buscar, maisLidas, qr }
        this.handler = (req, res) => this._tratar(req, res);
    }

    _criarServidor() {
        return http.createServer(this.handler);
    }

    _autorizado(req, pathname, query) {
        const token = this.cfg.painel?.token;
        if (!token) return true;
        const header = req.headers["x-token"];
        const qs = query.token;
        return header === token || qs === token;
    }

    _json(res, dados, codigo = 200) {
        const corpo = JSON.stringify(dados, null, 2);
        res.writeHead(codigo, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
        });
        res.end(corpo);
    }

    _arquivo(res, nome) {
        const caminho = path.join(PAINEL_DIR, nome);
        if (!fs.existsSync(caminho)) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            return res.end("não encontrado");
        }
        const ext = path.extname(nome).toLowerCase();
        res.writeHead(200, { "Content-Type": TIPOS[ext] || "application/octet-stream" });
        res.end(fs.readFileSync(caminho));
    }

    async _tratar(req, res) {
        const parsed = url.parse(req.url, true);
        const pathname = parsed.pathname;
        const query = parsed.query;

        if (req.method === "OPTIONS") {
            res.writeHead(204, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type,X-Token",
            });
            return res.end();
        }

        if (!this._autorizado(req, pathname, query)) {
            return this._json(res, { erro: "não autorizado" }, 401);
        }

        try {
            if (pathname === "/" || pathname === "/index.html") return this._arquivo(res, "index.html");
            if (pathname === "/painel.js") return this._arquivo(res, "painel.js");
            if (pathname === "/favicon.ico") {
                res.writeHead(204);
                return res.end();
            }

            if (pathname === "/api/status") {
                return this._json(res, await this.acoes.status());
            }
            if (pathname === "/api/qr") {
                return this._json(res, await this.acoes.qr());
            }
            if (pathname === "/api/fila" && req.method === "GET") {
                return this._json(res, await this.acoes.fila());
            }
            if (pathname === "/api/fila/todas" && req.method === "POST") {
                return this._json(res, await this.acoes.publicarTodas());
            }
            const acaoFila = pathname.match(/^\/api\/fila\/([^/]+)\/([^/]+)$/);
            if (acaoFila && req.method === "POST") {
                const id = decodeURIComponent(acaoFila[1]);
                const acao = decodeURIComponent(acaoFila[2]);
                return this._json(res, await this.acoes.agirFila(id, acao));
            }
            if (pathname === "/api/fontes") {
                return this._json(res, await this.acoes.fontes());
            }
            if (pathname === "/api/ultimas") {
                return this._json(res, await this.acoes.ultimas());
            }
            if (pathname === "/api/modelos") {
                return this._json(res, await this.acoes.modelos());
            }
            if (pathname === "/api/modelo" && req.method === "POST") {
                const corpo = await this._corpo(req);
                return this._json(res, await this.acoes.trocarModelo(corpo.id));
            }
            if (pathname === "/api/buscar" && req.method === "POST") {
                this.acoes.buscar("painel");
                return this._json(res, { ok: true, msg: "varredura iniciada" });
            }
            if (pathname === "/api/mais-lidas" && req.method === "POST") {
                this.acoes.buscar("painel-mais-lidas");
                return this._json(res, { ok: true, msg: "varredura por popularidade iniciada" });
            }

            return this._json(res, { erro: "rota não encontrada" }, 404);
        } catch (err) {
            console.error("❌ erro na API:", err);
            return this._json(res, { erro: err.message }, 500);
        }
    }

    _corpo(req) {
        return new Promise((resolve) => {
            let dados = "";
            req.on("data", (c) => {
                dados += c;
                if (dados.length > 1e6) req.destroy();
            });
            req.on("end", () => {
                try {
                    resolve(dados ? JSON.parse(dados) : {});
                } catch (_) {
                    resolve({});
                }
            });
        });
    }

    iniciar() {
        const porta = this.cfg.painel?.porta || 8090;
        const ingress = this.cfg.painel?.porta_ingress || 8090;

        const principal = this._criarServidor();
        principal.on("error", (err) => console.error("❌ erro no servidor do painel:", err.message));
        principal.listen(porta, "0.0.0.0", () => {
            console.log(`🌐 Painel disponível em http://<IP-DO-HA>:${porta}`);
        });

        // O ingress do Home Assistant aponta para uma porta fixa (ingress_port
        // no config.yaml do app). Se a porta do painel for outra, escutamos
        // também na porta do ingress para o painel continuar acessível.
        if (ingress && ingress !== porta) {
            const extra = this._criarServidor();
            extra.on("error", (err) => {
                console.warn(
                    `⚠️ não consegui abrir a porta ${ingress} (${err.message}) — o ingress do HA pode não funcionar.`
                );
            });
            extra.listen(ingress, "0.0.0.0", () => {
                console.log(`🌐 Ingress do Home Assistant na porta ${ingress}`);
            });
        }
    }
}

module.exports = { Api };
