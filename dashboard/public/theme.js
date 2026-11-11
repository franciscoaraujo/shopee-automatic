// Aplica o tema salvo antes da pintura (evita flash). Carregado no <head>.
(function () {
  var t = localStorage.getItem('obs-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();
