/* painel.js — painel web do Bot de Notícias (o "botão" no celular). */
(function () {
  "use strict";

  const CHAVE_TOKEN = "bot_noticias_token";

  /*
   * Base das URLs da API.
   *
   * Aberto direto (http://IP:8090/) a base é "".
   * Dentro do Home Assistant (ingress) a página vem de
   * /api/hassio_ingress/<token> — os caminhos absolutos (/api/status)
   * escapingariam o ingress e cairiam na API do Home Assistant, não no bot.
   * Então derivamos a base do próprio endereço da página.
   */
  const BASE = (function () {
    const m = location.pathname.match(/^(.*\/api\/hassio_ingress\/[^/]+)/);
    return m ? m[1] : "";
  })();

  const tokenDaUrl = new URLSearchParams(location.search).get("token") || "";
  let token = tokenDaUrl || localStorage.getItem(CHAVE_TOKEN) || "";

  const $ = (id) => document.getElementById(id);

  /** Liga um evento só se o elemento existir (HTML e JS podem estar defasados). */
  function ligar(id, evento, fn) {
    const el = $(id);
    if (el) el.addEventListener(evento, fn);
  }

  /** Chamada na API: manda o token e, se der 401, pede a senha. */
  async function api(caminho, opcoes) {
    const sep = caminho.includes("?") ? "&" : "?";
    const url = BASE + caminho + (token ? sep + "token=" + encodeURIComponent(token) : "");
    const r = await fetch(url, opcoes);
    if (r.status === 401) {
      pedirSenha();
      throw new Error("nao autorizado");
    }
    return r;
  }

  function pedirSenha() {
    const card = $("cardSenha");
    if (card) card.style.display = "block";
    const st = $("stPronto");
    if (st) st.textContent = "🔴 senha do painel";
  }

  function guardarToken(valor) {
    localStorage.setItem(CHAVE_TOKEN, valor);
    location.reload();
  }

  const toast = (msg) => {
    const t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove("on"), 3500);
  };

  function dt(iso) {
    if (!iso) return "nunca";
    const d = new Date(iso);
    return isNaN(d)
      ? "nunca"
      : d.toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
  }

  function esc(texto) {
    return String(texto == null ? "" : texto).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }

  async function carregarStatus() {
    try {
      const r = await api("/api/status");
      const s = await r.json();
      const set = (id, valor) => {
        const el = $(id);
        if (el) el.textContent = valor;
      };
      set("stPronto", s.pronto ? "🟢 pronto" : "🟡 iniciando");
      set("stWhats", s.whatsapp?.conectado ? "🟢 conectado" : "🟡 aguardando QR");
      set("stIA", s.ia ? `${s.ia.provedor} / ${s.ia.modelo}` : "—");
      if (s.ia && s.ia.degradado) set("stIA", `${s.ia.provedor} / ${s.ia.modelo} (degradado)`);
      const canais = s.canais || (s.canal_id ? [s.canal_id] : []);
      set("stCanais", canais.length ? `${canais.length} · ${canais[0]}` : "—");
      set("stVarredura", dt(s.ultima_varredura));
      set("stPublicacao", dt(s.ultima_publicacao));
      set("stFila", s.fila || 0);
      set("stStats", `${s.stats?.publicadas || 0} / ${s.stats?.puladas || 0}`);
      const card = $("cardSenha");
      if (card) card.style.display = "none";
    } catch (e) {
      const st = $("stPronto");
      if (st && e.message !== "nao autorizado") st.textContent = "🔴 sem conexão";
    }
  }

  async function carregarModelos() {
    const box = $("listaModelos");
    if (!box) return;
    box.textContent = "Carregando…";
    try {
      const r = await api("/api/modelos");
      const d = await r.json();
      if (d.ok === false) {
        box.innerHTML = `<span style="color:#e8a3a3">⚠️ ${esc(d.erro || "erro")}</span>`;
        return;
      }
      if (!d.modelos || !d.modelos.length) {
        box.textContent = "(nenhum modelo encontrado)";
        return;
      }
      box.innerHTML = d.modelos
        .map((m) => {
          const extras = [m.contexto ? `${Math.round(m.contexto / 1000)}k ctx` : null, m.tamanho, m.nome]
            .filter(Boolean)
            .join(" · ");
          return `<li><span class="tag">${esc(d.provedor)}</span><code>${esc(m.id)}</code>${
            extras ? `<div class="mut">${esc(extras)}</div>` : ""
          }</li>`;
        })
        .join("");
    } catch (e) {
      box.textContent = e.message === "nao autorizado" ? "" : "erro ao carregar";
    }
  }

  async function carregarUltimas() {
    const ul = $("listaUltimas");
    if (!ul) return;
    try {
      const r = await api("/api/ultimas");
      const d = await r.json();
      if (!d.ultimas || !d.ultimas.length) {
        ul.innerHTML = '<li class="mut">Nada publicado ainda.</li>';
        return;
      }
      ul.innerHTML = d.ultimas
        .map(
          (p) => `<li>
            <span class="tag ${p.regiao === "BR" ? "br" : "mundo"}">${p.regiao === "BR" ? "BR" : "Mundo"}</span>
            <b>${esc(p.titulo)}</b>
            <div class="mut">${esc(p.fonte)} · ${dt(p.data)}</div>
            <a href="${esc(p.link)}" target="_blank" rel="noopener">abrir notícia</a>
          </li>`
        )
        .join("");
    } catch (e) {
      /* silencioso */
    }
  }

  async function carregarFontes() {
    const ul = $("listaFontes");
    if (!ul) return;
    try {
      const r = await api("/api/fontes");
      const d = await r.json();
      ul.innerHTML = (d.fontes || [])
        .map(
          (f) =>
            `<li><b>${esc(f.nome)}</b><div class="mut">${esc(f.regiao)} · <a href="${esc(f.url)}" target="_blank" rel="noopener">feed</a></div></li>`
        )
        .join("");
    } catch (e) {
      /* silencioso */
    }
  }

  async function carregarQR() {
    const card = $("cardQR");
    const box = $("qrBox");
    if (!card || !box) return;
    try {
      const r = await api("/api/qr");
      const d = await r.json();
      if (d.conectado || !d.qr) {
        card.style.display = "none";
        return;
      }
      card.style.display = "block";
      box.innerHTML = `<img src="${d.qr}" alt="QR Code do WhatsApp" />`;
    } catch (e) {
      /* silencioso */
    }
  }

  async function carregarFila() {
    const card = $("cardFila");
    const box = $("filaItens");
    if (!card || !box) return;
    try {
      const r = await api("/api/fila");
      const d = await r.json();
      const itens = d.itens || [];
      if (!itens.length) {
        card.style.display = "none";
        return;
      }
      card.style.display = "block";
      box.innerHTML = itens
        .map(
          (it) => `<div class="item" data-id="${esc(it.id || it.ordem)}">
            <b>${esc(it.titulo)}</b>
            ${it.resumo ? `<div class="resumo">${esc(it.resumo)}</div>` : ""}
            <div class="mut" style="font-size:12px">
              <span class="tag ${it.regiao === "BR" ? "br" : "mundo"}">${it.regiao === "BR" ? "BR" : "Mundo"}</span>
              ${esc(it.fonte || "")} · ${dt(it.data)}
              ${it.link ? ` · <a href="${esc(it.link)}" target="_blank" rel="noopener">abrir</a>` : ""}
            </div>
            <div class="acoes" style="margin-top:10px">
              <button class="pub" data-acao="publicar">✅ Publicar</button>
              <button class="pul" data-acao="pular">⏭️ Pular</button>
            </div>
          </div>`
        )
        .join("");
    } catch (e) {
      /* silencioso */
    }
  }

  async function agirNaFila(id, acao, botao) {
    const html = botao.innerHTML;
    botao.disabled = true;
    botao.innerHTML = '<span class="spin"></span>';
    try {
      const r = await api(`/api/fila/${encodeURIComponent(id)}/${encodeURIComponent(acao)}`, {
        method: "POST",
      });
      const d = await r.json();
      toast(d.ok === false ? d.erro || "não deu certo" : acao === "publicar" ? "✅ Publicada no canal." : "⏭️ Item pulado.");
    } catch (e) {
      toast("Falha ao agir na fila.");
    } finally {
      botao.innerHTML = html;
      botao.disabled = false;
      carregarFila();
      carregarStatus();
    }
  }

  async function publicarTodas() {
    const b = $("btnTodas");
    if (!b) return;
    const html = b.innerHTML;
    b.disabled = true;
    b.innerHTML = '<span class="spin"></span> Publicando…';
    try {
      const r = await api("/api/fila/todas", { method: "POST" });
      const d = await r.json();
      toast(`${d.publicadas || 0} notícia(s) publicada(s).`);
    } catch (e) {
      toast("Falha ao publicar.");
    } finally {
      b.innerHTML = html;
      b.disabled = false;
      carregarFila();
      carregarStatus();
    }
  }

  async function disparar(rota, rotulo) {
    const b = rota === "/api/buscar" ? $("btnBuscar") : $("btnMaisLidas");
    if (!b) return;
    const html = b.innerHTML;
    b.disabled = true;
    b.innerHTML = '<span class="spin"></span> Buscando…';
    try {
      await api(rota, { method: "POST" });
      toast(`${rotulo}: varredura iniciada. A aprovação chega no seu WhatsApp.`);
    } catch (e) {
      toast("Falha ao disparar a varredura.");
    } finally {
      setTimeout(() => {
        b.disabled = false;
        b.innerHTML = html;
        carregarStatus();
        carregarFila();
      }, 2500);
    }
  }

  // ------------------------------------------------------------- eventos ---
  ligar("btnBuscar", "click", () => disparar("/api/buscar", "Busca"));
  ligar("btnMaisLidas", "click", () => disparar("/api/mais-lidas", "Mais lidas"));
  ligar("btnModelos", "click", carregarModelos);
  ligar("btnQR", "click", carregarQR);
  ligar("btnTodas", "click", publicarTodas);

  ligar("btnSenha", "click", () => {
    const campo = $("inputSenha");
    const valor = campo ? campo.value.trim() : "";
    if (!valor) {
      toast("Digite a senha.");
      return;
    }
    guardarToken(valor);
  });

  ligar("inputSenha", "keydown", (ev) => {
    if (ev.key === "Enter") {
      const b = $("btnSenha");
      if (b) b.click();
    }
  });

  const lista = $("filaItens");
  if (lista) {
    lista.addEventListener("click", (ev) => {
      const botao = ev.target.closest("button[data-acao]");
      if (!botao) return;
      const item = botao.closest(".item");
      if (!item) return;
      agirNaFila(item.dataset.id, botao.dataset.acao, botao);
    });
  }

  // -------------------------------------------------------------- início ---
  carregarStatus();
  carregarModelos();
  carregarUltimas();
  carregarFontes();
  carregarQR();
  carregarFila();
  setInterval(carregarStatus, 15000);
  setInterval(carregarQR, 10000);
  setInterval(carregarFila, 10000);
})();
