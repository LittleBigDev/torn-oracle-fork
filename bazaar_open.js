// Fork : page de l'agence, bouton « Open bazaar » à gauche de TRAVEL, affiché seulement si le bazaar
// existe, contient des objets et est fermé (API v2 user/bazaar). Un clic, une requête :
// bazaar.php?sid=bazaarData&step=openBazaar (GET, relevé le 12/11/2026 ; fermeture : step=closeBazaar).
const BazaarOpen = (() => {
  "use strict";

  const RECHECK_MS = 30_000;
  let state = { at: 0, show: false };
  let checking = false;

  function rfc() {
    const m = /(?:^|;\s*)rfc_v=([^;]+)/.exec(document.cookie || "");
    return m ? m[1] : "";
  }

  function travelButton() {
    const btn = document.querySelector('[class*="departPanel"] > button.torn-btn');
    return btn && /^travel$/i.test(btn.textContent.trim()) ? btn : null;
  }

  // Requête de lecture de la page du bazaar ; réponse illisible : on suppose des objets (bouton affiché)
  async function hasItems() {
    const uid = (/(?:^|;\s*)uid=(\d+)/.exec(document.cookie || "") || [])[1];
    try {
      const res = await fetch("/bazaar.php?sid=bazaarData&step=getBazaarItems&start=0&ID=" + uid
        + "&order=default&by=asc&categorised=0&limit=1&rfcv=" + rfc(),
        { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } });
      const d = await res.json();
      const n = d && (d.total ?? (Array.isArray(d.list) ? d.list.length : undefined));
      Env.log.info("bazaar items: " + n);
      return n === undefined ? true : Number(n) > 0;
    } catch (err) {
      return true;
    }
  }

  async function check() {
    if (checking || Date.now() - state.at < RECHECK_MS || !Torn.haveKey()) return;
    checking = true;
    try {
      const d = await Torn.get("user/bazaar", { ttl: 0 });
      // Bazaar fermé : l'API renvoie une liste vide, les objets se lisent sur la page du bazaar
      state = { at: Date.now(), show: !!d.bazaar_exists && !d.bazaar_is_open && await hasItems() };
    } catch (err) {
      state = { at: Date.now(), show: false };
    } finally {
      checking = false;
    }
    paint();
  }

  async function open(btn) {
    btn.disabled = true;
    try {
      const res = await fetch("/bazaar.php?sid=bazaarData&step=openBazaar&rfcv=" + rfc(),
        { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } });
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

