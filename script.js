"use strict";

/* =============================================================================
   Meme Day — script.js (v8)
   - Múltiplas opções de busca:
     • Top headlines (mix de várias fontes)
     • Busca por termo (?q=palavra)
     • Forçar fonte específica (?source=g1|uol|bbc|google|bing|cnn|folha|estadao)
   - RSS via proxies com timeouts curtos e logs detalhados
   - Extração de link original do Google News
   - Resumo via r.jina.ai (CORS liberado) com fallback via proxies
   - Geração de imagem com lista de candidatos (sem duplicar requisições)
   - Modo DEMO automático quando tudo falhar (?mode=demo para forçar)
   ========================================================================== */


/* =============================================================================
   [PARTE 0] DIAGNÓSTICO INICIAL
   ========================================================================== */
console.log("%c[MemeDay] 🚀 Iniciando app v8", "background:#111;color:#0ff;padding:2px 6px;border-radius:3px");
console.log("[MemeDay] Ambiente:", {
  href: location.href,
  userAgent: navigator.userAgent,
  startedAt: new Date().toISOString()
});


/* =============================================================================
   [PARTE 1] CONFIGURAÇÃO
   ========================================================================== */
const QS = new URLSearchParams(location.search);
const CONFIG = {
  mode: (QS.get("mode") || "auto").toLowerCase(), // auto | demo
  q: (QS.get("q") || "").trim(),                  // termo de busca
  source: (QS.get("source") || "").trim().toLowerCase(), // força uma fonte/pipeline

  // Fontes (mapeadas por chave e com metadados)
  fontes: {
    googleTop:    { nome: "Google News BR", url: "https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419", tipo: "rss", isGoogle: true },
    googleSearch: { nome: "Google News (Busca)", makeUrl: (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`, tipo: "rss", isGoogle: true },
    bingSearch:   { nome: "Bing News (Busca)",   makeUrl: (q) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS`, tipo: "rss", isGoogle: false },

    g1MaisLidas:  { nome: "G1 - Mais lidas",     url: "https://g1.globo.com/dynamo/mais-lidas/rss2.xml", tipo: "rss" },
    g1Geral:      { nome: "G1 - Geral",          url: "https://g1.globo.com/rss/g1/", tipo: "rss" },
    uolUltimas:   { nome: "UOL - Últimas",       url: "https://noticias.uol.com.br/ultimas/index.xml", tipo: "rss" },
    bbcBrasil:    { nome: "BBC Brasil",          url: "https://www.bbc.com/portuguese/brasil/rss.xml", tipo: "rss" },
    cnnBrasil:    { nome: "CNN Brasil",          url: "https://www.cnnbrasil.com.br/feed/", tipo: "rss" },
    folhaAgora:   { nome: "Folha - Em cima da hora", url: "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml", tipo: "rss" },
    estadaoUlt:   { nome: "Estadão - Últimas",   url: "https://www.estadao.com.br/rss/ultimas", tipo: "rss" },
  },

  // Pipelines pré-definidos (ordem de tentativa)
  pipelines: {
    top:    ["g1MaisLidas", "uolUltimas", "googleTop", "bbcBrasil", "folhaAgora", "estadaoUlt", "g1Geral", "cnnBrasil"],
    google: ["googleTop"],
    g1:     ["g1MaisLidas", "g1Geral"],
    uol:    ["uolUltimas"],
    bbc:    ["bbcBrasil"],
    cnn:    ["cnnBrasil"],
    folha:  ["folhaAgora"],
    estadao:["estadaoUlt"],
    bing:   [], // usado apenas para busca por termo
  },

  // Proxies para contornar CORS
  proxies: [
    { name: "AllOrigins (raw)", url: (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}` },
    { name: "corsproxy.io",     url: (target) => `https://corsproxy.io/?${encodeURIComponent(target)}` }
  ],

  // Timeouts (ms)
  timeouts: {
    proxyFetch: 2500,
    readableFetch: 5000,
    imageLoad: 7000,
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

  // Fallback demo
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
   [PARTE 2] LOGGER
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
   [PARTE 3] UTILITÁRIOS (tempo, limpeza, resumo, keywords)
   ========================================================================== */
const Utils = {
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
  nowBR()   { return new Date().toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" }); },

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
    if (sentences.length <= maxSentences) return sentences.join(" ");

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

  titleKeywords(titulo) {
    if (!titulo) return ["news","brazil"];
    const base = titulo
      .normalize("NFD").replace(/\p{Diacritic}/gu, "")
      .toLowerCase().replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(x => x.length >= 3 && !["the","and","for","com","uma","para","que","com","dos","das","nos","nas"].includes(x));
    const uniq = [...new Set(base)];
    return uniq.slice(0, 5).length ? uniq.slice(0, 5) : ["news","brazil"];
  }
};


/* =============================================================================
   [PARTE 4] UI (DOM)
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
  function showLoading(show) { if (els.carregando) els.carregando.style.display = show ? "block" : "none"; }
  function showError(msg)    { if (els.erro) { els.erro.textContent = String(msg); els.erro.style.display = "block"; } Log.error("ERRO:", msg); }
  function hideError()       { if (els.erro) els.erro.style.display = "none"; }

  function fillBasicInfo({ titulo, fonte, link }) {
    if (els.titulo) els.titulo.textContent = titulo || "Notícia do dia";
    if (els.fonte)  els.fonte.textContent  = fonte || "Fonte";
    if (els.linkFonte && link) {
      els.linkFonte.href = link;
      els.linkFonte.title = "Abrir notícia original";
      els.linkFonte.target = "_blank";
      els.linkFonte.rel = "noopener noreferrer";
    }
    if (els.dataHora) els.dataHora.textContent = Utils.nowBR();
    if (els.card) els.card.style.display = "block";
  }
  function fillResumo(texto) { if (els.resumo) els.resumo.textContent = texto || "Resumo indisponível."; }

  async function setImageOnce(candidates, alt) {
    if (imageSet || !els.imagem) return;
    imageSet = true;
    els.imagem.setAttribute("aria-busy", "true");
    els.imagem.style.opacity = "0.85";
    els.imagem.alt = alt || "Imagem da notícia";

    for (const url of candidates) {
      const ok = await tryLoad(els.imagem, url, CONFIG.timeouts.imageLoad);
      if (ok) {
        Log.info("Imagem aplicada:", url);
        els.imagem.style.opacity = "1";
        els.imagem.removeAttribute("aria-busy");
        return;
      } else {
        Log.warn("Falha ao carregar imagem, próximo candidato:", url);
      }
    }
    Log.warn("Nenhuma imagem carregou. Usando placeholder.");
    els.imagem.src = CONFIG.imagem.placeholder;
    els.imagem.style.opacity = "1";
    els.imagem.removeAttribute("aria-busy");
  }

  function tryLoad(imgEl, url, timeoutMs) {
    return new Promise(resolve => {
      const img = new Image();
      let done = false;
      const timer = setTimeout(() => { if (done) return; done = true; cleanup(false); }, timeoutMs);
      function cleanup(result) { clearTimeout(timer); img.onload = img.onerror = null; resolve(result); }
      img.onload = () => { if (done) return; done = true; imgEl.src = url; cleanup(true); };
      img.onerror = () => { if (done) return; done = true; cleanup(false); };
      img.src = url;
    });
  }

  return { status, showLoading, showError, hideError, fillBasicInfo, fillResumo, setImageOnce };
})();


/* =============================================================================
   [PARTE 5] REDE (proxies, xml, r.jina.ai)
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
        errors.push({ proxy: proxy.name, err: String(err) });
        Log.warn(`Proxy ${proxy.name} falhou:`, String(err));
      }
    }
    Log.error("Todos os proxies falharam:", errors);
    throw new Error("Todos os proxies falharam");
  },

  parseXML(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("XML inválido");
    return doc;
  },

  async fetchReadablePage(originalUrl) {
    try {
      const u = new URL(originalUrl);
      const jinaURL = `https://r.jina.ai/http://${u.host}${u.pathname}${u.search}`;
      Log.info("r.jina.ai:", jinaURL);
      return await this.fetchText(jinaURL, CONFIG.timeouts.readableFetch);
    } catch (err) {
      Log.warn("r.jina.ai falhou:", String(err));
      return "";
    }
  }
};


/* =============================================================================
   [PARTE 6] RSS HELPERS (pega item top de um feed)
   ========================================================================== */
const RSS = {
  async getTopItemFromURL(url, { fonteNome = "RSS", isGoogle = false } = {}) {
    const xmlText = await Net.fetchViaProxies(url);
    const doc = Net.parseXML(xmlText);
    const item = doc.querySelector("item") || doc.querySelector("entry");
    if (!item) {
      Log.warn(`Sem itens no feed: ${fonteNome}`);
      return null;
    }

    const titulo = (item.querySelector("title")?.textContent || "Notícia").trim();

    // Pega link padrão
    let link =
      item.querySelector("link[href]")?.getAttribute("href")?.trim() || // Atom
      item.querySelector("link")?.textContent?.trim() ||                // RSS
      "";

    if (isGoogle) {
      // Tenta extrair link original a partir do <description> (Google News)
      const desc = item.querySelector("description")?.textContent || "";
      const original = Sources.extractOriginalLinkFromHTML(desc, "news.google.com");
      if (original) {
        Log.info("Google News: link original encontrado no description:", original);
        link = original;
      } else {
        Log.warn("Google News: usando link do agregador (não foi possível extrair original).");
      }
    }

    if (!/^https?:\/\//i.test(link)) {
      Log.warn("Link inválido; ignorando item.", { fonteNome, titulo, link });
      return null;
    }

    return { titulo, link, fonte: fonteNome };
  }
};


/* =============================================================================
   [PARTE 7] SOURCES (múltiplas opções de busca)
   ========================================================================== */
const Sources = {
  // Monta pipeline com base nos parâmetros (q, source)
  buildPipeline() {
    const { q, source, pipelines } = CONFIG;

    // Se termo de busca
    if (q) {
      // pipeline de busca (Google News Search → Bing News → fallback Google Top)
      return [
        { key: "googleSearch", label: "Google News (Busca)", search: true },
        { key: "bingSearch",   label: "Bing News (Busca)",   search: true },
        { key: "googleTop",    label: "Google News (Top)",   search: false }
      ];
    }

    // Se força uma fonte específica
    if (source) {
      switch (source) {
        case "google":  return CONFIG.pipelines.google.map(k => ({ key: k, label: CONFIG.fontes[k].nome }));
        case "g1":      return CONFIG.pipelines.g1.map(k => ({ key: k, label: CONFIG.fontes[k].nome }));
        case "uol":     return CONFIG.pipelines.uol.map(k => ({ key: k, label: CONFIG.fontes[k].nome }));
        case "bbc":     return CONFIG.pipelines.bbc.map(k => ({ key: k, label: CONFIG.fontes[k].nome }));
        case "cnn":     return CONFIG.pipelines.cnn.map(k => ({ key: k, label: CONFIG.fontes[k].nome }));
        case "folha":   return CONFIG.pipelines.folha.map(k => ({ key: k, label: CONFIG.fontes[k].nome }));
        case "estadao": return CONFIG.pipelines.estadao.map(k => ({ key: k, label: CONFIG.fontes[k].nome }));
        case "bing":    return [{ key: "bingSearch", label: "Bing News (Busca)", search: true }]; // precisa de q
        default:        return CONFIG.pipelines.top.map(k => ({ key: k, label: CONFIG.fontes[k].nome }));
      }
    }

    // Padrão: pipeline top (mix)
    return CONFIG.pipelines.top.map(k => ({ key: k, label: CONFIG.fontes[k].nome }));
  },

  async getNewsFromProviderKey(key) {
    const f = CONFIG.fontes[key];
    if (!f) { Log.warn("Fonte desconhecida:", key); return null; }

    if (f.makeUrl) {
      // Fontes de busca (dependem de q)
      const q = CONFIG.q;
      if (!q) {
        Log.warn(`Fonte ${f.nome} requer parâmetro ?q=`);
        return null;
      }
      const url = f.makeUrl(q);
      return await RSS.getTopItemFromURL(url, { fonteNome: f.nome, isGoogle: !!f.isGoogle });
    } else {
      // Fontes fixas
      return await RSS.getTopItemFromURL(f.url, { fonteNome: f.nome, isGoogle: !!f.isGoogle });
    }
  },

  async getFirstAvailableNews() {
    const pipeline = this.buildPipeline();
    Log.info("Pipeline de busca configurado:", pipeline.map(p => p.label || p.key));

    for (const step of pipeline) {
      const label = step.label || step.key;
      UI.status(`Buscando: ${label}...`);
      try {
        const noticia = await this.getNewsFromProviderKey(step.key);
        if (noticia) {
          Log.info("Notícia encontrada:", noticia);
          return noticia;
        }
        Log.warn(`Sem resultado em: ${label}. Tentando próxima fonte...`);
      } catch (err) {
        Log.warn(`Falha em ${label}:`, String(err));
      }
    }
    return null;
  },

  // Extrai primeiro link http(s) que não seja do host excluído
  extractOriginalLinkFromHTML(html, excludeHost) {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const as = doc.querySelectorAll("a[href]");
      for (const a of as) {
        const href = a.getAttribute("href");
        if (!href) continue;
        if (/^https?:\/\//i.test(href) && (!excludeHost || !href.includes(excludeHost))) return href;
      }
      // Fallback regex simples
      const m = html.match(/https?:\/\/[^\s"'<)]+/i);
      if (m && (!excludeHost || !m[0].includes(excludeHost))) return m[0];
    } catch (e) {
      Log.warn("Falha ao parsear HTML para extrair link original:", String(e));
    }
    return null;
  }
};


/* =============================================================================
   [PARTE 8] ARTIGO / RESUMO
   ========================================================================== */
const Article = {
  async buildSummary(link) {
    // 1) Tenta r.jina.ai (legal para contornar CORS em leitura)
    const readable = await Net.fetchReadablePage(link);
    if (readable && readable.length > 120) {
      Log.info("Texto via r.jina.ai (chars):", readable.length);
      return Utils.summarize(readable, 3);
    }

    // 2) Fallback: baixa HTML via proxies
    try {
      Log.info("Tentando obter HTML via proxies (fallback resumo)...");
      const html = await Net.fetchViaProxies(link);
      const text = Utils.cleanHTML(html);
      if (text && text.length > 120) {
        Log.info("Texto via proxies (chars):", text.length);
        return Utils.summarize(text, 3);
      }
    } catch (err) {
      Log.warn("Falha ao obter HTML via proxies:", String(err));
    }

    // 3) Último recurso
    return "Resumo indisponível no momento. Acesse o link para ler a notícia completa.";
  }
};


/* =============================================================================
   [PARTE 9] IMAGEM (candidatos por keywords do título)
   ========================================================================== */
const ImageService = {
  generateCandidates(titulo) {
    const { largura: W, altura: H } = CONFIG.imagem;
    const kws = Utils.titleKeywords(titulo).join(",");
    return [
      `https://source.unsplash.com/${W}x${H}/?news,${encodeURIComponent(kws)}`,
      `https://picsum.photos/${W}/${H}?random=${Date.now()}`
    ];
  }
};


/* =============================================================================
   [PARTE 10] PIPELINE PRINCIPAL
   ========================================================================== */
async function runMemeDay() {
  UI.hideError();
  UI.showLoading(true);
  UI.status("Inicializando...");

  // Modo DEMO forçado
  if (CONFIG.mode === "demo") {
    Log.info("Modo DEMO forçado (?mode=demo).");
    const demo = pickDemoNews();
    UI.fillBasicInfo(demo);
    UI.fillResumo(demo.resumo);
    const candidates = ImageService.generateCandidates(demo.titulo);
    await UI.setImageOnce([...candidates, CONFIG.imagem.placeholder], `Imagem: ${demo.titulo}`);
    UI.showLoading(false);
    return;
  }

  try {
    // 1) Escolhe pipeline de busca (top, busca por termo, fonte específica)
    const explain = CONFIG.q
      ? `Buscando por termo: "${CONFIG.q}"...`
      : CONFIG.source
        ? `Forçando fonte: "${CONFIG.source}"...`
        : "Buscando manchete do momento (mix)...";
    UI.status(explain);
    Log.info(explain);

    // 2) Encontra primeira notícia disponível no pipeline
    const noticia = await Sources.getFirstAvailableNews();

    if (!noticia) {
      Log.warn("Nenhuma fonte retornou notícias. Ativando modo DEMO.");
      const demo = pickDemoNews();
      UI.fillBasicInfo(demo);
      UI.fillResumo(demo.resumo);
      const candidates = ImageService.generateCandidates(demo.titulo);
      await UI.setImageOnce([...candidates, CONFIG.imagem.placeholder], `Imagem: ${demo.titulo}`);
      UI.showLoading(false);
      return;
    }

    // 3) Preenche título/fonte/link/data
    UI.fillBasicInfo(noticia);

    // 4) Gera resumo
    UI.status("Gerando resumo da notícia...");
    const resumo = await Article.buildSummary(noticia.link);
    UI.fillResumo(resumo);

    // 5) Imagem (1x) — candidatos por keywords
    UI.status("Gerando imagem da notícia...");
    const candidates = ImageService.generateCandidates(noticia.titulo);
    await UI.setImageOnce([...candidates, CONFIG.imagem.placeholder], `Imagem: ${noticia.titulo}`);

  } catch (err) {
    UI.showError("Não foi possível carregar a notícia do dia. Verifique sua conexão e tente novamente.");
    Log.error("Falha no pipeline principal:", err);
  } finally {
    UI.showLoading(false);
  }
}

function pickDemoNews() {
  const arr = CONFIG.demoNoticias;
  return arr[Math.floor(Math.random() * arr.length)];
}


/* =============================================================================
   [PARTE 11] BOOTSTRAP
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  Log.info("DOM pronto. Iniciando Meme Day.");
  runMemeDay();
});
