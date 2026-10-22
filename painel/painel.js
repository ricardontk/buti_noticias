/* painel.js — painel web do Bot de Notícias (o "botão" no celular). */
(function () {
  "use strict";

  const token = new URLSearchParams(location.search).get("token") || "";
  const api = (caminho, opcoes) =>
    fetch(caminho + (token ? (caminho.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token) : ""), opcoes);

  const $ = (id) => document.getElementById(id);
  const toast = (msg) => {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove("on"), 3500);
  };

  function dt(iso) {
    if (!iso) return "nunca";
    const d = new Date(iso);
    return isNaN(d) ? "nunca" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  async function carregarStatus() {
    try {
      const r = await api("/api/status");
      const s = await r.json();
      $("stPronto").textContent = s.pronto ? "🟢 pronto" : "🟡 iniciando";
      $("stIA").textContent = s.ia ? `${s.ia.provedor} / ${s.ia.modelo}` : "—";
      if (s.ia && s.ia.degradado) $("stIA").textContent += " (degradado)";
      $("stVarredura").textContent = dt(s.ultima_varredura);
      $("stPublicacao").textContent = dt(s.ultima_publicacao);
      $("stFila").textContent = s.fila || 0;
      $("stStats").textContent = `${s.stats?.publicadas || 0} / ${s.stats?.puladas || 0}`;
    } catch (e) {
      $("stPronto").textContent = "🔴 sem conexão";
    }
  }

  async function carregarModelos() {
    const box = $("listaModelos");
    box.textContent = "Carregando…";
    try {
      const r = await api("/api/modelos");
      const d = await r.json();
      if (!d.ok) {
        box.innerHTML = `<span style="color:#e8a3a3">⚠️ ${d.erro || "erro"}</span>`;
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
          return `<li><span class="tag">${d.provedor}</span><code>${m.id}</code>${extras ? `<div class="mut">${extras}</div>` : ""}</li>`;
        })
        .join("");
    } catch (e) {
      box.textContent = "erro ao carregar";
    }
  }

  async function carregarUltimas() {
    try {
      const r = await api("/api/ultimas");
      const d = await r.json();
      const ul = $("listaUltimas");
      if (!d.ultimas || !d.ultimas.length) {
        ul.innerHTML = '<li class="mut">Nada publicado ainda.</li>';
        return;
      }
      ul.innerHTML = d.ultimas
        .map(
          (p) => `<li>
            <span class="tag ${p.regiao === "BR" ? "br" : "mundo"}">${p.regiao === "BR" ? "BR" : "Mundo"}</span>
            <b>${p.titulo}</b>
            <div class="mut">${p.fonte} · ${dt(p.data)}</div>
            <a href="${p.link}" target="_blank" rel="noopener">abrir notícia</a>
          </li>`
        )
        .join("");
    } catch (e) {
      /* silencioso */
    }
  }

  async function carregarFontes() {
    try {
      const r = await api("/api/fontes");
      const d = await r.json();
      const ul = $("listaFontes");
      ul.innerHTML = (d.fontes || [])
        .map((f) => `<li><b>${f.nome}</b><div class="mut">${f.regiao} · <a href="${f.url}" target="_blank" rel="noopener">feed</a></div></li>`)
        .join("");
    } catch (e) {
      /* silencioso */
    }
  }

  async function disparar(rota, rotulo) {
    const b = rota === "/api/buscar" ? $("btnBuscar") : $("btnMaisLidas");
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
      }, 2500);
    }
  }

  $("btnBuscar").addEventListener("click", () => disparar("/api/buscar", "Busca"));
  $("btnMaisLidas").addEventListener("click", () => disparar("/api/mais-lidas", "Mais lidas"));
  $("btnModelos").addEventListener("click", carregarModelos);

  carregarStatus();
  carregarModelos();
  carregarUltimas();
  carregarFontes();
  setInterval(carregarStatus, 15000);
})();
