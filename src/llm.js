/**
 * src/llm.js — reescreve/traduz as manchetes para português do Brasil, com a persona do canal.
 *
 * O LLM faz TRÊS coisas numa tacada só:
 *   1. traduz a manchete internacional para PT-BR;
 *   2. reescreve no tom do canal (influenciador brasileiro do agro, vocabulário de campo);
 *   3. escreve um comentário curto de campo.
 * E devolve sempre o LINK original, intacto.
 *
 * Provedores:
 *   "groq"       → API Groq (free tier, compatível com OpenAI)   [recomendado p/ PT-BR]
 *   "ha_assist"  → Home Assistant (Assist/Ollama rodando dentro do HA)
 *   "ollama"     → Ollama direto
 *   "heuristica" → sem LLM: só limpeza de texto (fallback)
 */
const axios = require("axios");

const PERSONA = `Você é o autor de um canal de WhatsApp sobre drones de pulverização no agro brasileiro.

=== SUA PERSONA ===
Você é um INFLUENCIADOR BRASILEIRO da área de drones agrícolas. Não é veículo de imprensa,
não é assessora de empresa, não escreve em linguagem de comunicado, não abre com
"importante", "revolucionário" ou "o futuro do agro". Você é quem está no campo:
agrônomo e operador de drone de pulverização, que aplica, acompanha lavouras e conversa
com outro produtor de igual para igual.

Como falar:
- Português do Brasil, direto e prático. Frases curtas.
- Trate quem lê como par: "a gente", "nossa lavoura", "no campo", "nossa Firma".
- Use o vocabulário do campo quando couber (nunca forçado):
  pulverização, taxa de aplicação, L/ha, calda, bico, bicos, cone de aplicação, cobertura,
  uniformidade, deposição, deriva, vento, umidade, horário de aplicação, talhão, lavoura,
  planta, cultura, corte, abertura, fechamento, manejo, fitossanitário, fungicida,
  inseticida, herbicida, cobertura, VTOL, compilado, bateria, autonomia, fluxo,
  vazão, aplicação, hectare, XAG P100, XAG P150, DJI Agras T40, DJI Agras T50, Hyzone, EAV,
  ANAC, MAPA.
- Fale do que isso significa NA CHUVA DE QUEM APLICA: o que muda na rotina, no custo,
  no risco de deriva, no tempo de aplicação. Use a sua experiência de campo.
- Opinião e impressão pessoal são bem-vindas, mas sem exagero e sem prometer resultado.
- Nunca invente números, datas, empresas ou citações. Se o original não diz, você não diz.
- Nunca use "é importante notar", "vale ressaltar", "em resumo", "no cenário atual",
  "revolucionário", "game-changer", "disruptivo", "sem precedentes".`;

const PROMPT = `${PERSONA}

=== TAREFA ===
Reescreva cada MANCHETE em UMA frase curta, em português do Brasil, no tom da persona acima.
Se a manchete estiver em inglês, TRADUZA.
Preserve números, marcas (XAG, DJI, Agras, ANAC, MAPA) e o local. Máximo de 110 caracteres.

Para cada notícia, escreva também um COMENTÁRIO de 2 a 3 frases, no tom da persona:
conte o que a notícia significa para quem pulveriza com drone, como quem está no campo
comentando com outro produtor. Se o texto trouxer um TRECHO da matéria, use-o como base
(cause e efeito, números citados, detalhes técnicos). Se não trouxer, comente a partir
da manchete, sem inventar.

O LINK deve ser exatamente o mesmo que eu enviei, sem nenhuma alteração.

=== FORMATO DA RESPOSTA ===
Responda EXATAMENTE assim, uma entrada por notícia, sem texto extra antes ou depois:

1. MANCHELA NO TOM DO CANAL | LINK
   COMENTARIO: 2 ou 3 frases curtas no tom do canal
2. MANCHELA NO TOM DO CANAL | LINK
   COMENTARIO: 2 ou 3 frases curtas no tom do canal

=== ENTRADA ===
%s`;

