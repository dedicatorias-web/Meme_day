"use strict";

/**
 * Meme Day - Sistema de agregação de notícias com geração de imagens
 * @module MemeDay
 */

// ------------------------------
// Configuração e Constantes
// ------------------------------
const CONFIG = {
  fontes: [
    { nome: "G1", url: "https://g1.globo.com/dynamo/mais-lidas/rss2.xml" },
    { nome: "UOL", url: "https://noticias.uol.com.br/ultimas/index.xml" },
    { nome: "Google News", url: "https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419" }
  ],
  imagem: {
    largura: 1280,
    altura: 720,
    placeholder: "assets/images/imagem.png",
    timeout: 6000
  },
  resumo: {
    numeroFrases: 3,
    tamanhoMaxTexto: 8000
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
    const frases = texto.split(/(?<=[.!?])\s+/).filter(f => f.length > 0);
    
    if (frases.length <= numFrases) {
      return texto;
    }

    // Calcula frequência de palavras
    const frequencias = this.calcularFrequencias(frases);
    
    // Pontua frases
    const frasesPontuadas = this.pontuarFrases(frases, frequencias);
    
    // Seleciona melhores e mantém ordem original
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
        .filter(p => p && !this.stopwords.has(p));
      
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
      const bonus = comprimento > 8 ? 0 : 0.5;
      
      return { frase: frase.trim(), score: score + bonus, idx };
    });
  }
}

// ------------------------------
// Classe para Requisições HTTP
// ------------------------------
class HttpClient {
  static async fetchComProxy(url) {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  }

  static async fetchRSS(url) {
    try {
      const data = await this.fetchComProxy(url);
      const parser = new DOMParser();
      return parser.parseFromString(data.contents, "application/xml");
    } catch (error) {
      console.error(`Erro ao buscar RSS de ${url}:`, error);
      return null;
    }
  }

  static async fetchTexto(url) {
    try {
      const data = await this.fetchComProxy(url);
      return TextoUtils.limpar(data.contents);
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
    for (const fonte of CONFIG.fontes) {
      const noticia = await this.extrairNoticiaDeFonte(fonte);
      if (noticia) {
        console.log(`Fonte utilizada: ${fonte.nome}`);
        return noticia;
      }
    }
    
    throw new Error("Nenhuma fonte de notícias disponível");
  }

  static async extrairNoticiaDeFonte(fonte) {
    const xml = await HttpClient.fetchRSS(fonte.url);
    if (!xml) return null;

    const item = xml.querySelector("item");
    if (!item) return null;

    const titulo = item.querySelector("title")?.textContent?.trim();
    const link = item.querySelector("link")?.textContent?.trim();

    if (titulo && link?.startsWith("http")) {
      return { titulo, link, fonte: fonte.nome };
    }

    return null;
  }

  static async gerarResumo(url) {
    const texto = await HttpClient.fetchTexto(url);
    if (!texto) {
      return "Resumo indisponível no momento.";
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
    return [
      titulo,
      resumo,
      "Ilustração digital flat, cores quentes e alto contraste, estilo Meme Day.",
      "Composição centrada, limpa, sem texto na imagem, visual moderno."
    ].join(" ");
  }

  static async gerar(titulo, resumo) {
    const prompt = this.montarPrompt(titulo, resumo);
    const { largura, altura } = CONFIG.imagem;
    
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${largura}&height=${altura}`;
  }

  static async carregarImagem(elemento, url, alt) {
    return new Promise((resolve, reject) => {
      elemento.setAttribute("aria-busy", "true");
      elemento.style.opacity = "0.7";
      
      const timeout = setTimeout(() => {
        reject(new Error("Timeout ao carregar imagem"));
      }, CONFIG.imagem.timeout);

      elemento.onload = () => {
        clearTimeout(timeout);
        elemento.removeAttribute("aria-busy");
        elemento.style.opacity = "1";
        resolve();
      };

      elemento.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Falha ao carregar imagem"));
      };

      elemento.src = url;
      elemento.alt = alt;
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
      this.elementos.containerErro.textContent = mensagem;
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
    // Atualiza textos
    if (this.elementos.titulo) {
      this.elementos.titulo.textContent = noticia.titulo;
    }
    
    if (this.elementos.resumo) {
      this.elementos.resumo.textContent = resumo;
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
      }
    }
  }

  async iniciar() {
    try {
      this.limparErro();
      this.mostrarCarregando(true);

      // Busca notícia
      const noticia = await NoticiaService.buscarNoticiaPopular();
      
      // Gera resumo
      const resumo = await NoticiaService.gerarResumo(noticia.link);
      
      // Atualiza interface
      await this.atualizarInterface(noticia, resumo);
      
    } catch (error) {
      console.error("Erro no Meme Day:", error);
      this.mostrarErro("Não foi possível carregar a notícia do dia. Tente novamente mais tarde.");
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
