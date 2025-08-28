"use strict";

/**
 * Meme Day - Sistema de Notícias com Imagens Geradas por IA
 * Versão 5.0 - Otimizado para Desempenho e Resiliência
 */

// Configurações Globais
const CONFIG = {
  // Proxies para contornar CORS
  proxies: [
    { 
      name: 'AllOrigins', 
      url: (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}` 
    },
    { 
      name: 'CORS Proxy', 
      url: (target) => `https://corsproxy.io/?${encodeURIComponent(target)}` 
    },
    { 
      name: 'ProxyServer', 
      url: (target) => `https://proxy.cors.sh/?url=${encodeURIComponent(target)}` 
    }
  ],

  // Fontes de notícias
  fontesNoticias: [
    { 
      nome: 'Google News BR', 
      url: 'https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419', 
      tipo: 'rss' 
    },
    { 
      nome: 'G1', 
      url: 'https://g1.globo.com/rss/g1/', 
      tipo: 'rss' 
    },
    { 
      nome: 'BBC Brasil', 
      url: 'https://www.bbc.com/portuguese/brasil/rss.xml', 
      tipo: 'rss' 
    }
  ],

  // Notícias de fallback (quando todas as fontes falharem)
  fallbackNoticias: [
    {
      titulo: "Avanços na Energia Renovável no Brasil",
      resumo: "O Brasil se consolida como líder global em energia limpa com novos investimentos em solar e eólica.",
      fonte: "Meme Day Archive",
      link: "https://www.google.com/search?q=energia+renovavel+brasil+2024"
    },
    {
      titulo: "Inteligência Artificial Transformando Indústrias",
      resumo: "Empresas brasileiras adotam IA para revolucionar processos produtivos e serviços.",
      fonte: "Meme Day Archive",
      link: "https://www.google.com/search?q=ia+industrias+brasil"
    }
  ],

  // Configurações de imagem
  imagem: {
    largura: 1280,
    altura: 720,
    timeout: 5000,
    placeholder: 'data:image/svg+xml,...' // SVG base64 para placeholder
  },

  // Seletores DOM
  seletoresDOM: {
    titulo: '[data-element="titulo"]',
    resumo: '[data-element="resumo"]',
    fonte: '[data-element="fonte"]',
    imagem: '[data-element="imagem"]',
    erro: '[data-element="erro"]',
    carregando: '[data-element="carregando"]'
  },

  // Configurações de retry
  retryConfig: {
    maxTentativas: 3,
    delayBase: 500 // ms
  }
};

// Utilitários
const Utils = {
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  formatarData() {
    return new Date().toLocaleString('pt-BR', { 
      dateStyle: 'full', 
      timeStyle: 'short' 
    });
  },

  limparHTML(str) {
    return str.replace(/<\/?[^>]+(>|$)/g, '')
              .replace(/&[^;]+;/g, '')
              .trim();
  },

  normalizarTexto(texto) {
    return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }
};

// Cliente HTTP com Retry e Proxies
class HttpClient {
  static async fetchComRetry(url, options = {}, tentativas = 0) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(CONFIG.imagem.timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      if (tentativas < CONFIG.retryConfig.maxTentativas - 1) {
        const delay = CONFIG.retryConfig.delayBase * (2 ** tentativas);
        await Utils.sleep(delay);
        return this.fetchComRetry(url, options, tentativas + 1);
      }
      throw error;
    }
  }

  static async fetchComProxy(urlOriginal) {
    const erros = [];

    for (const proxy of CONFIG.proxies) {
      try {
        const proxyUrl = proxy.url(urlOriginal);
        console.log(`Tentando proxy: ${proxy.name}`);
        return await this.fetchComRetry(proxyUrl);
      } catch (error) {
        erros.push({ proxy: proxy.name, error: error.message });
        console.warn(`Proxy ${proxy.name} falhou:`, error.message);
      }
    }

    console.error('Todos os proxies falharam:', erros);
    throw new Error('Todos os proxies falharam');
  }

  static async fetchRSS(url) {
    try {
      const xmlText = await this.fetchComProxy(url);
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'application/xml');
      
      // Verifica erros de parsing
      if (doc.querySelector('parsererror')) {
        throw new Error('XML inválido');
      }
      
      return doc;
    } catch (error) {
      console.error(`Erro ao buscar RSS de ${url}:`, error);
      return null;
    }
  }
}

// Processamento de Notícias
class NoticiaProcessor {
  static async buscarNoticiaPrincipal() {
    const promessas = CONFIG.fontesNoticias.map(fonte => 
      this.buscarNoticiaDeFonte(fonte).catch(() => null)
    );
    
    const resultados = await Promise.all(promessas);
    const noticiaValida = resultados.find(n => n);
    
    return noticiaValida || this.obterNoticiaFallback();
  }