/** Heurística: limpa o título e corta em 140 chars (usada quando não há LLM). */
function traduzirHeuristica(item) {
    let titulo = String(item.titulo || "")
        .replace(/^["'“”\s]+|["'“”\s]+$/g, "")
        .replace(/\s+[-–—]\s+[^-–—]{2,30}$/, "")
        .replace(/\s+/g, " ")
        .trim();
    if (titulo.length > 140) {
        titulo = `${titulo.slice(0, 137).replace(/\s+\S*$/, "")}...`;
    }
    return { titulo, link: item.link, comentario: "", traduzido: false };
}

function extrairRespostaHA(data) {
    return (
        data?.response?.speech?.plain?.text ||
        data?.response?.speech?.text ||
        data?.response?.text ||
        data?.text ||
        ""
    );
}

function extrairRespostaOllama(data) {
    return data?.response || data?.message?.content || "";
}

function extrairRespostaOpenAI(data) {
    return data?.choices?.[0]?.message?.content || "";
}

/**
 * Interpreta a resposta do LLM: linhas "N. título | link" + linha "COMENTARIO: ...".
 */
function parseResposta(texto, candidatos) {
    const resultado = new Map();
    const linhas = String(texto || "").split(/\r?\n/);
    let atual = null;

    for (const linha of linhas) {
        const m = linha.match(/^\s*(\d+)[.)-]\s*(.+?)\s*\|\s*(\S+)\s*$/);
        if (m) {
            const idx = parseInt(m[1], 10) - 1;
            if (idx < 0 || idx >= candidatos.length) {
                atual = null;
                continue;
            }
            const original = candidatos[idx];
            const titulo = m[2].trim().replace(/^["']|["']$/g, "");
            const link = m[3].trim();
            atual = {
                titulo: titulo || original.titulo,
                link: link && link === original.link ? link : original.link,
                comentario: "",
                traduzido: true,
            };
            resultado.set(idx, atual);
            continue;
        }

        const c = linha.match(/^\s*COMENT[ÁA]RIO\s*:\s*(.+)$/i);
        if (c && atual) {
            atual.comentario = c[1].trim();
        }
    }
    return resultado;
}

class LLM {
    constructor(cfg) {
        this.cfg = cfg.llm || {};
        this.http = axios.create({ timeout: this.cfg.timeout_ms || 60000 });
        this.degradado = false; // vira true se o LLM falhar
        this.ultimoErro = ""; // última mensagem de erro (para mostrar no painel)
    }

    get disponivel() {
        return this.cfg.provedor !== "heuristica" && !this.degradado;
    }

    /**
     * Confere se o modelo configurado existe no provedor.
     * Sem isso, o bot falha em silêncio e publica os títulos em inglês
     * (a heurística não traduz).
     */
    async verificarModelo() {
        if (this.cfg.provedor !== "groq") return true;
        try {
            const headers = {};
            if (this.cfg.groq_api_key) headers.Authorization = `Bearer ${this.cfg.groq_api_key}`;
            const r = await this.http.get(`${this.cfg.groq_url || "https://api.groq.com/openai/v1"}/models`, {
                headers,
            });
            const ids = (r.data?.data || []).map((m) => m.id);
            const atual = this.cfg.groq_modelo;
            if (ids.length && atual && !ids.includes(atual)) {
                this.ultimoErro = `modelo "${atual}" não existe na Groq`;
                console.warn(
                    `⚠️ ${this.ultimoErro}. Modelos disponíveis: ${ids.slice(0, 8).join(", ")}...`
                );
                console.warn("   Troque pela opção groq_modelo do app ou pelo comando 'modelo <id>' no WhatsApp.");
                return false;
            }
            console.log(`✅ Modelo da IA verificado na Groq: ${atual} (${ids.length} disponíveis)`);
            return true;
        } catch (err) {
            this.ultimoErro = `não consegui falar com a Groq (${err.message})`;
            console.warn(`⚠️ ${this.ultimoErro}`);
            return false;
        }
    }

    get modeloAtivo() {
        return (
            this.cfg.groq_modelo ||
            this.cfg.ollama_modelo ||
            this.cfg.modelo ||
            "(padrão do provedor)"
        );
    }

    // ------------------------------------------------------------ Groq ----
    async _chamarGroq(prompt) {
        const headers = { "Content-Type": "application/json" };
        if (this.cfg.groq_api_key) headers.Authorization = `Bearer ${this.cfg.groq_api_key}`;

        const r = await this.http.post(
            `${this.cfg.groq_url || "https://api.groq.com/openai/v1"}/chat/completions`,
            {
                model: this.cfg.groq_modelo || "qwen/qwen3.8-27b",
                messages: [
                    { role: "system", content: "Você escreve para um canal de agro no WhatsApp." },
                    { role: "user", content: prompt },
                ],
                temperature: 0.3,
                max_tokens: 900,
            },
            { headers }
        );
        return extrairRespostaOpenAI(r.data);
    }

    // ------------------------------------------------------ Home Assistant -
    async _chamarHA(prompt) {
        const headers = { "Content-Type": "application/json" };
        if (this.cfg.ha_token) headers.Authorization = `Bearer ${this.cfg.ha_token}`;

        const corpo = { text: prompt };
        if (this.cfg.agent_id) corpo.agent_id = this.cfg.agent_id;

        const r = await this.http.post(this.cfg.ha_url, corpo, { headers });
        return extrairRespostaHA(r.data);
    }

    // ------------------------------------------------------------ Ollama --
    async _chamarOllama(prompt) {
        const r = await this.http.post(this.cfg.ollama_url, {
            model: this.cfg.ollama_modelo,
            prompt,
            stream: false,
            options: { temperature: 0.3, num_predict: 600 },
        });
        return extrairRespostaOllama(r.data);
    }

    async _chamar(prompt) {
        switch (this.cfg.provedor) {
            case "groq":
                return this._chamarGroq(prompt);
            case "ollama":
                return this._chamarOllama(prompt);
            case "ha_assist":
                return this._chamarHA(prompt);
            default:
                throw new Error(`provedor desconhecido: ${this.cfg.provedor}`);
        }
    }

    /**
     * Reescreve/traduz um LOTE de manchetes em UMA chamada.
     * @param {Array} candidatos itens com { titulo, link }
     * @returns {Array} mesmo array, com titulo/link/comentario atualizados
     */
    async reescrever(candidatos) {
        if (!candidatos.length) return candidatos;

        if (!this.disponivel) {
            return candidatos.map((c) => ({ ...c, ...traduzirHeuristica(c) }));
        }

        // Teto de texto por matéria e no total: o free tier da Groq (e o
        // Ollama local) não pode virar uma fatura. 500 caracteres por matéria
        // e 4000 no total ≈ 1,2 mil tokens de entrada.
        const maxPor = this.cfg.max_chars_texto ?? 500;
        const maxTotal = this.cfg.max_chars_total ?? 4000;
        let restante = maxTotal;

        const entrada = candidatos
            .map((c, i) => {
                const bruto = String(c.texto || "").trim();
                if (!bruto) return `${i + 1}. ${c.titulo} | ${c.link}`;
                const trecho = bruto.slice(0, Math.min(maxPor, Math.max(0, restante))).trim();
                restante -= trecho.length;
                return trecho
                    ? `${i + 1}. ${c.titulo} | ${c.link}\n   TRECHO: ${trecho}`
                    : `${i + 1}. ${c.titulo} | ${c.link}`;
            })
            .join("\n");

        try {
            const prompt = PROMPT.replace("%s", entrada);
            const texto = await this._chamar(prompt);

            if (!texto || !texto.trim()) throw new Error("resposta vazia do LLM");

            const casados = parseResposta(texto, candidatos);
            if (!casados.size) throw new Error("não foi possível interpretar a resposta do LLM");

            console.log(`🤖 LLM (${this.cfg.provedor}/${this.modeloAtivo}) reescreveu ${casados.size}/${candidatos.length} título(s)`);
            return candidatos.map((c, i) =>
                casados.has(i) ? { ...c, ...casados.get(i) } : { ...c, ...traduzirHeuristica(c) }
            );
        } catch (err) {
            this.ultimoErro = err.message;
            const mensagem = err.response?.data?.error?.message || err.message;
            const modelo = this.cfg.groq_modelo;
            if (/model|not found|400|404/i.test(mensagem) && this.cfg.provedor === "groq") {
                console.error(
                    `⚠️ LLM falhou (${mensagem}) — usando heurística. ` +
                        `Se a mensagem fala em "model", o modelo "${modelo}" não existe na Groq: ` +
                        `veja a lista no painel (Modelos de texto) ou troque com "modelo <id>" no WhatsApp.`
                );
            } else {
                console.error(`⚠️ LLM falhou (${mensagem}) — usando heurística.`);
            }
            this.ultimoErro = mensagem;
            if (this.cfg.fallback_heuristico !== false) {
                this.degradado = true;
                return candidatos.map((c) => ({ ...c, ...traduzirHeuristica(c) }));
            }
            throw err;
        }
    }

    /**
     * Lista os modelos de TEXTO disponíveis no provedor configurado.
     * @returns {Promise<{provedor:string, ok:boolean, modelos:Array, erro?:string}>}
     */
    async listarModelos() {
        const provedor = this.cfg.provedor;
        try {
            if (provedor === "groq") {
                const headers = {};
                if (this.cfg.groq_api_key) headers.Authorization = `Bearer ${this.cfg.groq_api_key}`;
                const r = await this.http.get(
                    `${this.cfg.groq_url || "https://api.groq.com/openai/v1"}/models`,
                    { headers }
                );
                const modelos = (r.data?.data || []).map((m) => ({
                    id: m.id,
                    contexto: m.context_length || null,
                    criado: m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : null,
                }));
                return { provedor, ok: true, modelos };
            }

            if (provedor === "ollama") {
                const base = String(this.cfg.ollama_url || "").replace(/\/api\/generate.*$/, "");
                const r = await this.http.get(`${base}/api/tags`);
                const modelos = (r.data?.models || []).map((m) => ({
                    id: m.name,
                    tamanho: m.size ? `${(m.size / 1024 / 1024).toFixed(0)} MB` : null,
                    familia: m.details?.family || null,
                }));
                return { provedor, ok: true, modelos };
            }

            if (provedor === "ha_assist") {
                // Home Assistant: lista os agentes de conversa configurados
                const base = String(this.cfg.ha_url || "").replace(/\/api\/conversation\/process.*$/, "");
                const headers = {};
                if (this.cfg.ha_token) headers.Authorization = `Bearer ${this.cfg.ha_token}`;
                const r = await this.http.get(`${base}/api/conversation/agents`, { headers });
                const agentes = r.data || [];
                const modelos = agentes.map((a) => ({
                    id: a.id,
                    nome: a.name,
                    exigeConfig: a.requires_config,
                    linguas: a.supported_languages?.length || null,
                }));
                return { provedor, ok: true, modelos };
            }

            return { provedor, ok: true, modelos: [], erro: "provedor 'heuristica' não tem modelos" };
        } catch (err) {
            return { provedor, ok: false, modelos: [], erro: err.message };
        }
    }

    /** Testa o provedor com uma frase curta (usado pelo comando "modelos" e pelo painel). */
    async testar() {
        const inicio = Date.now();
        const r = await this._chamar("Responda só com: OK");
        return { ok: !!r, ms: Date.now() - inicio, exemplo: String(r || "").slice(0, 200) };
    }
}

module.exports = { LLM, PROMPT, PERSONA, traduzirHeuristica, parseResposta };
