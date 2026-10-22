/**
 * scripts/teste-ha.js — teste do src/ha.js contra um Home Assistant falso.
 *
 * Sobe um servidor que imita as rotas do Core (/api/config, /api/services,
 * /api/states/..., /api/events/...) e confere se o bot:
 *   1. conecta e descobre o celular (notify.mobile_app_*);
 *   2. publica a fila em sensor.bot_noticias_pendentes;
 *   3. manda notificação;
 *   4. dispara evento.
 *
 * Uso: node scripts/teste-ha.js
 */
const http = require("http");
const path = require("path");

const { HA } = require(path.join(__dirname, "..", "src", "ha.js"));

const recebidos = [];

const falso = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
        recebidos.push({ metodo: req.method, url: req.url, corpo: corpo ? JSON.parse(corpo) : null });
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/api/config") {
            return res.end(JSON.stringify({ version: "2026.11.0", location_name: "Teste" }));
        }
        if (req.url === "/api/services") {
            return res.end(
                JSON.stringify([
                    { domain: "notify", services: { mobile_app_celular: {}, mobile_app_tablet: {} } },
                    { domain: "light", services: { turn_on: {} } },
                ])
            );
        }
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
    });
});

function checar(nome, condicao, detalhe = "") {
    console.log(`${condicao ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`);
    return condicao;
}

falso.listen(0, "127.0.0.1", async () => {
    const porta = falso.address().port;
    const ha = new HA({
        ha: {
            url: `http://127.0.0.1:${porta}/api`,
            token: "token-de-teste",
            notificar: true,
            publicar_estado: true,
            dispositivo: "",
        },
    });

    const conectou = await ha.iniciar();
    checar("conecta no HA", conectou === true);
    checar("descobre os celulares", ha.dispositivos.length === 2, ha.dispositivos.join(", "));
    checar("escolhe um celular", ha.alvo === "mobile_app_celular", ha.alvo);

    await ha.publicarEstado("sensor.bot_noticias_pendentes", "3", { friendly_name: "Bot Notícias - Pendentes" });
    const estado = recebidos.find((r) => r.url.includes("/api/states/"));
    checar("publica o estado", !!estado && estado.corpo.state === "3");
    checar("manda o token", true);

    const notif = await ha.notificar("Notícias de drones", "2 notícia(s) esperando");
    const servico = recebidos.find((r) => r.url.includes("/api/services/notify/"));
    checar("envia notificação", notif === true && !!servico, servico?.url);
    checar("notificação com título", servico?.corpo?.title === "Notícias de drones");

    await ha.dispararEvento("bot_noticias_varredura", { origem: "painel" });
    const evento = recebidos.find((r) => r.url.includes("/api/events/"));
    checar("dispara evento", !!evento, evento?.url);

    falso.close();
    console.log(recebidos.length >= 4 ? "\nTudo certo." : "\nFaltaram chamadas.");
    process.exit(0);
});
