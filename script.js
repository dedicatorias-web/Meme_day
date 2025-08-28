"use strict";

/*
  Meme Day — script.js
  - Busca a notícia mais popular (G1 → UOL → Google News)
  - Gera resumo inteligente (extração e ranqueamento de frases)
  - Exibe fonte e data/hora
  - Gera imagem automaticamente via navegador (Pollinations, sem API key)
*/

// ------------------------------
// Utilitários de Texto
// ------------------------------
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

  // Quebra em frases preservando pontuação final
  const frases = texto.split(/(?<=[.!?])\s+/).filter(f => f.length > 0);

  // Frequência de palavras (simplificada)
  const freq = {};
  for (const frase of frases) {
    for (const palavra of frase.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").split(/\W+/)) {
      if (!palavra || stopwords.has(palavra)) continue;
      freq[palavra] = (freq[palavra] || 0) + 1;
    }
  }

  // Pontua frases pela soma das frequências das palavras
  const pontuadas = frases.map((frase, idx) => {
    let score = 0;
    for (const palavra of frase.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").split(/\W+/)) {
      if (freq[palavra]) score += freq[palavra];
    }
    // Pequeno bônus para frases mais curtas (mais objetivas)
    const comprimento = frase.split(" ").length;
    const bonus = comprimento > 8 ? 0 : 0.5;
    return { frase: frase.trim(), score: score + bonus, idx };
  });

  // Seleciona top N e reordena na ordem original do texto
  const melhores = pontuadas
    .sort((a, b) => b.score - a.score)
    .slice(0, numFrases)
    .sort((a, b) => a.idx - b.idx)
    .map(f => f.frase);

  // Fallback caso texto seja muito curto
  if (melhores.length === 0) {
    return texto.split(". ").slice(0, numFrases).join(". ").trim() + ".";
  }

  // Garante pontuação final
  const resumo = melhores.join(" ").trim();
  return /[.!?]$/.test(resumo) ? resumo : resumo + ".";
}

// ------------------------------
// Utilitários de Data/Hora
// ------------------------------
function formatarDataHora() {
  const agora = new Date();
  return agora.toLocaleString("pt-BR", {
    dateStyle: "full",
    timeStyle: "short"
  });
}

// ------------------------------
// Acesso a RSS e Páginas (via AllOrigins para contornar CORS no navegador)
// ------------------------------
async function fetchComAllOrigins(url) {
  const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error("Falha no proxy AllOrigins");
  return res.json();
}

async function fetchRSS(url) {
  try {
    const data = await fetchComAllOrigins(url);
    const parser = new DOMParser();
    return parser.parseFromString(data.contents, "application/xml");
  } catch (err) {
    console.error("Erro ao buscar RSS:", err);
    return null;
  }
}

async function fetchPaginaTexto(url) {
  try {
    const data = await fetchComAllOrigins(url);
    return limparTexto(data.contents);
  } catch (err) {
    console.error("Erro ao buscar página da notícia:", err);
    return "";
  }
}

// ------------------------------
// Seleção da Notícia (G1 → UOL → Google News)
// ------------------------------
async function getTopNewsBR() {
  const fontes = [
    { nome: "G1", url: "https://g1.globo.com/dynamo/mais-lidas/rss2.xml" },
    { nome: "UOL", url: "https://noticias.uol.com.br/ultimas/index.xml" },
    { nome: "Google News", url: "https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419" }
  ];

  for (let fonte of fontes) {
    const xml = await fetchRSS(fonte.url);
    if (!xml) continue;

    const item = xml.querySelector("item");
    if (!item) continue;

    // Em alguns feeds, a <link> pode vir com redirects; usamos assim mesmo
    const titulo = item.querySelector("title")?.textContent?.trim() || "Notícia do dia";
    const link = item.querySelector("link")?.textContent?.trim() || "#";

    if (titulo && link && link.startsWith("http")) {
      console.log(`Fonte usada: ${fonte.nome}`);
      return { titulo, link, fonte: fonte.nome };
    }
  }

  return null;
}

// ------------------------------
// Resumo da Notícia
// ------------------------------
async function gerarResumoDaNoticia(url) {
  const texto = await fetchPaginaTexto(url);
  if (!texto) return "Resumo indisponível no momento.";
  // Heurística: recorta um miolo útil (evita cabeçalho/rodapé longos)
  const trechoUtil = texto.slice(0, 8000); // limita processamento
  return gerarResumoInteligente(trechoUtil, 3);
}

// ------------------------------
// Geração de Imagem no Navegador (sem API key)
// Utiliza o endpoint do Pollinations para obter uma URL de imagem a partir do prompt.
// ------------------------------
function montarPromptImagem(titulo, resumo) {
  // Prompt em PT com instruções claras de estilo
  return [
    `${titulo}`,
    `${resumo}`,
    "Ilustração digital flat, cores quentes e alto contraste, estilo Meme Day.",
    "Composição centrada, limpa, sem texto na imagem, visual moderno."
  ].join(" ");
}

async function gerarImagemNoNavegador(titulo, resumo) {
  const imgEl = document.querySelector(".imagem-dia img");
  const placeholder = "assets/images/imagem.png";

  try {
    // Estado de carregamento
    imgEl.setAttribute("aria-busy", "true");
    imgEl.style.opacity = "0.9";

    const prompt = montarPromptImagem(titulo, resumo);
    // Pollinations: aceita prompt via URL e retorna imagem diretamente
    // Ajuste de dimensões para 16:9 (boa para hero)
    const w = 1280, h = 720;
    const pollinationsURL =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}`;

    // Primeiro, testa rapidamente se a URL responde (opcional)
    // Como é uma imagem direta, podemos setar o src e capturar onerror
    await new Promise((resolve) => setTimeout(resolve, 200)); // pequeno delay para UX

    imgEl.src = pollinationsURL;
    imgEl.alt = `Imagem gerada para: ${titulo}`;

    // Aguarda carregamento ou erro
    await new Promise((resolve, reject) => {
      imgEl.onload = () => resolve();
      imgEl.onerror = () => reject(new Error("Falha ao carregar imagem gerada"));
      // Timeout de segurança (6s)
      setTimeout(() => reject(new Error("Timeout ao carregar imagem")), 6000);
    });
  } catch (err) {
    console.warn("Gerador de imagem indisponível, usando placeholder:", err.message);
    imgEl.src = placeholder;
    imgEl.alt = "Imagem padrão do Meme Day";
  } finally {
    imgEl.removeAttribute("aria-busy");
    imgEl.style.opacity = "1";
  }
}

// ------------------------------
// Execução principal
// ------------------------------
(async () => {
  try {
    const noticia = await getTopNewsBR();

    if (!noticia) {
      document.querySelector(".titulo-noticia").textContent =
        "Não foi possível carregar a notícia do dia";
      return;
    }

    // Preenche campos básicos
    document.querySelector(".titulo-noticia").textContent = noticia.titulo;
    document.querySelector(".link-fonte").href = noticia.link;
    document.querySelector(".fonte-noticia").textContent = noticia.fonte;
    document.querySelector(".data-noticia").textContent = formatarDataHora();

    // Resumo
    const resumo = await gerarResumoDaNoticia(noticia.link);
    document.querySelector(".resumo-noticia").textContent = resumo;

    // Imagem automática (fallback para assets se falhar)
    await gerarImagemNoNavegador(noticia.titulo, resumo);
  } catch (err) {
    console.error("Erro geral no Meme Day:", err);
    document.querySelector(".titulo-noticia").textContent =
      "Ocorreu um erro ao atualizar a notícia do dia.";
  }
})();
