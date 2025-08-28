"use strict";

/* ============================================================================
   Meme Day — script.js (refactor + múltiplas opções de busca)
   - Mantém os seletores originais do DOM
   - Busca: padrão (top), por termo (?q=...), ou por fonte (?source=...)
   - Resumo inteligente (frequência de termos)
   - Imagem automática: Pollinations ⇒ Unsplash ⇒ Picsum ⇒ placeholder
   - Proxies CORS com timeouts curtos e logs
   - Leitura de página via r.jina.ai para evitar CORS
   ========================================================================== */


/* ============================== [0] DIAGNÓSTICO ============================ */
console.log("%c[MemeDay] 🚀 Iniciando (refactor sobre o original)", "background:#111;color:#0ff;padding:2px 6px;border-radius:3px");
console.log("[MemeDay] Ambiente:", {
  href: location.href,
  ua: navigator.userAgent,
  startedAt: new Date().toISOString()
});


/* ============================== [1] CONFIGURAÇÃO =========================== */
const QS = new URLSearchParams(location.search);
const CONFIG = {
  // Query params
  q: (QS.get("q") || "").trim(),                     // termo de busca: ?q=eleicoes
  source: (QS.get("source") || "").trim().toLowerCase(), // força pipeline: ?source=g1|uol|google|bbc|cnn|folha|estadao
  mode: (QS.get("mode") || "auto").trim().toLowerCase(), // ?mode=demo para demo

  // Feeds/fonte
  feeds: {
    // Agregadores
    googleTop:    { nome: "Google News BR", url: "https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419", tipo: "rss", isGoogle: true },
    googleSearch: { nome: "Google News (Busca)", makeUrl: (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`, tipo: "rss", isGoogle: true },
    bingSearch:   { nome: "Bing News (Busca)",   makeUrl: (q) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS`, tipo: "rss" },

    // Portais BR
    g1MaisLidas:  { nome: "G1 - Mais lidas",     url: "https://g1.globo.com/dynamo/mais-lidas/rss2.xml", tipo: "rss" },
    g1Geral:      { nome: "G1 - Geral",          url: "https://g1.globo.com/rss/g1/", tipo: "rss" },
    uolUltimas:   { nome: "UOL - Últimas",       url: "https://noticias.uol.com.br/ultimas/index.xml", tipo: "rss" },
    bbcBrasil:    { nome: "BBC Brasil",          url: "https://www.bbc.com/portuguese/brasil/rss.xml", tipo: "rss" },
    cnnBrasil:    { nome: "CNN Brasil",          url: "https://www.cnnbrasil.com.br/feed/", tipo: "rss" },
    folhaAgora:   { nome: "Folha - Em cima da hora", url: "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml", tipo: "rss" },
    estadaoUlt:   { nome: "Estadão - Últimas",   url: "https://www.estadao.com.br/rss/ultimas", tipo: "rss" }
  },

  // Pipelines (ordem de tentativa)
  pipelines: {
    top:    ["g1MaisLidas", "uolUltimas", "googleTop", "bbcBrasil", "folhaAgora", "estadaoUlt", "g1Geral", "cnnBrasil"],
    g1:     ["g1MaisLidas", "g1Geral"],
    uol:    ["uolUltimas"],
    google: ["googleTop"],
    bbc:    ["bbcBrasil"],
    cnn:    ["cnnBrasil"],
    folha:  ["folhaAgora"],
    estadao:["estadaoUlt"]
  },

  // Proxies CORS (ordem de fallback)
  proxies: [
    { name: "AllOrigins (raw)", url: (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}` },
    { name: "corsproxy.io",     url: (target) => `https://corsproxy.io/?${encodeURIComponent(target)}` }
  ],

  // Timeouts (ms)
  timeouts: {
    proxyFetch: 2500,    // cada tentativa de proxy
    readable: 5000,      // r.jina.ai
    imgLoad: 7000        // cada tentativa de imagem
  },

  // Imagem
  imagem: {
    w: 1280,
    h: 720,
    placeholder: "assets/images/imagem.png" // como no original
  },

  // Demo fallback (quando tudo falhar)
  demo: [
    {
      titulo: "Brasil amplia capacidade de energia solar",
      link: "https://www.google.com/search?q=energia+solar+brasil",
      fonte: "Meme Day (Demo)",
      resumo: "Relatório aponta expansão recorde na matriz solar com redução de custos e novos parques fotovoltaicos."
    },
    {
      titulo: "IA impulsiona produtividade nas empresas",
      link: "https://www.google.com/search?q=ia+produtividade+brasil",
      fonte: "Meme Day (Demo)",
      resumo: "Organizações brasileiras adotam soluções de IA para automatizar processos e melhorar decisões."
    }
  ]
};


/* ============================== [2] DOM (originais) ======================== */
const DOM = {
  titulo: document.querySelector(".titulo-noticia"),
  link: document.querySelector(".link-fonte"),
  fonte: document.querySelector(".fonte-noticia"),
  data: document.querySelector(".data-noticia"),
  resumo: document.querySelector(".resumo-noticia"),
  img: document.querySelector(".imagem-dia img")
};


/* ============================== [3] UTILITÁRIOS DE TEXTO =================== */
function limparTexto(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function gerarResumoInteligente(texto, numFrases = 3) {
  const stopwords = new Set([
    "de","da","do","em","para","com","que","um","uma","uns","umas",
    "os","as","e","o","a","no","na","nos","nas","por","se","ao","aos",
    "dos","das","é","foi","são","ser","tem","há","como","mais","menos",
    "já","também","entre","sobre","até","após","antes","durante"
  ]);
  const frases = texto.split(/(?<=[.!?])\s+/).filter(f => f.length > 0);
  const freq = {};
  for (const frase of frases) {
    for (const palavra of frase.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").split(/\W+/)) {
      if (!palavra || stopwords.has(palavra)) continue;
      freq[palavra] = (freq[palavra] || 0) + 1;
    }
  }
  const pontuadas = frases.map((frase, idx) => {
    let score = 0;
    for (const palavra of frase.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").split(/\W+/)) {
      if (freq[palavra]) score += freq[palavra];
    }
    const comprimento = frase.split(" ").length;
    const bonus = comprimento > 8 ? 0 : 0.5;
    return { frase: frase.trim(), score: score + bonus, idx };
  });
  const melhores = pontuadas
    .sort((a, b) => b.score - a.score)
    .slice(0, numFrases)
    .sort((a, b) => a.idx - b.idx)
    .map(f => f.frase);
  if (melhores.length === 0) {
    return texto.split(". ").slice(0, numFrases).join(". ").trim() + ".";
  }
  const resumo = melhores.join(" ").trim();
  return /[.!?]$/.test(resumo) ? resumo : resumo + ".";
}

function formatarDataHora() {
  const agora = new Date();
  return agora.toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
}


/* ============================== [4] REDE/PROXIES/XML/LEITURA ============== */
async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "Accept": "application/rss+xml, application/xml, text/xml, text/html, */*;q=0.1" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(to);
  }
}

async function fetchViaProxies(url) {
  const errors = [];
  for (const proxy of CONFIG.proxies) {
    try {
      console.info("[MemeDay] Tentando proxy:", proxy.name, "→", proxy.url(url));
      const text = await fetchText(proxy.url(url), CONFIG.timeouts.proxyFetch);
      console.info("[MemeDay] Proxy OK:", proxy.name, `(bytes: ${text.length})`);
      return text;
    } catch (err) {
      errors.push({ proxy: proxy.name, err: String(err) });
      console.warn("[MemeDay] Proxy falhou:", proxy.name, String(err));
    }
  }
  console.error("[MemeDay] Todos os proxies falharam:", errors);
  throw new Error("Todos os proxies falharam");
}

function parseXML(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("XML inválido");
  return doc;
}

// r.jina.ai: versão legível da página (sem CORS; evita bloqueios)
async function fetchReadable(url) {
  try {
    const u = new URL(url);
    const readableURL = `https://r.jina.ai/http://${u.host}${u.pathname}${u.search}`;
    console.info("[MemeDay] r.jina.ai:", readableURL);
    return await fetchText(readableURL, CONFIG.timeouts.readable);
  } catch (err) {
    console.warn("[MemeDay] r.jina.ai falhou:", String(err));
    return "";
  }
}


/* ============================== [5] BUSCA DE NOTÍCIAS ===================== */
// Define qual pipeline usar (top, busca ?q, ou fonte ?source)
function buildPipeline() {
  if (CONFIG.q) {
    return [
      { key: "googleSearch", label: "Google News (Busca)", search: true },
      { key: "bingSearch",   label: "Bing News (Busca)",   search: true },
      { key: "googleTop",    label: "Google News (Top)" }
    ];
  }
  if (CONFIG.source) {
    const p = CONFIG.pipelines[CONFIG.source] || CONFIG.pipelines.top;
    return p.map(k => ({ key: k, label: CONFIG.feeds[k].nome }));
  }
  return CONFIG.pipelines.top.map(k => ({ key: k, label: CONFIG.feeds[k].nome }));
}

async function getFirstNewsFromPipeline() {
  const pipeline = buildPipeline();
  console.info("[MemeDay] Pipeline de busca:", pipeline.map(p => p.label || p.key));

  for (const step of pipeline) {
    const meta = CONFIG.feeds[step.key];
    if (!meta) { console.warn("[MemeDay] Fonte desconhecida:", step.key); continue; }

    try {
      const url = meta.makeUrl ? meta.makeUrl(CONFIG.q) : meta.url;
      console.info("[MemeDay] Buscando feed:", meta.nome, "→", url);

      const xmlText = await fetchViaProxies(url);
      const doc = parseXML(xmlText);

      const item = doc.querySelector("item") || doc.querySelector("entry");
      if (!item) { console.warn("[MemeDay] Nenhum item no feed:", meta.nome); continue; }

      const titulo = (item.querySelector("title")?.textContent || "Notícia").trim();

      // Link (RSS <link>texto</link> ou Atom <link href="...">)
      let link =
        item.querySelector("link[href]")?.getAttribute("href")?.trim() ||
        item.querySelector("link")?.textContent?.trim() ||
        "";

      // Google News: extrair link original do <description> (evita 451/bloqueios)
      if (meta.isGoogle) {
        const desc = item.querySelector("description")?.textContent || "";
        const original = extractOriginalLinkFromHTML(desc, "news.google.com");
        if (original) {
          console.info("[MemeDay] Google News: link original extraído:", original);
          link = original;
        } else {
          console.warn("[MemeDay] Google News: usando link do agregador (não foi possível extrair original).");
        }
      }
