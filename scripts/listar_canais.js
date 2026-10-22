/**
 * scripts/listar_canais.js
 * ---------------------------------------------------------------------------
 * Utilitário para descobrir/verificar o ID do canal do WhatsApp (@newsletter)
 * e testar o envio.
 *
 * O ID do canal ("JID") tem o formato  120363198765432100@newsletter
 * e NÃO é o mesmo que o código de convite do link
 * (https://whatsapp.com/channel/0029VaXXXX). Por isso a forma segura de
 * descobrir o ID é asking ao próprio WhatsApp: o canal aparece na coleção
 * interna de newsletters da conta logada, e aí vem o JID de verdade.
 *
 * Uso:
 *   node scripts/listar_canais.js                        -> lista os canais da conta
 *   node scripts/listar_canais.js resolver <CODIGO> [...] -> resolve invite code -> JID
 *   node scripts/listar_canais.js criar "Nome X"         -> cria um canal e imprime o ID
 *   node scripts/listar_canais.js testar <ID>            -> envia mensagem de teste
 *
 * O comando "resolver" é o atalho para o problema clássico: o link
 * https://whatsapp.com/channel/0029VaXXXX traz um INVITE CODE, que NÃO é o JID
 * usado para publicar (120363...@newsletter). O WhatsApp só revela o JID real
 * para contas logadas — por isso este comando usa a sessão do bot.
 *
 * Variáveis de ambiente:
 *   AUTH_PATH     pasta da sessão do WhatsApp
 *                 (default: ./.wwebjs_auth ; no Docker: /share/bot_noticias/.wwebjs_auth)
 *   CHROMIUM_PATH caminho do executável do Chromium (opcional; em Windows
 *                 normalmente não é necessário, o puppeteer usa o seu)
 * ---------------------------------------------------------------------------
 */

const path = require("path");
const fs = require("fs");
const qrcode = require("qrcode-terminal");
const QRCodeImage = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

const AUTH_PATH = process.env.AUTH_PATH || path.join(__dirname, "..", ".wwebjs_auth");
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || null;
const QR_PATH = process.env.QR_PATH || path.join(__dirname, "..", "qrcode.png");

const [comando, ...resto] = process.argv.slice(2);

// ---------------------------------------------------------------- cliente ---
const puppeteerConfig = {
    args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
    ],
};
if (CHROMIUM_PATH) puppeteerConfig.executablePath = CHROMIUM_PATH;

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
    authTimeoutMs: 120000,
    qrMaxRetries: 5,
    syncFullHistory: false,
    receivePendingNotifications: false,
    puppeteer: puppeteerConfig,
});

// ------------------------------------------------------------------ ações ---
async function listarCanais() {
    const canais = await client.getChannels();

    // A coleção interna só traz os canais em que a conta está INSCRITA. Se a conta for
    // DONA/ADMIN de um canal sem estar inscrita, a coleção vem vazia — nesse caso
    // consultamos os metadados direto pelos JIDs conhecidos.
    if (!canais || canais.length === 0) {
        console.log("\n⚠️  Nenhum canal INSCRITO nesta conta.\n");
        console.log("(Normal quando a conta é dona/admin do canal, mas não se inscreveu.)\n");
        console.log("Você pode consultar os canais diretamente pelos JIDs:\n");
        console.log("   node scripts/listar_canais.js consultar <JID> [<JID> ...]\n");
        console.log("JIDs já resolvidos deste projeto:");
        console.log("   120363198765432100@newsletter  →  Drones de Pulverização");
        console.log("   120363198765432101@newsletter  →  Drone De Pulverização\n");
        return;
    }

    console.log(`\n✅ ${canais.length} canal(is) encontrado(s):\n`);
    for (const c of canais) {
        const jid = c.id?._serialized || c.id?.toString() || "?";
        console.log("─────────────────────────────────────────────");
        console.log(`Nome      : ${c.name}`);
        console.log(`ID (JID)  : ${jid}`);
        console.log(`Descrição: ${c.description || "(sem descrição)"}`);
        if (c.timestamp) {
            console.log(`Criado em : ${new Date(c.timestamp * 1000).toLocaleString("pt-BR")}`);
        }
    }
    console.log("─────────────────────────────────────────────");
    console.log("\nCopie o 'ID (JID)' para o config.json do bot (campo: canal_id)\n");
}