  static async buscarNoticiaDeFonte(fonte) {
    const doc = await HttpClient.fetchRSS(fonte.url);
    if (!doc) return null;

    const item = doc.querySelector('item, entry');
    if (!item) return null;

    const titulo = item.querySelector('title')?.textContent?.trim();
    const link = item.querySelector('link')?.textContent?.trim() || 
                 item.querySelector('link')?.getAttribute('href');
    
    if (titulo && link) {
      const resumo = await this.gerarResumo(item.querySelector('description')?.textContent || '');
      return {
        titulo,
        link,
        fonte: fonte.nome,
        resumo
      };
    }
    return null;
  }

  static async gerarResumo(textoCompleto) {
    const textoLimpo = Utils.limparHTML(textoCompleto);
    const frases = textoLimpo.split('. ')
                            .filter(f => f.length > 40)
                            .slice(0, 3);
    
    return frases.join('. ') + '.';
  }

  static obterNoticiaFallback() {
    return {
      ...Utils.escolherAleatorio(CONFIG.fallbackNoticias),
      isFallback: true
    };
  }

  static escolherAleatorio(array) {
    return array[Math.floor(Math.random() * array.length)];
  }
}

// Gerenciamento de Imagens
class ImageGenerator {
  static async gerarImagem(titulo, resumo) {
    const prompt = this.criarPrompt(titulo, resumo);
    const { largura, altura } = CONFIG.imagem;

    const fontesImagem = [
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${largura}&height=${altura}&nologo=true`,
      `https://source.unsplash.com/${largura}x${altura}/?news,brazil`,
      CONFIG.imagem.placeholder
    ];

    for (const url of fontesImagem) {
      try {
        await this.verificarURL(url);
        return url;
      } catch {
        continue;
      }
    }

    throw new Error('Não foi possível gerar imagem');
  }

  static criarPrompt(titulo, resumo) {
    return [
      titulo.slice(0, 80),
      resumo.slice(0, 160),
      'Estilo digital moderno, cores vibrantes, composição limpa'
    ].join(' ');
  }

  static async verificarURL(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(url, { 
        method: 'HEAD',
        signal: controller.signal 
      });

      clearTimeout(timeoutId);
      if (!response.ok) throw new Error('Imagem indisponível');
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}

// Controlador da Interface
class UIController {
  constructor() {
    this.elementos = this.inicializarElementos();
    this.estado = {
      imagemCarregada: false
    };
  }

  inicializarElementos() {
    const elementos = {};
    for (const [chave, seletor] of Object.entries(CONFIG.seletoresDOM)) {
      elementos[chave] = document.querySelector(seletor);
    }
    return elementos;
  }

  mostrarCarregamento(mostrar = true) {
    this.elementos.carregando.style.display = mostrar ? 'block' : 'none';
  }

  mostrarErro(mensagem) {
    this.elementos.erro.textContent = mensagem;
    this.elementos.erro.style.display = 'block';
  }

  limparErro() {
    this.elementos.erro.style.display = 'none';
  }

  async atualizarInterface(noticia) {
    this.elementos.titulo.textContent = noticia.titulo;
    this.elementos.resumo.textContent = noticia.resumo;
    this.elementos.fonte.textContent = `${noticia.fonte}${noticia.isFallback ? ' (Arquivo)' : ''}`;
    
    // Carrega imagem apenas uma vez
    if (!this.estado.imagemCarregada) {
      try {
        const urlImagem = await ImageGenerator.gerarImagem(noticia.titulo, noticia.resumo);
        await this.carregarImagem(urlImagem);
        this.estado.imagemCarregada = true;
      } catch (error) {
        console.warn('Usando imagem padrão:', error);
        this.elementos.imagem.src = CONFIG.imagem.placeholder;
      }
    }
  }

  async carregarImagem(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.elementos.imagem.src = url;
        this.elementos.imagem.style.opacity = 1;
        resolve();
      };
      img.onerror = reject;
      img.src = url;
    });
  }
}

// Aplicação Principal
class MemeDayApp {
  constructor() {
    this.ui = new UIController();
  }

  async iniciar() {
    try {
      this.ui.limparErro();
      this.ui.mostrarCarregamento();

      const noticia = await NoticiaProcessor.buscarNoticiaPrincipal();
      await this.ui.atualizarInterface(noticia);
      
    } catch (error) {
      console.error('Erro crítico:', error);
      this.ui.mostrarErro('Não foi possível carregar o conteúdo. Tente recarregar a página.');
    } finally {
      this.ui.mostrarCarregamento(false);
    }
  }
}

// Inicialização da Aplicação
document.addEventListener('DOMContentLoaded', () => {
  const app = new MemeDayApp();
  app.iniciar();
});

// Service Worker (opcional)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(registration => {
        console.log('ServiceWorker registrado com sucesso:', registration.scope);
      })
      .catch(err => {
        console.error('Falha no registro do ServiceWorker:', err);
      });
  });
}
