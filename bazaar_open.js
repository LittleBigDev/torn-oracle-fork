// Fork : page de l'agence, bouton « Open bazaar » à gauche de TRAVEL, affiché seulement si le bazaar
// existe, contient des objets et est fermé. Requêtes relevées le 12/11/2026 (GET, session Torn) :
// état et contenu : bazaar.php?sid=bazaarData&step=getBazaarContent&ID= (state.isBazaarExists,
// state.isClosed, totalQuantity ; l'API Torn et weav3r ne voient pas les objets d'un bazaar fermé) ;
// ouverture, un clic, une requête : step=openBazaar (fermeture : step=closeBazaar).
const BazaarOpen = (() => {
  "use strict";

  const RECHECK_MS = 30_000;
  let state = { at: 0, show: false };
  let checking = false;

  function rfc() {
    const m = /(?:^|;\s*)rfc_v=([^;]+)/.exec(document.cookie || "");
    return m ? m[1] : "";
  }

  function bazaarData(step) {
    return fetch("/bazaar.php?sid=bazaarData&step=" + step + "&rfcv=" + rfc(),
      { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } });
  }

  function travelButton() {
    const btn = document.querySelector('[class*="departPanel"] > button.torn-btn');
    return btn && /^travel$/i.test(btn.textContent.trim()) ? btn : null;
  }

  async function check() {
    if (checking || Date.now() - state.at < RECHECK_MS) return;
    checking = true;
    let show = false;
    try {
      const d = await (await bazaarData("getBazaarContent&ID=")).json();
      show = !!(d.state && d.state.isBazaarExists && d.state.isClosed) && Number(d.totalQuantity) > 0;
    } catch (err) {
      Env.log.warn("bazaar state failed", err.message);
    } finally {
      state = { at: Date.now(), show };
      checking = false;
    }
    paint();
  }

  async function open(btn) {
    btn.disabled = true;
    try {
      const res = await bazaarData("openBazaar");
      if (!res.ok) throw new Error("HTTP " + res.status);
      state = { at: Date.now(), show: false };
      btn.remove();
    } catch (err) {
      Env.log.warn("open bazaar failed", err.message);
      btn.disabled = false;
      btn.textContent = "Retry: open bazaar";
    }
  }

  function paint() {
    const travel = travelButton();
    const mine = document.querySelector(".o-bazaar-open");
    if (!travel || !state.show) { if (mine) mine.remove(); return; }
    if (mine) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "torn-btn o-bazaar-open";
    btn.style.marginRight = "8px";
    btn.title = "Your bazaar has items but is closed";
    btn.textContent = "Open bazaar";
    btn.addEventListener("click", () => open(btn));
    travel.before(btn);
  }

  function tick() {
    if (!travelButton()) return;
    paint();
    check();
  }

  function start() {
    new MutationObserver(tick).observe(document.body, { childList: true, subtree: true });
    tick();
  }

  return { start };
})();

