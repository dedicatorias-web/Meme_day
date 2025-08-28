function limparTexto(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function gerarResumoInteligente(texto, numFrases = 3) {
  const stopwords = ["de","da","do","em","para","com","que","um","uma","os","as","e","o","a","no","na","por","se","ao","dos","das"];
  const frases = texto.split(/(?<=[.!?])\s+/);
  
  // Conta frequência de palavras
  const freq = {};
  frases.forEach(frase => {
    frase.toLowerCase().split(/\W+/).forEach(palavra => {
      if (palavra && !stopwords.includes(palavra)) {
        freq[palavra] = (freq[palavra] || 0) + 1;
      }
    });
  });

  // Pontua frases
  const frasesPontuadas = frases.map(frase => {
    let score = 0;
    frase.toLowerCase().split(/\W+/).forEach(palavra => {
      if (freq[palavra]) score += freq[palavra];
    });
    return { frase, score };
  });

  // Ordena por pontuação e pega as melhores
  const melhores = frasesPontuadas
    .sort((a, b) => b.score - a.score)
    .slice(0, numFrases)
    .map(f => f.frase.trim());

  return melhores.join(" ");
}

async function fetchRSS(url) {
  try {
    const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    const parser = new DOMParser();
    return parser.parseFromString(data.contents, "application/xml");
  } catch (err) {
    console.error("Erro ao buscar RSS:", err);
    return null;
  }
}

async function getTopNewsBR() {
  const fontes = [
    { nome: "G1", url: "https://g1.globo.com/dynamo/mais-lidas/rss2.xml" },
    { nome: "UOL", url: "https://noticias.uol.com.br/ultimas/index.xml" },
    { nome: "Google News", url: "https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419" }
  ];

  for (let fonte of fontes) {
    const xml = await fetchRSS(fonte.url);
    if (xml) {
      const item = xml.querySelector("item");
      if (item) {
        console.log(`Fonte usada: ${fonte.nome}`);
        return {
          titulo: item.querySelector("title").textContent,
          link: item.querySelector("link").textContent
        };
      }
    }
  }
  return null;
}

async function gerarResumoDaNoticia(url) {
  try {
    const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    const textoLimpo = limparTexto(data.contents);
    return gerarResumoInteligente(textoLimpo, 3);
  } catch (err) {
    console.error("Erro ao gerar resumo:", err);
    return "Resumo indisponível no momento.";
  }
}

// Atualiza o HTML do Meme Day
(async () => {
  const noticia = await getTopNewsBR();
  if (noticia) {
    document.querySelector(".titulo-noticia").textContent = noticia.titulo;
    document.querySelector(".link-fonte").href = noticia.link;
    document.querySelector(".resumo-noticia").textContent = await gerarResumoDaNoticia(noticia.link);
  } else {
    document.querySelector(".titulo-noticia").textContent =
      "Não foi possível carregar a notícia do dia";
  }
})();
