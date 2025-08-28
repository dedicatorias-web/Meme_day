"use strict";

/**
 * Meme Day - Sistema de agregação de notícias com geração de imagens
 * Versão 2.0 - Com múltiplos proxies e melhor resiliência
 */

// ------------------------------
// Configuração e Constantes
// ------------------------------
const CONFIG = {
  proxies: [
    {
      name: "AllOrigins",
      url: (targetUrl) => `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
      needsParsing: false
    },
    {
      name: "CORS Anywhere",
      url: (targetUrl) => `https://cors-anywhere.herokuapp.com/${targetUrl}`,
      needsParsing: false
    },
    {
      name: "CORS Proxy",
      url: (targetUrl) => `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
      needsParsing: false
    },
    {
      name: "Proxy Server",
      url: (targetUrl) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
      needsParsing: false
    }
  ],
  fontes: [
    { 
      nome: "Google News Brasil", 
      url: "https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419",
      tipo: "rss"
    },
    { 
      nome: "G1", 
      url: "https://g1.globo.com/dynamo/rss2.xml",
      tipo: "rss"
    },
    { 
      nome: "UOL", 
      url: "https://noticias.uol.com.br/ultimas/index.xml",
      tipo: "rss"
    },
    // Fontes alternativas que funcionam sem proxy
    {
      nome: "RSS Aggregator",
      url: "https://rss.app/feeds/v1.1/t5qJrlwQoUC4O1pl.json",
      tipo: "json",
      semProxy: true
    }
  ],
  imagem: {
    largura: 1280,
    altura: 720,
    placeholder: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1280 720'%3E%3Crect fill='%23f0f0f0' width='1280' height='720'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%23999' font-family='Arial' font-size='24'%3EMeme Day%3C/text%3E%3C/svg%3E",
    timeout: 8000
  },
  resumo: {
    numeroFrases: 3,
    tamanhoMaxTexto: 8000
  },
  retry: {
    tentativas: 3,
    delay: 1000
  },
  seletores: {
    titulo: "[data-element='titulo']",
    resumo: "[data-element='resumo']",
    fonte: "[data-element='fonte']",
    linkFonte: "[data-element='link-fonte']",
    dataHora: "[data-element='data-hora']",
    imagem: "[data-element='imagem']",
    containerErro: "[data-element='erro']",
    containerCarregando: "[data-element='carregando']"
  }
};

// ------------------------------
// Classe de Utilidades
// ------------------------------
class Utils {
  static async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static async retry(fn, tentativas = CONFIG.retry.tentativas, delay = CONFIG.retry.delay) {
    for (let i = 0; i < tentativas; i++) {
      try {
        return await fn();
      } catch (error) {
        console.warn(`Tentativa ${i + 1} falhou:`, error.message);
        if (i === tentativas - 1) throw error;
        await this.sleep(delay * (i + 1)); // Backoff progressivo
      }
    }
  }
}

// ------------------------------
// Classe de Utilidades de Texto
// ------------------------------
class TextoUtils {
  static stopwords = new Set([
    "de","da","do","em","para","com","que","um","uma","uns","umas",
    "os","as","e","o","a","no","na","nos","nas","por","se","ao","aos",
    "dos","das","é","foi","são","ser","tem","há","como","mais","menos",
    "já","também","entre","sobre","até","após","antes","durante"
  ]);

  static limpar(html) {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[^;]+;/g, " ") // Remove entidades HTML
      .replace(/\s+/g, " ")
      .trim();
  }

  static normalizar(palavra) {
    return palavra
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
  }

  static gerarResumo(texto, numFrases = CONFIG.resumo.numeroFrases) {
    // Remove múltiplas quebras de linha e espaços
    texto = texto.replace(/\n{3,}/g, '\n\n').trim();
    
    const frases = texto.split(/(?<=[.!?])\s+/).filter(f => f.length > 20);
    
    if (frases.length <= numFrases) {
      return texto;
    }

    const frequencias = this.calcularFrequencias(frases);
    const frasesPontuadas = this.pontuarFrases(frases, frequencias);
    
    const melhores = frasesPontuadas
      .sort((a, b) => b.score - a.score)
      .slice(0, numFrases)
      .sort((a, b) => a.idx - b.idx)
      .map(f => f.frase);

    const resumo = melhores.join(" ").trim();
    return /[.!?]$/.test(resumo) ? resumo : resumo + ".";
  }

  static calcularFrequencias(frases) {
    const freq = {};
    
    for (const frase of frases) {
      const palavras = frase
        .split(/\W+/)
        .map(p => this.normalizar(p))
        .filter(p => p && p.length > 2 && !this.stopwords.has(p));
      
      for (const palavra of palavras) {
        freq[palavra] = (freq[palavra] || 0) + 1;
      }
    }
    
    return freq;
  }

  static pontuarFrases(frases, frequencias) {
    return frases.map((frase, idx) => {
      const palavras = frase
        .split(/\W+/)
        .map(p => this.normalizar(p))
        .filter(p => p && frequencias[p]);
      
      const score = palavras.reduce((sum, palavra) => sum + frequencias[palavra], 0);
      const comprimento = frase.split(" ").length;
      const bonus = comprimento > 8 && comprimento < 30 ? 0.5 : 0;
      
      return { frase: frase.trim(), score: score + bonus, idx };
    });
  }
}

// ------------------------------
// Classe para Requisições HTTP
// ------------------------------
class HttpClient {
  static async fetchComProxy(url, proxyIndex = 0) {
    const proxies = CONFIG.proxies;
    
    for (let i = proxyIndex; i < proxies.length; i++) {
      const proxy = proxies[i];
      console.log(`Tentando com proxy: ${proxy.name}`);
      
      try {
        const proxyUrl = proxy.url(url);
        const response = await fetch(proxyUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/rss+xml, application/xml, text/xml, */*'
          },
          signal: AbortSignal.timeout(5000) // 5 segundos timeout
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const text = await response.text();
        return { text, proxyUsed: proxy.name };
        
      } catch (error) {
        console.warn(`Proxy ${proxy.name} falhou:`, error.message);
        continue;
      }
    }
    
    throw new Error("Todos os proxies falharam");
  }

  static async fetchDireto(url) {
    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json, application/rss+xml, application/xml, text/xml, */*'
        },
        signal: AbortSignal.timeout(5000)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('json')) {
        return await response.json();
      }
      
      return await response.text();
    } catch (error) {
      console.error(`Fetch direto falhou para ${url}:`, error);
      throw error;
    }
  }

  static async fetchRSS(url, semProxy = false) {
    try {
      let xmlText;
      
      if (semProxy) {
        xmlText = await this.fetchDireto(url);
      } else {
        const result = await Utils.retry(() => this.fetchComProxy(url));
        xmlText = result.text;
      }
      
      // Verifica se é JSON (para fontes alternativas)
      if (typeof xmlText === 'object') {
        return xmlText;
      }
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, "application/xml");
      
      // Verifica se houve erro no parsing
      const parserError = doc.querySelector("parsererror");
      if (parserError) {
        throw new Error("XML inválido");
      }
      
      return doc;
    } catch (error) {
      console.error(`Erro ao buscar RSS de ${url}:`, error);
      return null;
    }
  }

  static async fetchTexto(url) {
    try {
      const result = await Utils.retry(() => this.fetchComProxy(url));
      return TextoUtils.limpar(result.text);
    } catch (error) {
      console.error(`Erro ao buscar página ${url}:`, error);
      return "";
    }
  }
}

// ------------------------------
// Classe para Gerenciamento de Notícias
// ------------------------------
class NoticiaService {
  static async buscarNoticiaPopular() {
    const todasNoticias = [];
    
    // Tenta buscar de todas as fontes em paralelo
    const promessas = CONFIG.fontes.map(fonte => 
      this.extrairNoticiaDeFonte(fonte).catch(() => null)
    );
    
    const resultados = await Promise.all(promessas);
    
    for (const noticia of resultados) {
      if (noticia) {
        todasNoticias.push(noticia);
      }
    }
    
    if (todasNoticias.length === 0) {
      // Fallback: usa notícia estática
      return {
        titulo: "Bem-vindo ao Meme Day!",
        link: "#",
        fonte: "Meme Day",
        resumo: "Estamos com dificuldades técnicas para buscar as notícias. Por favor, tente novamente mais tarde."
      };
    }
    
    // Retorna a primeira notícia válida
    console.log(`Total de notícias encontradas: ${todasNoticias.length}`);
    return todasNoticias[0];
  }

  static async extrairNoticiaDeFonte(fonte) {
    try {
      if (fonte.tipo === 'json') {
        return await this.extrairNoticiaJSON(fonte);
      }
      
      const xml = await HttpClient.fetchRSS(fonte.url, fonte.semProxy);
      if (!xml) return null;

      const item = xml.querySelector("item, entry"); // Suporta RSS e Atom
      if (!item) return null;

      const titulo = item.querySelector("title")?.textContent?.trim();
      const link = item.querySelector("link")?.textContent?.trim() || 
                   item.querySelector("link")?.getAttribute("href");

      if (titulo && link?.startsWith("http")) {
        console.log(`Notícia encontrada em ${fonte.nome}`);
        return { titulo, link, fonte: fonte.nome };
      }
    } catch (error) {
      console.error(`Erro ao extrair de ${fonte.nome}:`, error);
    }

    return null;
  }

  static async extrairNoticiaJSON(fonte) {
    try {
      const data = await HttpClient.fetchRSS(fonte.url, fonte.semProxy);
      
      if (data?.items?.length > 0) {
        const item = data.items[0];
        return {
          titulo: item.title,
          link: item.url || item.link,
          fonte: fonte.nome
        };
      }
    } catch (error) {
      console.error(`Erro ao processar JSON de ${fonte.nome}:`, error);
    }
    
    return null;
  }

  static async gerarResumo(url) {
    // Primeiro tenta buscar o texto completo
    const texto = await HttpClient.fetchTexto(url);
    
    if (!texto || texto.length < 100) {
      return "Resumo em construção... Acesse o link para ler a notícia completa.";
    }
    
    const trechoUtil = texto.slice(0, CONFIG.resumo.tamanhoMaxTexto);
    return TextoUtils.gerarResumo(trechoUtil);
  }
}

// ------------------------------
// Classe para Geração de Imagens
// ------------------------------
class ImagemService {
  static montarPrompt(titulo, resumo) {
    // Limita o tamanho do prompt
    const tituloLimpo = titulo.slice(0, 100);
    const resumoLimpo = resumo.slice(0, 200);
    
    return `${tituloLimpo}. ${resumoLimpo}. Digital illustration, warm colors, news style, clean composition.`;
  }

  static async gerar(titulo, resumo) {
    const prompt = this.montarPrompt(titulo, resumo);
    const { largura, altura } = CONFIG.imagem;
    
    // Alternativas de geradores de imagem
    const geradores = [
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${largura}&height=${altura}&nologo=true`,
      `https://source.unsplash.com/${largura}x${altura}/?news,${encodeURIComponent(titulo.split(' ')[0])}`
    ];
    
    return geradores[0]; // Usa Pollinations por padrão
  }

  static async carregarImagem(elemento, url, alt) {
    return new Promise((resolve, reject) => {
      elemento.setAttribute("aria-busy", "true");
      elemento.style.opacity = "0.7";
      
      const img = new Image();
      const timeout = setTimeout(() => {
        reject(new Error("Timeout ao carregar imagem"));
      }, CONFIG.imagem.timeout);

      img.onload = () => {
        clearTimeout(timeout);
        elemento.src = img.src;
        elemento.alt = alt;
        elemento.removeAttribute("aria-busy");
        elemento.style.opacity = "1";
        resolve();
      };

      img.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Falha ao carregar imagem"));
      };

      img.src = url;
    });
  }
}

