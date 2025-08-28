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
  // Lista de fontes por ordem de prioridade
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

// Atualiza o HTML do Meme Day
getTopNewsBR().then(noticia => {
  if (noticia) {
    document.querySelector(".titulo-noticia").textContent = noticia.titulo;
    document.querySelector(".link-fonte").href = noticia.link;
    document.querySelector(".resumo-noticia").textContent =
      "Clique no botão abaixo para ler a matéria completa.";
  } else {
    document.querySelector(".titulo-noticia").textContent =
      "Não foi possível carregar a notícia do dia";
  }
});
