"use strict";

/* ============================================================================
   Meme Day — script.js (v6.1)
   - Busca a notícia top via RSS (com proxies e timeouts curtos)
   - Extrai texto legível via r.jina.ai (CORS liberado) e resume
   - Atualiza UI com título, fonte, data/hora, resumo e imagem (1x)
   - Modo DEMO automático quando rede/proxies falham
   - Muitos logs para facilitar debug
   ============================================================================ */


/* =============================================================================
   [PARTE 0] BANNER / DIAGNÓSTICO INICIAL
   ========================================================================== */
console.log("%c[MemeDay] 🚀 Iniciando app v6.1", "background:#222;color:#0ff;padding:2px 6px;border-radius:3px");
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

  // Fontes de RSS
  fontes: [
    { nome: "Google News BR", url: "https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419", tipo: "rss" },
    { nome: "G1",            url: "https://g1.globo.com/rss/g1/",                                   tipo: "rss" },
    { nome: "BBC Brasil",    url: "https://www.bbc.com/portuguese/brasil/rss.xml",                 tipo: "rss" }
  ],

  // Proxies para contornar CORS (ordem de tentativa)
  proxies: [
    { name: "AllOrigins (raw)", url: (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}` },
    { name: "corsproxy.io",     url: (target) => `https://corsproxy.io/?${encodeURIComponent(target)}` }
  ],

  // Timeouts
  timeouts: {
    proxyFetch: 2500,     // por tentativa de proxy (ms)
    readableFetch: 5000,  // r.jina.ai (ms)
    imageHead: 3000       // verificação de imagem (ms)
  },

  // Imagem
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

  // Notícias demo (fallback)
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
   [PARTE 3] UTILITÁRIOS GERAIS (tempo, limpeza, resumo)
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

  // Resumo por ranqueamento simples de frases (frequência de palavras)
  summarize(text, maxSentences = 3) {
    if (!text) return "Resumo indisponível no momento.";
    const MAX_CHARS = 6000; // limita custo
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
  }
};


/* =============================================================================
   [PARTE 4] REDE (fetch com proxies e parsing XML)
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
        console.log(`[MemeDay] Tentando proxy: ${proxy.name} →`, proxy.url(url));
        const text = await this.fetchText(proxy.url(url), CONFIG.timeouts.proxyFetch);
        console.log("[MemeDay] Proxy OK:", proxy.name, `(bytes: ${text.length})`);
        return text;
      } catch (err) {
        errors.push({ proxy: proxy.name, err: String(err) });
        console.warn(`[MemeDay] Proxy ${proxy.name} falhou:`, String(err));
      }
    }
    console.error("[MemeDay] Todos os proxies falharam:", errors);
    throw new Error("Todos os proxies falharam");
  },

  parseXML(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("XML inválido");
    return doc;
  },

  // Leitor legível (sem CORS) via r.jina.ai
  async fetchReadablePage(originalUrl) {
    try {
      const u = new URL(originalUrl);
      const jinaURL = `https://r.jina.ai/http://${u.host}${u.pathname}${u.search}`;
      console.log("[MemeDay] r.jina.ai:", jinaURL);
      return await this.fetchText(jinaURL, CONFIG.timeouts.readableFetch);
    } catch (err) {
      console.warn("[MemeDay] r.jina.ai falhou:", String(err));
      return "";
    }
  }
};


/* =============================================================================
   [PARTE 5] FONTES / BUSCA DE NOTÍCIAS (RSS → item top)
   ========================================================================== */
const Sources = {
  async getTopNews() {
    for (const fonte of CONFIG.fontes) {
      Log.group(`Buscando feed: ${fonte.nome}`, () => {});
      try {
        const xmlText = await Net.fetchViaProxies(fonte.url);
        const doc = Net.parseXML(xmlText);

        // Suporta RSS/Atom
        const item = doc.querySelector("item") || doc.querySelector("entry");
        if (!item) {
          Log.warn(`Nenhum item no feed: ${fonte.nome}`);
          continue;
        }

        const titulo = item.querySelector("title")?.textContent?.trim() || "Notícia";
        const link =
          item.querySelector("link[href]")?.getAttribute("href")?.trim() // Atom
          || item.querySelector("link")?.textContent?.trim()             // RSS
          || "";

        if (!/^https?:\/\//i.test(link)) {
          Log.warn("Link inválido no feed; ignorando item.", { titulo, link });
          continue;
        }

        Log.info("Top item:", { fonte: fonte.nome, titulo, link });
        return { titulo, link, fonte: fonte.nome };
      } catch (err) {
        Log.warn(`Falha no feed ${fonte.nome}:`, String(err));
      }
    }
    return null;
  }
};


