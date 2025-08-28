"use strict";

/* ============================================================================
   Meme Day - script.js (v6)
   Objetivo: Buscar uma notícia popular via RSS (com proxies), resumir, exibir
   fonte, data/hora e gerar uma imagem de capa. Sem Service Worker.
   - Forte em logs e comentários
   - Estruturado em módulos (seções) claramente marcados
   - Modo Demo automático quando a rede/proxies falham
   ============================================================================ */


/* =============================================================================
   [PARTE 0] BANNER / DIAGNÓSTICO INICIAL
   ========================================================================== */
console.log("%c[MemeDay] 🚀 Iniciando app v6", "background:#222;color:#0ff;padding:2px 6px;border-radius:3px");
console.log("[MemeDay] Ambiente:", {
  url: location.href,
  userAgent: navigator.userAgent,
  time: new Date().toISOString()
});


/* =============================================================================
   [PARTE 1] CONFIGURAÇÃO
   ========================================================================== */
const CONFIG = {
  // Modo pode ser "auto" (padrão) ou "demo" (forçado por ?mode=demo)
  mode: new URLSearchParams(location.search).get("mode") || "auto",

  // Fontes de RSS (ordem de prioridade)
  fontes: [
    { nome: "Google News BR", url: "https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419", tipo: "rss" },
    { nome: "G1",            url: "https://g1.globo.com/rss/g1/",                                   tipo: "rss" },
    { nome: "BBC Brasil",    url: "https://www.bbc.com/portuguese/brasil/rss.xml",                 tipo: "rss" }
  ],

  // Proxies para contornar CORS (tentados em ordem; tempos curtos para não travar UI)
  // Observação: proxies externos podem ser instáveis; mantemos timeouts agressivos.
  proxies: [
    { name: "AllOrigins (raw)", url: (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}` },
    { name: "corsproxy.io",     url: (target) => `https://corsproxy.io/?${encodeURIComponent(target)}` }
    // Dica: se você tiver um proxy seu, adicione aqui.
  ],

  // Tempo limite por tentativa de fetch (ms)
  timeouts: {
    proxyFetch: 2500,  // por proxy
    readableFetch: 4000, // r.jina.ai
    imageHead: 3000
  },

  // Imagem
  imagem: {
    largura: 1280,
    altura: 720,
    // Placeholder inline (SVG simples)
    placeholder: `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1280 720'>
         <defs>
           <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
             <stop offset='0%' stop-color='#FF6B6B'/>
             <stop offset='100%' stop-color='#4ECDC4'/>
           </linearGradient>
         </defs>
         <rect fill='url(#g)' width='1280' height='720'/>
         <text x='50%' y='50%' text-anchor='middle' fill='white' font-family='Arial, sans-serif' font-size='48'>Meme Day</text>
         <text x='50%' y='58%' text-anchor='middle' fill='white' font-family='Arial, sans-serif' font-size='20'>Imagem temporária</text>
       </svg>`
    )}`
  },

  // Fallback (modo demo) caso nada funcione
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
   [PARTE 2] LOGGER (utilitário de logs bonitos e padronizados)
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
   [PARTE 3] UTILITÁRIOS GERAIS (tempo, limpeza de texto, resumo, etc.)
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

  // Resumo por ranqueamento de frases (freq. de palavras)
  summarize(text, maxSentences = 3) {
    if (!text) return "Resumo indisponível no momento.";
    const MAX_CHARS = 6000; // limita processamento
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
      const brevityBonus = (len >= 8 && len <= 30) ? 0.5 : 0; // preferência por frases objetivas
      return { s, idx, score: score + brevityBonus };
    });

    const top = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSentences)
      .sort((a, b) => a.idx - b.idx)
      .map(o => o.s.trim());

    const out = top.join(" ").trim();
    return /[.!?]$/.test(out) ? out : out + ".";
  }
};


/* =============================================================================
   [PARTE 4] UI (manipulação do DOM, estados de carregamento/erro, imagem)
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
    if (els.carregando) {
      els.carregando.textContent = String(msg);
    }
    Log.info("STATUS:", msg);
  }

  function showLoading(show) {
    if (els.carregando) {
      els.carregando.style.display = show ? "block" : "none";
    }
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
      els.linkFonte.title = `Abrir notícia original`;
      els.linkFonte.target = "_blank";
      els.linkFonte.rel = "noopener noreferrer";
    }
    if (els.dataHora) els.dataHora.textContent = Utils.nowBR();
    if (els.card) els.card.style.display = "block";
  }

  function fillResumo(texto) {
    if (els.resumo) els.resumo.textContent = texto || "Resumo indisponível.";
  }

  async function setImageOnce(url, alt) {
    if (imageSet || !els.imagem) return;
    imageSet = true;
    try {
      await ImageService.loadInto(els.imagem, url, alt);
    } catch (err) {
      Log.warn("Falha ao carregar imagem principal, usando placeholder:", err);
      els.imagem.src = CONFIG.imagem.placeholder;
      els.imagem.alt = "Imagem padrão do Meme Day";
    }
  }

  return { status, showLoading, showError, hideError, fillBasicInfo, fillResumo, setImageOnce };
})();


/* =============================================================================
   [PARTE 5] REDE (fetch com proxies, timeout, parsing de XML)
   ========================================================================== */
const Net = {
  async fetchText(url, timeoutMs) {
    // Fetch simples com timeout
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
    // Tenta proxies em sequência com timeouts curtos
    const errors = [];
    for (const proxy of CONFIG.proxies) {
      try {
        UI.status(`Conectando via proxy: ${proxy.name}...`);
        Log.info("Tentando proxy:", proxy.name, proxy.url(url));
        const text = await this.fetchText(proxy.url(url), CONFIG.timeouts.proxyFetch);
        Log.info("Proxy OK:", proxy.name, `(tamanho: ${text.length} chars)`);
        return text;
      } catch (err) {
        errors.push({ proxy: proxy.name, err: String(err) });
        const msg = String(err);
        if (msg.includes("ECH") || msg.includes("NETWORK") || msg.includes("Failed to fetch")) {
          Log.warn(`Proxy ${proxy.name} falhou (rede/TLS):`, msg);
        } else {
          Log.warn(`Proxy ${proxy.name} falhou:`, msg);
        }
      }
    }
    Log.error("Todos os proxies falharam:", errors);
    throw new Error("Todos os proxies falharam");
  },

  parseXML(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) {
      throw new Error("XML inválido");
    }
    return doc;
  },

  // r.jina.ai transforma páginas em texto legível (CORS liberado)
  async fetchReadablePage(originalUrl) {
    // Constrói URL do r.jina.ai
    const u = new URL(originalUrl);
    const jina = `https://r.jina.ai/http://${u.host}${u.pathname}${u.search}`;
    UI.status("Obtendo conteúdo legível (r.jina.ai)...");
    Log.info("Fetch legível via r.jina.ai:", jina);
    try {
      return await this.fetchText(jina, CONFIG.timeouts.readableFetch);
    } catch (err) {
      Log.warn("r.jina.ai falhou:", String(err));
      return ""; // não interrompe pipeline
    }
  }
};


