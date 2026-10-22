/**
 * src/state.js — persistência em JSON (sobrevive a restart do add-on).
 *
 * Guarda:
 *   - fila de aprovação pendente
 *   - histórico do que já foi publicado (dedupe)
 *   - perfil de relevância (termos que você aprovou / rejeitou)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ESTADO_VAZIO = {
    version: 1,
    queue: [],        // candidatos aguardando sua aprovação
    publicados: [],   // histórico (últimos 500)
    vistos: {},       // hash do link -> timestamp (dedupe)
    profile: { aprovado: {}, rejeitado: {} },
    lastScan: null,
    lastPublish: null,
    stats: { varreduras: 0, publicadas: 0, puladas: 0 },
};

class State {
    constructor(file) {
        this.file = file;
        this.data = this._load();
        this._timer = null;
    }

    _load() {
        try {
            if (fs.existsSync(this.file)) {
                const raw = fs.readFileSync(this.file, "utf-8").trim();
                if (raw) {
                    const data = JSON.parse(raw);
                    return deepMerge(ESTADO_VAZIO, data);
                }
            }
        } catch (err) {
            console.error("⚠️ state.json inválido, recriando:", err.message);
            try {
                fs.writeFileSync(this.file + ".bak", fs.readFileSync(this.file, "utf-8"));
            } catch (_) {}
        }
        return JSON.parse(JSON.stringify(ESTADO_VAZIO));
    }

    /** Grava com debounce (evita escrever a cada item) */
    save() {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.saveNow(), 300);
    }

    saveNow() {
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
        } catch (err) {
            console.error("⚠️ falha ao salvar state.json:", err.message);
        }
    }

    // ------------------------------------------------------------- dedupe ---
    static hash(texto) {
        return crypto.createHash("sha1").update(String(texto || "")).digest("hex").slice(0, 16);
    }

    jaViu(link) {
        return !!this.data.vistos[State.hash(link)];
    }

    marcarVisto(link) {
        this.data.vistos[State.hash(link)] = Date.now();
        // poda: mantém só os últimos 2000 itens vistos
        const chaves = Object.keys(this.data.vistos);
        if (chaves.length > 2000) {
            const ordenadas = chaves.sort((a, b) => this.data.vistos[a] - this.data.vistos[b]);
            ordenadas.slice(0, ordenadas.length - 2000).forEach((c) => delete this.data.vistos[c]);
        }
    }

    // --------------------------------------------------------------- fila ---
    get fila() {
        return this.data.queue;
    }

    proximo() {
        return this.data.queue.find((i) => i.status === "aguardando");
    }

    adicionarItem(item) {
        this.data.queue.push(item);
        this.save();
    }

    limparFila() {
        this.data.queue = [];
        this.save();
    }

    // ------------------------------------------------------ histórico ------
    registrarPublicada(item) {
        this.data.publicados.unshift({
            titulo: item.titulo,
            link: item.link,
            fonte: item.fonte,
            regiao: item.regiao,
            data: new Date().toISOString(),
        });
        if (this.data.publicados.length > 500) this.data.publicados.length = 500;
        this.data.stats.publicadas += 1;
        this.data.lastPublish = new Date().toISOString();
        this.marcarVisto(item.link);
        if (item.linkOriginal) this.marcarVisto(item.linkOriginal);
        this.save();
    }

    registrarPulada(item) {
        this.data.stats.puladas += 1;
        this.marcarVisto(item.link);
        if (item.linkOriginal) this.marcarVisto(item.linkOriginal);
        this.save();
    }

    // ---------------------------------------------------------- perfil ------
    /** Aprende com a sua resposta: "1 gostei" pesa +, "2 não gostei" pesa - */
    aprender(item, aprovado) {
        const alvo = aprovado ? this.data.profile.aprovado : this.data.profile.rejeitado;
        const texto = `${item.titulo} ${item.resumo || ""}`.toLowerCase();
        const stop = new Set([
            "de", "da", "do", "em", "no", "na", "os", "as", "um", "uma", "para", "com",
            "por", "que", "the", "a", "an", "of", "in", "on", "for", "to", "and", "with",
            "drone", "drones", "notícia", "noticia",
        ]);
        const palavras = texto.match(/[a-zà-ÿ0-9]{4,}/gi) || [];
        for (const p of palavras) {
            const k = p.toLowerCase();
            if (stop.has(k)) continue;
            alvo[k] = (alvo[k] || 0) + 1;
        }
        this.save();
    }

    /** Peso de um termo segundo o que você já aprovou/rejeitou */
    pesoTermo(palavra) {
        const a = this.data.profile.aprovado[palavra] || 0;
        const r = this.data.profile.rejeitado[palavra] || 0;
        return a * 0.5 - r * 1.0;
    }
}

function deepMerge(base, over) {
    if (!over || typeof over !== "object" || Array.isArray(over)) return over === undefined ? base : over;
    const out = Array.isArray(base) ? [...base] : { ...base };
    for (const [k, v] of Object.entries(over)) {
        out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge(base?.[k] ?? {}, v) : v;
    }
    return out;
}

module.exports = { State, ESTADO_VAZIO };
