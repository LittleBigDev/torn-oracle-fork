// Fork : onglet Assist, sous Tracked items, avertissement quand l'argent en main ne paie pas une valise pleine
// d'un objet suivi (le suivi lui-même est natif depuis 2.6.9 : « Track the best items »).
const CashWarning = (() => {
  "use strict";

  // Pays du vol en cours, sinon destination choisie sur la page, sinon celle du plan
  function target() {
    const trip = Trip.get();
    const leg = trip.active ? Trip.currentLeg() : null;
    return { leg, code: trip.country || Page.selectedDestination() || (leg && leg.country) };
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
    if (Trip.get().phase === "inbound") return "";
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

  return { warning };
})();