/* =============================================================================
   [PARTE 6] FONTES / BUSCA DE NOTÍCIAS (RSS → item top)
   ========================================================================== */
const Sources = {
  async getTopNews() {
    // Tenta cada fonte em sequência (logs claros por fonte)
    for (const fonte of CONFIG.fontes) {
      UI.status(`Buscando feed: ${fonte.nome}...`);
      Log.group(`Feed: ${fonte.nome}`, () => {});
      try {
        const xmlText = await Net.fetchViaProxies(fonte.url);
        const doc = Net.parseXML(xmlText);

        // Suporte a RSS e Atom
        const item = doc.querySelector("item") || doc.querySelector("entry");
        if (!item) {
          Log.warn(`Nenhum item encontrado no feed: ${fonte.nome}`);
          continue;
        }

        const titulo = item.querySelector("title")?.textContent?.trim() || "Notícia";
        const link =
          // Atom <link href="...">
          item.querySelector("link[href]")?.getAttribute("href")?.trim()
          // RSS <link>texto</link>
          || item.querySelector("link")?.textContent?.trim()
          || "";

        if (!/^https?:\/\//i.test(link)) {
          Log.warn("Link inválido no item do feed. Ignorando.", { titulo, link });
          continue;
        }

        Log.info("Top item:", { fonte: fonte.nome, titulo, link });
        return { titulo, link, fonte: fonte.nome };
      } catch (err) {
        Log.warn(`Falha no feed ${fonte.nome}:`, String(err));
        // Continua para próxima fonte
      }
    }
    // Se nada deu certo, retorna null (o app fará fallback demo)
    return null;
  }
};


