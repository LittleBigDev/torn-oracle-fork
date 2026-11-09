// Fork : au décollage, les Tracked items d'Assist sont refaits à partir de la boutique de la destination.
// Vol du plan avec self-hosp prévu (objet réglé dans Assist) : liste vide, Assist attend l'objet du plan.
const AutoTrack = (() => {
  "use strict";

  function margin(item) {
    return Data.margin(item.market_value, item.sell_price, item.cost, null, item.name);
  }

  // Tri « Best margin » de l'onglet Shops ; Settings garde les MAX_TRACKED premiers
  function profitable(items) {
    return items
      .map((item) => ({ id: item.item_id, name: item.name, margin: margin(item) }))
      .filter((row) => row.margin > 0)
      .sort((a, b) => (b.margin - a.margin) || a.name.localeCompare(b.name))
      .map(({ id, name }) => ({ id, name }));
  }

  function show() {
    Assist.paint();
    Panel.refresh("assist", true);
  }

  async function fill(code, planned) {
    Panel.flash("", "", "assist");
    Settings.set("assist_track", []);
    show();
    if (planned && Settings.get("assist_kit").hosp) return;
    try {
      const shop = await Oracle.shop(code);
      Settings.set("assist_track", profitable(shop.items || []));
      show();
    } catch (err) {
      Env.log.warn("auto track failed", err.message);
      Panel.flash("Could not read the shop to fill Tracked items.", "warn", "assist");
    }
  }

  function departed(ev) {
    const code = Trip.get().country;
    return code ? fill(code, !!ev.leg && !ev.offPlan) : undefined;
  }

  // Pays du vol en cours, sinon destination choisie sur la page, sinon celle du plan
  function target() {
    const trip = Trip.get();
    const leg = trip.active ? Trip.currentLeg() : null;
    return { leg, code: trip.country || Page.selectedDestination() || (leg && leg.country) };
  }

  function manual() {
    const { leg, code } = target();
    if (!code) { Panel.flash("Pick a destination first.", "warn", "assist"); return undefined; }
    return fill(code, !!leg && !leg.runtime.flewTo && leg.country === code);
  }

  // Avertissement de cash : boutique relue au plus une fois par minute, onglet Assist affiché
  const FRESH_MS = 60_000;
  let cash = null;
  let reading = false;

  async function read(code) {
    reading = true;
    let items = [];
    try {
      items = (await Oracle.shop(code)).items || [];
    } catch (err) {
      Env.log.warn("auto track cash check failed", err.message);
    }
    cash = { code, items, at: Date.now() };
    reading = false;
    Panel.refresh("assist");
  }

  // Argent en main affiché par Torn dans la barre latérale
  function wallet() {
    const el = document.getElementById("user-money");
    return el && el.dataset.money ? Number(el.dataset.money) : null;
  }

  function warning(track) {
    const { code } = target();
    if (!code) return "";
    const known = cash && cash.code === code;
    if (!reading && (!known || Date.now() - cash.at > FRESH_MS)) read(code);
    const money = wallet();
    if (!known || money === null) return "";
    const short = track.map((ref) => {
      const item = cash.items.find((i) => i.item_id === ref.id);
      if (!item) return null;
      const bag = Settings.get("capacity") + (item.type === Settings.get("extra_type") ? Settings.get("extra_slots") : 0);
      const cost = bag * item.cost;
      return cost > money ?`${Fmt.esc(item.name)} (${Fmt.esc(Fmt.money(cost))})` : null;
    }).filter(Boolean);
    if (!short.length) return "";
    return `<p class="o-note is-warn">Your cash (${Fmt.esc(Fmt.money(money))}) won't buy a full bag of ${short.join(", ")}.
      You won't be able to buy the maximum, so profit may be lower.</p>`;
  }

  return { departed, manual, warning };
})();

