/**
 * scripts/probe.js — diagnóstico: descobre como resolver invite code -> JID
 * na versão atual do WhatsApp Web (usando a sessão já logada).
 */
const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");

const AUTH_PATH = process.env.AUTH_PATH || path.join(__dirname, "..", ".wwebjs_auth");
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || null;
const CODES = process.argv.slice(2);

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
    console.log("✅ conectado");

    for (const code of CODES) {
        const out = await client.pupPage.evaluate(async (inviteCode) => {
            const res = { code: inviteCode };
            const req = window.require;

            // 1) Quais módulos de newsletter existem agora?
            try {
                const mods = Object.keys(window.WWebJS).filter((k) => /newsletter|channel/i.test(k));
                res.wwebjsKeys = mods;
            } catch (e) { res.wwebjsKeysErr = e.message; }

            // 2) Conteúdo dos módulos internos
            for (const m of [
                "WAWebNewsletterModelUtils",
                "WAWebNewsletterMetadataQueryJob",
                "WAWebNewsletterCollection",
                "WAWebLoadNewsletterPreviewChatAction",
            ]) {
                try {
                    const mod = req(m);
                    res[m] = Object.keys(mod).slice(0, 40);
                } catch (e) {
                    res[m] = "ERRO: " + e.message;
                }
            }

            // 3) Tenta a query de metadados com vários papéis
            res.tentativas = [];
            for (const role of ["GUEST", "MEMBER", "ADMIN", "OWNER", undefined]) {
                try {
                    const resp = await req("WAWebNewsletterMetadataQueryJob")
                        .queryNewsletterMetadataByInviteCode(inviteCode, role);
                    res.tentativas.push({
                        role,
                        ok: true,
                        idJid: resp?.idJid,
                        title: resp?.newsletterNameMetadataMixin?.nameElementValue,
                        invite: resp?.newsletterInviteLinkMetadataMixin?.inviteCode,
                        subs: resp?.newsletterSubscribersMetadataMixin?.subscribersCount,
                        chaves: Object.keys(resp || {}).slice(0, 25),
                    });
                } catch (e) {
                    res.tentativas.push({ role, ok: false, err: e.message });
                }
            }

            // 4) Funções de papel disponíveis
            try {
                const mu = req("WAWebNewsletterModelUtils");
                res.roleFns = Object.keys(mu).filter((k) => /role|invite|identifier/i.test(k));
            } catch (e) { /* ignore */ }

            return res;
        }, code);

        console.log(`\n===== ${code} =====`);
        console.log(JSON.stringify(out, null, 2).slice(0, 4000));
    }

    await client.destroy();
    process.exit(0);
});

(async () => {
    try { await client.initialize(); } catch (e) { console.error("ERR", e.message); process.exit(1); }
})();
