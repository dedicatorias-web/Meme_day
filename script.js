"use strict";

/* =============================================================================
   Meme Day — script.js (v7)
   Metas:
   - Buscar notícia via RSS (com proxies e timeouts curtos)
   - Se o feed for Google News, extrair o link original do <description>
   - Ler texto legível via r.jina.ai (sem CORS) e gerar resumo inteligente
   - Atualizar UI (título, fonte, data/hora, resumo) e imagem (carregamento 1x)
   - Modo DEMO automático quando tudo falhar
   - Logs detalhados em cada etapa para facilitar diagnóstico
   Sem Service Worker.
   ========================================================================== */


/* =============================================================================
   [PARTE 0] BANNER / DIAGNÓSTICO INICIAL
   ========================================================================== */
console.log("%c[MemeDay] 🚀 Iniciando app v7", "background:#222;color:#0ff;padding:2px 6px;border-radius:3px");
console.log("[MemeDay] Ambiente:", {
  href: location.href,
  userAgent: navigator.userAgent,
  startedAt: new Date().toISOString()
});


/* =============================================================================
   [PARTE 1] CONFIGURAÇÃO
   ========================================================================== */
const CONFIG = {
  // Forçar modo demo via ?mode=demo
  mode: new URLSearchParams(location.search).get("mode") || "auto",

  // Fontes RSS (ordem de prioridade)
  fontes: [
    { nome: "Google News BR", url: "https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419", tipo: "rss", tipoEspecial: "google-news" },
    { nome: "G1",             url: "https://g1.globo.com/rss/g1/",                                   tipo: "rss" },
    { nome: "BBC Brasil",     url: "https://www.bbc.com/portuguese/brasil/rss.xml",                 tipo: "rss" }
  ],

  // Proxies para contornar CORS (tentados em ordem)
  proxies: [
    { name: "AllOrigins (raw)", url: (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}` },
    { name: "corsproxy.io",     url: (target) => `https://corsproxy.io/?${encodeURIComponent(target)}` }
    // Se tiver um proxy próprio estável, adicione aqui.
  ],

  // Timeouts por operação (ms)
  timeouts: {
    proxyFetch: 2500,     // por tentativa de proxy
    readableFetch: 5000,  // r.jina.ai
    imageLoad: 6000       // carregar imagem (cada candidato)
  },

  // Imagens
  imagem: {
    largura: 1280,
    altura: 720,
    placeholder: `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1280 720'>
         <defs>
           <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
             <stop offset='0%' stop-color='#FF6B6B'/>
             <stop offset='100%' stop-color='#4ECDC4'/>
           </linearGradient>
         </defs>
         <rect fill='url(#g)' width='1280' height='720'/>
         <text x='50%' y='48%' text-anchor='middle' fill='white' font-family='Arial, sans-serif' font-size='48'>Meme Day</text>
         <text x='50%' y='58%' text-anchor='middle' fill='white' font-family='Arial, sans-serif' font-size='20'>Imagem temporária</text>
       </svg>`
    )}`
  },

  // Fallback demo quando tudo falha
  demoNoticias: [
    {
      titulo: "Brasil amplia capacidade de energia solar em 2025",
      resumo: "Relatório indica expansão recorde da matriz solar, com novos parques fotovoltaicos e redução no custo da energia limpa.",
      fonte: "Meme Day (Demo)",
      link: "https://www.google.com/search?q=energia+solar+brasil"
    },
    {
      titulo: "Aplicações de IA impulsionam produtividade em empresas",
      resumo: "Organizações brasileiras adotam soluções de IA para automatizar processos e melhorar a tomada de decisão.",
      fonte: "Meme Day (Demo)",
      link: "https://www.google.com/search?q=ia+produtividade+brasil"
    }
  ]
};


/* =============================================================================
   [PARTE 2] LOGGER (logs padronizados)
   ========================================================================== */
const Log = {
  group(label, fn) {
    console.groupCollapsed(`%c[MemeDay] ${label}`, "color:#0bf");
    try { fn(); } finally { console.groupEnd(); }
  },
  info(...args)  { console.info("[MemeDay]", ...args); },
  warn(...args)  { console.warn("[MemeDay]", ...args); },
  error(...args) { console.error("[MemeDay]", ...args); }
};


/* =============================================================================
   [PARTE 3] UTILITÁRIOS (tempo, texto, resumo, keywords)
   ========================================================================== */
const Utils = {
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

  nowBR() {
    return new Date().toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
  },

  cleanHTML(html) {
    if (!html) return "";
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  },

  summarize(text, maxSentences = 3) {
    if (!text) return "Resumo indisponível no momento.";
    const MAX_CHARS = 6000;
    text = Utils.cleanHTML(text).slice(0, MAX_CHARS);
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 25);

    if (sentences.length <= maxSentences) {
      return sentences.join(" ");
    }

    const stopwords = new Set([
      "de","da","do","em","para","com","que","um","uma","uns","umas","os","as","e","o","a","no","na","nos","nas",
      "por","se","ao","aos","dos","das","é","foi","são","ser","tem","há","como","mais","menos","já","também",
      "entre","sobre","até","após","antes","durante","ou","sua","seu","suas","seus","contra","pelo","pela"
    ]);

    const norm = (w) => w.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const freq = Object.create(null);

    for (const s of sentences) {
      for (const w of s.split(/\W+/)) {
        const t = norm(w);
        if (!t || stopwords.has(t)) continue;
        freq[t] = (freq[t] || 0) + 1;
      }
    }

    const scored = sentences.map((s, idx) => {
      let score = 0;
      for (const w of s.split(/\W+/)) {
        const t = norm(w);
        if (freq[t]) score += freq[t];
      }
      const len = s.split(" ").length;
      const brevityBonus = (len >= 8 && len <= 30) ? 0.5 : 0;
      return { s, idx, score: score + brevityBonus };
    });

    const top = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSentences)
      .sort((a, b) => a.idx - b.idx)
      .map(o => o.s.trim());

    const out = top.join(" ").trim();
    return /[.!?]$/.test(out) ? out : out + ".";
  },

  // Gera até 5 keywords curtas do título para usar na busca de imagem
  titleKeywords(titulo) {
    if (!titulo) return ["news", "brazil"];
    const base = titulo
      .normalize("NFD").replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(x => x.length >= 3 && !["the","and","for","com","uma","para","que","com","dos","das","nos","nas","das","uma","uma","uma"].includes(x));
    const uniq = [...new Set(base)];
    const top = uniq.slice(0, 5);
    if (top.length === 0) top.push("news","brazil");
    return top;
  }
};


/* =============================================================================
   [PARTE 4] UI (DOM, estados, preenchimento)
   ========================================================================== */
const UI = (() => {
  const els = {
    titulo:      document.querySelector('[data-element="titulo"]'),
    resumo:      document.querySelector('[data-element="resumo"]'),
    fonte:       document.querySelector('[data-element="fonte"]'),
    linkFonte:   document.querySelector('[data-element="link-fonte"]'),
    dataHora:    document.querySelector('[data-element="data-hora"]'),
    imagem:      document.querySelector('[data-element="imagem"]'),
    carregando:  document.querySelector('[data-element="carregando"]'),
    erro:        document.querySelector('[data-element="erro"]'),
    card:        document.getElementById('noticia-principal') || null
  };

  let imageSet = false;

  function status(msg) {
    if (els.carregando) els.carregando.textContent = String(msg);
    Log.info("STATUS:", msg);
  }

  function showLoading(show) {
    if (els.carregando) els.carregando.style.display = show ? "block" : "none";
  }

  function showError(msg) {
    if (els.erro) {
      els.erro.textContent = String(msg);
      els.erro.style.display = "block";
    }
    Log.error("ERRO:", msg);
  }

  function hideError() {
    if (els.erro) els.erro.style.display = "none";
  }

  function fillBasicInfo({ titulo, fonte, link }) {
    if (els.titulo) els.titulo.textContent = titulo || "Notícia do dia";
    if (els.fonte) els.fonte.textContent = fonte || "Fonte desconhecida";
    if (els.linkFonte && link) {
      els.linkFonte.href = link;
      els.linkFonte.title = "Abrir notícia original";
      els.linkFonte.target = "_blank";
      els.linkFonte.rel = "noopener noreferrer";
    }
    if (els.dataHora) els.dataHora.textContent = Utils.nowBR();
    if (els.card) els.card.style.display = "block";
  }

  function fillResumo(texto) {
    if (els.resumo) els.resumo.textContent = texto || "Resumo indisponível.";
  }

  async function setImageOnce(urls, alt) {
    // urls: array de candidatos em ordem de preferência
    if (imageSet || !els.imagem) return;
    imageSet = true;

    els.imagem.setAttribute("aria-busy", "true");
    els.imagem.style.opacity = "0.85";
    els.imagem.alt = alt || "Imagem da notícia";

    for (const url of urls) {
      const ok = await tryLoad(els.imagem, url, CONFIG.timeouts.imageLoad);
      if (ok) {
        Log.info("Imagem aplicada com sucesso:", url);
        els.imagem.style.opacity = "1";
        els.imagem.removeAttribute("aria-busy");
        return;
      } else {
        Log.warn("Falha ao carregar candidato de imagem, tentando próximo:", url);
      }
    }

    // Se nenhum candidato funcionou, usa placeholder
    Log.warn("Nenhuma imagem carregou. Usando placeholder.");
    els.imagem.src = CONFIG.imagem.placeholder;
    els.imagem.style.opacity = "1";
    els.imagem.removeAttribute("aria-busy");
  }

  function tryLoad(imgEl, url, timeoutMs) {
    return new Promise(resolve => {
      const img = new Image();
      let done = false;

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        img.onload = img.onerror = null;
        resolve(false);
      }, timeoutMs);

      img.onload = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        imgEl.src = url;
        resolve(true);
      };
      img.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(false);
      };
      img.src = url;
    });
  }

  return { status, showLoading, showError, hideError, fillBasicInfo, fillResumo, setImageOnce };
})();


/* =============================================================================
   [PARTE 5] REDE (fetch via proxies, parsing de XML, r.jina.ai)
   ========================================================================== */
const Net = {
  async fetchText(url, timeoutMs) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(t);
    }
  },

  async fetchViaProxies(url) {
    const errors = [];
    for (const proxy of CONFIG.proxies) {
      try {
        Log.info(`Tentando proxy: ${proxy.name} →`, proxy.url(url));
        const text = await this.fetchText(proxy.url(url), CONFIG.timeouts.proxyFetch);
        Log.info("Proxy OK:", proxy.name, `(bytes: ${text.length})`);
        return text;
      } catch (err) {