async function resolverCanais() {
    const codigos = resto
        .flatMap((c) => c.split(","))
        .map((c) => c.trim().replace(/^.*\/channel\//, ""))
        .filter(Boolean);

    if (!codigos.length) {
        console.log("Uso: node scripts/listar_canais.js resolver <CODIGO> [<CODIGO> ...]");
        console.log("Ex.: node scripts/listar_canais.js resolver 0029Vb9GuFtEwEjw8LgOfI0i");
        return;
    }

    console.log(`\n🔎 Resolvendo ${codigos.length} invite code(s)...\n`);

    for (const codigo of codigos) {
        try {
            // ATENÇÃO: não usamos window.WWebJS.getChannelMetadata() porque ele depende de
            // WAWebNewsletterModelUtils.getRoleByIdentifier(), que foi removido da versão
            // atual do WhatsApp Web (erro: "getRoleByIdentifier is not a function").
            // Chamamos o job de metadados direto, com o papel GUEST (convidado/visitante).
            const meta = await client.pupPage.evaluate(
                async (code) => {
                    const resp = await window
                        .require("WAWebNewsletterMetadataQueryJob")
                        .queryNewsletterMetadataByInviteCode(code, "GUEST");

                    const pic =
                        resp?.newsletterPictureMetadataMixin?.picture?.[0]
                            ?.queryPictureDirectPathOrEmptyResponseMixinGroup?.value?.directPath;

                    return {
                        id: resp?.idJid,
                        title: resp?.newsletterNameMetadataMixin?.nameElementValue,
                        description:
                            resp?.newsletterDescriptionMetadataMixin
                                ?.descriptionQueryDescriptionResponseMixin?.elementValue,
                        inviteCode: resp?.newsletterInviteLinkMetadataMixin?.inviteCode,
                        subscribers: resp?.newsletterSubscribersMetadataMixin?.subscribersCount,
                        verified: resp?.newsletterVerificationMetadataMixin?.verificationState === "verified",
                        createdAtTs: resp?.newsletterCreationTimeMetadataMixin?.creationTimeValue,
                        pictureUrl: pic ? `https://pps.whatsapp.net${pic}` : null,
                    };
                },
                codigo
            );

            console.log("─────────────────────────────────────────────");
            console.log(`Invite code : ${codigo}`);
            console.log(`Nome        : ${meta?.title || "(sem título)"}`);
            console.log(`ID (JID)    : ${meta?.id || "(não retornado)"}`);
            console.log(`Seguidores  : ${meta?.subscribers ?? "?"}`);
            console.log(`Descrição   : ${meta?.description || "(sem descrição)"}`);
            console.log(`Verificado  : ${meta?.verified ? "sim" : "não"}`);
            if (meta?.createdAtTs) {
                console.log(`Criado em   : ${new Date(meta.createdAtTs * 1000).toLocaleString("pt-BR")}`);
            }
        } catch (err) {
            console.error(`❌ Falha ao resolver ${codigo}: ${err.message}`);
        }
    }
    console.log("─────────────────────────────────────────────");
    console.log("\nCopie o 'ID (JID)' para o config.json do bot (campo: canal_id)\n");
}

async function consultarCanais() {
    const jids = resto.flatMap((c) => c.split(",")).map((c) => c.trim()).filter(Boolean);
    if (!jids.length) {
        console.log("Uso: node scripts/listar_canais.js consultar <JID> [<JID> ...]");
        return;
    }
    for (const jid of jids) {
        try {
            const meta = await client.pupPage.evaluate(
                async (j) => {
                    const r = await window
                        .require("WAWebNewsletterMetadataQueryJob")
                        .queryNewsletterMetadataByJid(j, "GUEST");
                    return {
                        id: r?.idJid,
                        title: r?.newsletterNameMetadataMixin?.nameElementValue,
                        subs: r?.newsletterSubscribersMetadataMixin?.subscribersCount,
                        membership: r?.newsletterMembershipMetadataMixin?.membershipType,
                        description:
                            r?.newsletterDescriptionMetadataMixin
                                ?.descriptionQueryDescriptionResponseMixin?.elementValue,
                    };
                },
                jid
            );
            console.log("─────────────────────────────────────────────");
            console.log(`ID (JID)    : ${meta?.id}`);
            console.log(`Nome        : ${meta?.title}`);
            console.log(`Seguidores  : ${meta?.subs ?? "?"}`);
            console.log(`Papel       : ${meta?.membership || "?"}`);
            console.log(`Descrição   : ${meta?.description || "(sem descrição)"}`);
        } catch (err) {
            console.error(`❌ Falha ao consultar ${jid}: ${err.message}`);
        }
    }
    console.log("─────────────────────────────────────────────\n");
}

async function criarCanal() {
    const titulo = resto.join(" ").trim();
    if (!titulo) {
        console.log('Uso: node scripts/listar_canais.js criar "Nome do Canal"');
        return;
    }

    const resultado = await client.createChannel(titulo, {
        description: "Notícias sobre drones de pulverização — Brasil e mundo.",
    });

    if (typeof resultado === "string") {
        console.log(`\n❌ Não foi possível criar o canal: ${resultado}\n`);
        return;
    }

    console.log("\n✅ Canal criado!\n");
    console.log(`Nome       : ${resultado.title}`);
    console.log(`ID (JID)   : ${resultado.nid?._serialized}`);
    console.log(`Link       : ${resultado.inviteLink}`);
    console.log("\nGuarde o ID (JID) no config.json (campo: canal_id).\n");
}

async function testarCanal() {
    const jid = (resto[0] || "").trim();
    if (!jid) {
        console.log("Uso: node scripts/listar_canais.js testar <ID@newsletter>");
        return;
    }
    const texto =
        resto.slice(1).join(" ") ||
        "✅ Teste de publicação — canal de drones de pulverização funcionando.";

    const chat = await client.getChatById(jid);
    await chat.sendMessage(texto);
    console.log(`\n✅ Mensagem de teste enviada para ${jid}\n`);
}

// ------------------------------------------------------------------ boot ----
client.on("qr", (qr) => {
    console.log("\n📱 Escaneie o QR Code com o WhatsApp do celular:\n");
    qrcode.generate(qr, { small: true });

    // Salva o QR em PNG (o WhatsApp gera um novo a cada ~20s, então o arquivo é sobrescrito)
    QRCodeImage.toFile(QR_PATH, qr, { margin: 2, width: 500 }, (err) => {
        if (!err) console.log(`🖼️  QR salvo em: ${QR_PATH}`);
        else console.error("Erro ao salvar QR:", err.message);
    });
});

client.on("authenticated", () => console.log("🔑 Autenticado. Sincronizando..."));
client.on("disconnected", (r) => console.warn(`🔌 Desconectado: ${r}`));

client.on("ready", async () => {
    console.log("✅ Conectado ao WhatsApp.\n");
    if (fs.existsSync(QR_PATH)) {
        try { fs.unlinkSync(QR_PATH); } catch (_) {}
    }
    try {
        if (comando === "criar") await criarCanal();
        else if (comando === "testar") await testarCanal();
        else if (comando === "resolver") await resolverCanais();
        else if (comando === "consultar") await consultarCanais();
        else await listarCanais();
    } catch (err) {
        console.error("\n❌ Erro:", err.message);
    } finally {
        await client.destroy();
        process.exit(0);
    }
});

(async () => {
    fs.mkdirSync(AUTH_PATH, { recursive: true });
    try {
        await client.initialize();
    } catch (err) {
        console.error("❌ Falha ao inicializar:", err.message);
        process.exit(1);
    }
})();
