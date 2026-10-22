/**
 * scripts/status.js — mostra a conta logada, os canais da conta e o papel
 * (GUEST/ADMIN/OWNER) que ela tem em cada canal informado.
 */
const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");

const AUTH_PATH = process.env.AUTH_PATH || path.join(__dirname, "..", ".wwebjs_auth");
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || null;
const JIDS = process.argv.slice(2);

const puppeteerConfig = { args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] };
if (CHROMIUM_PATH) puppeteerConfig.executablePath = CHROMIUM_PATH;

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
    authTimeoutMs: 120000,
    qrMaxRetries: 5,
    syncFullHistory: false,
    puppeteer: puppeteerConfig,
});

client.on("ready", async () => {
    console.log("📱 Conta logada:", client.info?.wid?._serialized);
    console.log("   Nome          :", client.info?.pushname, "\n");

    const canais = await client.getChannels();
    console.log(`📺 Canais na coleção desta conta: ${canais.length}`);
    for (const c of canais) {
        console.log(`   - ${c.id?._serialized}  ${c.name}`);
    }
    console.log("");

    for (const jid of JIDS) {
        try {
            const resp = await client.pupPage.evaluate(async (j) => {
                const r = await window
                    .require("WAWebNewsletterMetadataQueryJob")
                    .queryNewsletterMetadataByJid(j, "GUEST");
                return {
                    id: r?.idJid,
                    title: r?.newsletterNameMetadataMixin?.nameElementValue,
                    subs: r?.newsletterSubscribersMetadataMixin?.subscribersCount,
                    membership: r?.newsletterMembershipMetadataMixin,
                };
            }, jid);
            console.log(`🔎 ${jid}`);
            console.log(`   Nome      : ${resp.title}`);
            console.log(`   Seguidores: ${resp.subs}`);
            console.log(`   Membership: ${JSON.stringify(resp.membership)}`);
        } catch (e) {
            console.log(`🔎 ${jid} -> ERRO: ${e.message}`);
        }
    }

    await client.destroy();
    process.exit(0);
});

(async () => {
    try { await client.initialize(); } catch (e) { console.error("ERR", e.message); process.exit(1); }
})();