/* =============================================================================
   [PARTE 6] ARTIGO / RESUMO
   ========================================================================== */
const Article = {
  async buildSummary(link) {
    // 1) Tenta texto legível via r.jina.ai
    const readable = await Net.fetchReadablePage(link);
    if (readable && readable.length > 120) {
      Log.info("Texto via r.jina.ai (chars):", readable.length);
      return Utils.summarize(readable, 3);
    }

    // 2) Fallback: tenta pegar HTML bruto via proxies e resumir
    try {
      const html = await Net.fetchViaProxies(link);
      const text = Utils.cleanHTML(html);
      if (text && text.length > 120) {
        Log.info("Texto via proxies (chars):", text.length);
        return Utils.summarize(text, 3);
      }
    } catch (err) {
      Log.warn("Falha ao obter página via proxies:", String(err));
    }

    // 3) Último recurso
    return "Resumo indisponível no momento. Acesse o link para ler a notícia completa.";
  }
};


/* =============================================================================
   [PARTE 7] IMAGEM (gera URL e carrega 1x)
   ========================================================================== */
const ImageService = {
  async generateURL(titulo) {
    const terms = encodeURIComponent(`${titulo} news illustration`);
    const { largura: W, altura: H } = CONFIG.imagem;

    const candidates = [
      `https://source.unsplash.com/${W}x${H}/?${terms}`,
      `https://picsum.photos/${W}/${H}?random=${Date.now()}`
    ];

    for (const url of candidates) {
      try {
        await this.head(url, CONFIG.timeouts.imageHead);
        Log.info("Imagem válida:", url);
        return url;
      } catch (err) {
        Log.warn("Imagem indisponível, tentando outra:", url, String(err));
      }
    }

    return CONFIG.imagem.placeholder;
  },

  async head(url, timeoutMs) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Em no-cors, não há acesso a status; se não errar, consideramos OK
      await fetch(url, { method: "HEAD", mode: "no-cors", signal: controller.signal });
      return true;
    } finally {
      clearTimeout(t);
    }
  },

  async loadInto(imgEl, url, alt) {
    return new Promise((resolve, reject) => {
      imgEl.setAttribute("aria-busy", "true");
      imgEl.style.opacity = "0.85";
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
   [PARTE 8] UI (DOM, estados, preenchimento)
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
   [PARTE 9] PIPELINE PRINCIPAL (orquestra a sequência)
   ========================================================================== */
async function runMemeDay() {
  UI.hideError();
  UI.showLoading(true);
  UI.status("Inicializando...");

  // Modo DEMO forçado via query string
  if (CONFIG.mode.toLowerCase() === "demo") {
    Log.info("Modo DEMO forçado (?mode=demo).");
    const noticia = pickDemoNews();
    UI.fillBasicInfo(noticia);
    UI.fillResumo(noticia.resumo);
    const urlImg = await ImageService.generateURL(noticia.titulo);
    await UI.setImageOnce(urlImg, `Imagem: ${noticia.titulo}`);
    UI.showLoading(false);
    return;
  }

  try {
    UI.status("Buscando notícia principal (RSS)...");
    const noticia = await Sources.getTopNews();

    if (!noticia) {
      Log.warn("Nenhum feed disponível. Ativando modo DEMO automático.");
      const demo = pickDemoNews();
      UI.fillBasicInfo(demo);
      UI.fillResumo(demo.resumo);
      const urlImg = await ImageService.generateURL(demo.titulo);
      await UI.setImageOnce(urlImg, `Imagem: ${demo.titulo}`);
      UI.showLoading(false);
      return;
    }

    // Preenche título/fonte/link/data imediatamente
    UI.fillBasicInfo(noticia);

    // Gera resumo
    UI.status("Gerando resumo da notícia...");
    const resumo = await Article.buildSummary(noticia.link);
    UI.fillResumo(resumo);

    // Imagem (somente 1 vez)
    UI.status("Gerando imagem da notícia...");
    const urlImg = await ImageService.generateURL(noticia.titulo);
    await UI.setImageOnce(urlImg, `Imagem: ${noticia.titulo}`);

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
   [PARTE 10] BOOTSTRAP
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  Log.info("DOM pronto. Iniciando Meme Day.");
  runMemeDay();
});
