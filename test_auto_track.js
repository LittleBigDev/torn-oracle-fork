// Vérifie auto_track.js avec des doubles des modules d'Oracle. Usage : node test_auto_track.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const code = fs.readFileSync(path.join(__dirname, "auto_track.js"), "utf8");
const item = (item_id, name, margin) => ({ item_id, name, market_value: margin, sell_price: 0, cost: 0 });

async function run(ev, { country = "can", items = [], fail = false, hosp = null, manual = false, leg = null, selected = null, wallet = 0 } = {}) {
  const track = { list: [{ id: 1, name: "Old" }], asked: null, warned: 0 };
  const ctx = vm.createContext({
    Data: { margin: (value) => value },
    Assist: { paint() {} },
    Panel: { refresh() {}, flash(text) { if (text) track.warned += 1; } },
    Env: { log: { warn() {} } },
    Trip: { get: () => ({ country, active: !!leg }), currentLeg: () => leg },
    Page: { selectedDestination: () => selected },
    document: { getElementById: (id) => (id === "user-money" && wallet !== null ? { dataset: { money: String(wallet) } } : null) },
    Fmt: { esc: (s) => s, money: (n) => "$" + n },
    Settings: { get: (n) => ({ capacity: 25, extra_slots: 3, extra_type: "Flower" }[n] || { hosp }), set: (name, value) => { assert.equal(name, "assist_track"); track.list = value; return true; } },
    Oracle: { shop: async (c) => { track.asked = c; if (fail) throw new Error("down"); return { items }; } },
  });
  const auto = vm.runInContext(code + "\nAutoTrack", ctx);
  await (manual ? auto.manual() : auto.departed(ev));
  track.auto = auto;
  return track;
}

const plain = (list) => JSON.parse(JSON.stringify(list));

(async () => {
  const shop = [item(3, "Low", 10), item(4, "Loss", -5), item(5, "High", 900), item(6, "Zero", 0), item(7, "Unknown", null)];

  const kit = { id: 2, name: "Hosp" };
  let t = await run({ leg: { item_name: "Dahlia" } }, { items: shop, hosp: kit });
  assert.deepEqual(plain(t.list), [], "plan avec self-hosp : liste vide");
  assert.equal(t.asked, null, "plan avec self-hosp : boutique non lue");

  t = await run({ leg: { item_name: "Dahlia" } }, { items: shop });
  assert.deepEqual(plain(t.list), [{ id: 5, name: "High" }, { id: 3, name: "Low" }], "rentables, marge décroissante");
  assert.equal(t.asked, "can");

  t = await run({ offPlan: true }, { items: shop, hosp: kit });
  assert.equal(t.list.length, 2, "sans plan, self-hosp réglé : liste remplie");

  t = await run({ leg: { item_name: "Dahlia" }, offPlan: true }, { items: shop, hosp: kit });
  assert.equal(t.list.length, 2, "hors plan vers un autre pays : liste remplie");

  t = await run({ leg: { item_name: "Dahlia" } }, { fail: true });
  assert.deepEqual(plain(t.list), [], "boutique illisible : liste vide");
  assert.equal(t.warned, 1, "boutique illisible : avertissement");

  t = await run({ leg: { item_name: "Dahlia" } }, { country: null });
  assert.equal(t.list[0].name, "Old", "destination inconnue : liste intacte");

  const leg = { country: "can", runtime: {} };
  t = await run(null, { manual: true, items: shop, hosp: kit, leg, country: null });
  assert.deepEqual(plain(t.list), [], "bouton, à Torn, plan avec self-hosp : liste vide");

  t = await run(null, { manual: true, items: shop, hosp: kit, leg, country: null, selected: "jap" });
  assert.equal(t.asked, "jap", "bouton : la destination choisie passe avant le plan");
  assert.equal(t.list.length, 2, "bouton, autre pays que le plan : liste remplie");

  t = await run(null, { manual: true, items: shop, country: "uni" });
  assert.equal(t.asked, "uni", "bouton en vol : pays du vol");

  t = await run(null, { manual: true, country: null });
  assert.equal(t.warned, 1, "bouton sans destination : avertissement");
  assert.equal(t.list[0].name, "Old", "bouton sans destination : liste intacte");

  const priced = [
    { item_id: 5, name: "Rose", type: "Flower", cost: 1000, market_value: 2000 },
    { item_id: 6, name: "Pill", type: "Drug", cost: 1000, market_value: 2000 },
  ];
  const refs = [{ id: 5, name: "Rose" }, { id: 6, name: "Pill" }, { id: 9, name: "Elsewhere" }];
  const settle = () => new Promise((done) => setImmediate(done));
  const warned = async (wallet) => {
    const r = await run(null, { manual: true, items: priced, wallet });
    assert.equal(r.auto.warning(refs), "", "cash : rien avant la lecture");
    await settle();
    return r.auto.warning(refs);
  };

  let w = await warned(27000);
  assert.ok(w.includes("Rose ($28000)") && !w.includes("Pill"), "cash : capacité avec places en plus par catégorie");
  w = await warned(24000);
  assert.ok(w.includes("Rose") && w.includes("Pill ($25000)") && !w.includes("Elsewhere"), "cash : plusieurs objets");
  assert.equal(await warned(28000), "", "cash : assez d'argent, pas d'avertissement");
  assert.equal(await warned(null), "", "cash : montant absent de la page, pas d'avertissement");
  assert.ok((await warned(0)).includes("Rose"), "cash : 0 $ en main");

  console.log("ok");
})().catch((e) => { console.error(e); process.exit(1); });
