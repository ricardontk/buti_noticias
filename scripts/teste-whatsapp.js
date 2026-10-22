/**
 * scripts/teste-whatsapp.js — testa a recuperação automática do WhatsApp.
 *
 * O whatsapp-web.js roda dentro da página do WhatsApp Web. Quando a página
 * recarrega, o script injetado (window.WWebJS) some e o envio quebra com
 * "Cannot read properties of undefined (reading 'getChat')".
 *
 * O bot precisa se recuperar sozinho: reiniciar a sessão e tentar de novo.
 *
 * Uso: node scripts/teste-whatsapp.js
 */
const path = require("path");

const { WhatsAppClient } = require(path.join(__dirname, "..", "src", "client.js"));

function checar(nome, condicao, detalhe = "") {
    console.log(`${condicao ? "✅" : "❌"} ${nome}${detalhe ? " — " + detalhe : ""}`);
    return condicao;
}

const cfg = {
    caminhos: { auth: "./.wwebjs_auth", estado: "./state.json" },
    chromium: "",
};

(async () => {
    const wa = new WhatsAppClient(cfg);

    // 1) falha de injeção: reinicia e tenta de novo
    let chamadas = 0;
    let reiniciou = false;
    wa.client = {
        async sendMessage() {
            chamadas += 1;
            if (chamadas === 1) {
                throw new Error("Cannot read properties of undefined (reading 'getChat')");
            }
            return "enviado";
        },
    };
    wa.reiniciar = async function () {
        reiniciou = true;
        this.client = {
            async sendMessage() {
                chamadas += 1;
                return "enviado";
            },
        };
    };

    let resultado = null;
    let erro = null;
    try {
        resultado = await wa.enviarMensagem("5511999999999@c.us", "olá");
    } catch (e) {
        erro = e;
    }
    checar("falha de injeção é reconhecida", !erro, erro?.message);
    checar("sessão foi reiniciada", reiniciou === true);
    checar("envio refeito depois do restart", resultado === "enviado" && chamadas === 2, `${chamadas} chamada(s)`);

    // 2) erro normal (não é injeção): não reinicia, propaga o erro
    reiniciou = false;
    wa.client = {
        async sendMessage() {
            throw new Error("Chat não encontrado");
        },
    };
    wa.reiniciar = async function () {
        reiniciou = true;
    };
    erro = null;
    try {
        await wa.enviarMensagem("5511999999999@c.us", "olá");
    } catch (e) {
        erro = e;
    }
    checar("erro comum é propagado", erro?.message === "Chat não encontrado", erro?.message);
    checar("erro comum não reinicia a sessão", reiniciou === false);

    // 3) freio: dois reinícios seguidos não podem acontecer (evita loop no RPi4)
    const comFreio = new WhatsAppClient({ ...cfg, intervalo_reinicio_ms: 60000 });
    let tentativas = 0;
    comFreio.client = {
        async sendMessage() {
            tentativas += 1;
            throw new Error("Cannot read properties of undefined (reading 'getChat')");
        },
    };
    comFreio.reiniciar = async function () {
        const agora = Date.now();
        const desde = agora - (this.ultimoReinicio || 0);
        if (desde < this.intervaloReinicioMs) {
            throw new Error("reinício recente — não vou reiniciar de novo agora");
        }
        this.ultimoReinicio = agora;
        this.client = {
            async sendMessage() {
                return "enviado";
            },
        };
    };
    await comFreio.enviarMensagem("5511999999999@c.us", "olá");
    comFreio.client = {
        async sendMessage() {
            throw new Error("Cannot read properties of undefined (reading 'getChat')");
        },
    };
    erro = null;
    try {
        await comFreio.enviarMensagem("5511999999999@c.us", "olá");
    } catch (e) {
        erro = e;
    }
    checar("segundo reinício é barrado pelo freio", !!erro, erro?.message?.slice(0, 50));

    // 4) depois de N falhas: pede QR novo (descarta a sessão salva)
    const semFreio = new WhatsAppClient({ ...cfg, intervalo_reinicio_ms: 0, max_falhas_injecao: 3 });
    let forcado = false;
    let reinicios = 0;
    semFreio.client = {
        async sendMessage() {
            throw new Error("Cannot read properties of undefined (reading 'getChat')");
        },
    };
    semFreio.reiniciar = async function (forcarQR) {
        reinicios += 1;
        if (forcarQR) {
            forcado = true;
            return;
        }
        this.client = {
            async sendMessage() {
                throw new Error("Cannot read properties of undefined (reading 'getChat')");
            },
        };
    };
    for (let i = 0; i < 3; i += 1) {
        try {
            await semFreio.enviarMensagem("5511999999999@c.us", "olá");
        } catch (_) {
            /* esperado */
        }
    }
    checar("após 3 falhas pede QR novo", forcado === true, `${reinicios} reinício(s)`);

    console.log("\nTudo certo.");
    process.exit(0);
})();