/* =============================================================================
   [PARTE 7] ARTIGO / RESUMO (puxa texto da página e resume)
   ========================================================================== */
const Article = {
  async buildSummary(link) {
    // 1) Tenta via r.jina.ai (texto legível)
    const readable = await Net.fetchReadablePage(link);
    if (readable && readable.length > 120) {
      Log.info("Conteúdo legível obtido via r.jina.ai (tamanho):", readable.length);
      return Utils.summarize(readable, 3);
    }

    // 2) Fallback: tentar baixar a página via proxies (pode ser bloqueado)
    try {
      UI.status("Buscando página da notícia via proxies (fallback)...");
      const html = await Net.fetchViaProxies(link);
      const texto = Utils.cleanHTML(html);
      if (texto && texto.length > 120) {
        Log.info("Conteúdo obtido via proxies (tamanho):", texto.length);
        return Utils.summarize(texto, 3);
      }
    } catch (err) {
      Log.warn("Falha ao obter página via proxies:", String(err));
    }

    // 3) Último recurso
    return "Resumo indisponível no momento. Acesse o link para ler a notícia completa.";
  }
};


/* =============================================================================
   [PARTE 8] IMAGEM (gera/carega com fallback, sem duplicar requests)
   ========================================================================== */
const ImageService = {
  // Gera uma URL de imagem com base no título (sem usar APIs com chave)
  async generateURL(titulo) {
    // Tentativas (ordem): Unsplash → Picsum → Placeholder
    const terms = encodeURIComponent(`${titulo} news illustration`);
    const { largura: W, altura: H } = CONFIG.imagem;

    const candidates = [
      // Unsplash random por termos (retorna redirect para uma imagem)
      `https://source.unsplash.com/${W}x${H}/?${terms}`,
      // Picsum random
      `https://picsum.photos/${W}/${H}?random=${Date.now()}`
    ];

    for (const url of candidates) {
      try {
        await this.head(url, CONFIG.timeouts.imageHead);
        Log.info("Imagem OK:", url);
        return url;
      } catch (err) {
        Log.warn("Imagem indisponível, tentando próximo provedor:", url, String(err));
      }
    }

    // Tudo falhou: placeholder
    return CONFIG.imagem.placeholder;
  },

  async head(url, timeoutMs) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: "HEAD", mode: "no-cors", signal: controller.signal });
      // Em no-cors não dá pra checar status; se não lançar, consideramos ok
      return true;
    } finally {
      clearTimeout(t);
    }
  },

  async loadInto(imgEl, url, alt) {
    return new Promise((resolve, reject) => {
      imgEl.setAttribute("aria-busy", "true");
      imgEl.style.opacity = "0.8";
      imgEl.alt = alt || "Imagem da notícia";

      const img = new Image();
      img.onload = () => {
        imgEl.src = url;
        imgEl.style.opacity = "1";
        imgEl.removeAttribute("aria-busy");
        resolve();
      };
      img.onerror = (e) => {
        imgEl.style.opacity = "1";
        imgEl.removeAttribute("aria-busy");
        reject(e);
      };
      img.src = url;
    });
  }
};


/* =============================================================================
   [PARTE 9] PIPELINE PRINCIPAL (orquestra a sequência)
   ========================================================================== */
async function runMemeDay() {
  UI.hideError();
  UI.showLoading(true);
  UI.status("Inicializando...");

  // Se modo demo forçado via query string
  if (CONFIG.mode.toLowerCase() === "demo") {
    Log.info("Modo DEMO forçado via query string.");
    const noticia = pickDemoNews();
    UI.fillBasicInfo(noticia);
    UI.fillResumo(noticia.resumo);
    const urlImg = await ImageService.generateURL(noticia.titulo);
    await UI.setImageOnce(urlImg, `Imagem: ${noticia.titulo}`);
    UI.showLoading(false);
    return;
