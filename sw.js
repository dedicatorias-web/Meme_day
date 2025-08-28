// Verifica se o Service Worker está disponível e o arquivo existe
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('ServiceWorker registrado com sucesso:', registration.scope);
      })
      .catch(err => {
        console.error('Falha no registro do ServiceWorker:', err);
      });
  });
}