// ------------------------------
// Classe Principal da Aplicação
// ------------------------------
class MemeDay {
  constructor() {
    this.elementos = this.inicializarElementos();
  }

  inicializarElementos() {
    const elementos = {};
    
    for (const [chave, seletor] of Object.entries(CONFIG.seletores)) {
      elementos[chave] = document.querySelector(seletor);
    }
    
    return elementos;
  }

  mostrarCarregando(mostrar = true) {
    if (this.elementos.containerCarregando) {
      this.elementos.containerCarregando.style.display = mostrar ? "block" : "none";
    }
  }

  mostrarErro(mensagem) {
    if (this.elementos.containerErro) {
      this.elementos.containerErro.innerHTML = `
        <strong>Ops!</strong> ${mensagem}
        <br><small>Tente recarregar a página.</small>
      `;
      this.elementos.containerErro.style.display = "block";
    }
  }

  limparErro() {
    if (this.elementos.containerErro) {
      this.elementos.containerErro.style.display = "none";
    }
  }

  formatarDataHora() {
    return new Date().toLocaleString("pt-BR", {
      dateStyle: "full",
      timeStyle: "short"
    });
  }

  async atualizarInterface(noticia, resumo) {
    // Remove skeletons e atualiza textos
    if (this.elementos.titulo) {
      this.elementos.titulo.textContent = noticia.titulo;
      this.elementos.titulo.classList.remove('skeleton');
    }
    
    if (this.elementos.resumo) {
      this.elementos.resumo.textContent = resumo || noticia.resumo || "Carregando resumo...";
      this.elementos.resumo.classList.remove('skeleton');
    }
    
    if (this.elementos.fonte) {
      this.elementos.fonte.textContent = noticia.fonte;
    }
    
    if (this.elementos.linkFonte) {
      this.elementos.linkFonte.href = noticia.link;
      this.elementos.linkFonte.setAttribute("title", `Ler notícia completa em ${noticia.fonte}`);
    }
    
    if (this.elementos.dataHora) {
      this.elementos.dataHora.textContent = this.formatarDataHora();
    }

    // Mostra o card principal
    const cardPrincipal = document.getElementById('noticia-principal');
    if (cardPrincipal) {
      cardPrincipal.style.display = 'block';
    }

    // Atualiza imagem
    if (this.elementos.imagem) {
      try {
        const urlImagem = await ImagemService.gerar(noticia.titulo, resumo);
        await ImagemService.carregarImagem(
          this.elementos.imagem, 
          urlImagem, 
          `Ilustração: ${noticia.titulo}`
        );
      } catch (error) {
        console.warn("Usando imagem placeholder:", error.message);
        this.elementos.imagem.src = CONFIG.imagem.placeholder;
        this.elementos.imagem.alt = "Imagem padrão do Meme Day";
        this.elementos.imagem.style.opacity = "1";
      }
    }
  }

  async iniciar() {
    try {
      this.limparErro();
      this.mostrarCarregando(true);

      // Busca notícia
      const noticia = await NoticiaService.buscarNoticiaPopular();
      
      // Atualiza interface imediatamente com o que temos
      await this.atualizarInterface(noticia, "Carregando resumo...");
      
      // Gera resumo (se não for notícia de fallback)
      if (noticia.link !== "#") {
        const resumo = await NoticiaService.gerarResumo(noticia.link);
        await this.atualizarInterface(noticia, resumo);
      }
      
    } catch (error) {
      console.error("Erro no Meme Day:", error);
      this.mostrarErro("Não foi possível carregar as notícias. Verifique sua conexão.");
    } finally {
      this.mostrarCarregando(false);
    }
  }
}

// ------------------------------
// Inicialização
// ------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const app = new MemeDay();
  app.iniciar();
});

// Service Worker para cache offline (opcional)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
