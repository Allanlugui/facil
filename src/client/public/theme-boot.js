/*
 * Aplica o tema salvo antes do primeiro render para evitar o "piscar" do tema
 * Clássico. Fica em arquivo externo (e não inline) para a CSP poder usar
 * script-src 'self' sem 'unsafe-inline'.
 */
(function () {
  try {
    var savedTheme = localStorage.getItem("facil.theme");
    if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);
  } catch {
    /* navegador sem localStorage: segue com o tema padrão */
  }
})();
