// ==UserScript==
// @name         Torn Oracle: Travel (fork Workaround)
// @namespace    workaround.oracle-fork
// @version      2.6.5-fork.2
// @downloadURL  https://raw.githubusercontent.com/LittleBigDev/torn-oracle-fork/main/torn-oracle-fork.user.js
// @updateURL    https://raw.githubusercontent.com/LittleBigDev/torn-oracle-fork/main/torn-oracle-fork.user.js
// @description  Fork de Torn Oracle: Travel 2.6.5 (Ruinbringer) : profits calculés sur le meilleur canal de vente de chaque objet (traders Wardogs, item market, ville), alerte d'export sur toutes les pages.
// @author       Ruinbringer
// @license      GPL-3.0-only
// @supportURL   https://discord.gg/uCkYscEJzr
// @match        https://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_addStyle
// @connect      api.torn.com
// @connect      torn-oracle.duckdns.org
// @connect      weav3r.dev
// @run-at       document-idle
// @noframes
// ==/UserScript==


(function () {
"use strict";

const Env = (() => {
  "use strict";

  const isPDA = typeof window.flutter_inappwebview !== "undefined"
    || /TornPDA/i.test(navigator.userAgent || "");

  const hasGmXhr = typeof GM_xmlhttpRequest === "function";

  const hasPdaHttp = typeof PDA_httpGet === "function";

  const caps = {

    notify: typeof GM_notification === "function",

    xhr: hasGmXhr || hasPdaHttp,
    storage: typeof GM_getValue === "function" && typeof GM_setValue === "function",
    style: typeof GM_addStyle === "function",
  };

  function net(opts) {
    if (hasGmXhr) return GM_xmlhttpRequest(opts);
    return pda(opts);
  }

  function pda(opts) {
    const method = String(opts.method || "GET").toUpperCase();
    const headers = opts.headers || {};
    let settled = false;
    const fire = (cb, arg) => {
      if (settled) return;
      settled = true;
      if (typeof cb === "function") cb(arg);
    };
    let p;
    try {
      if (method === "POST") p = PDA_httpPost(opts.url, headers, opts.data ?? "");
      else if (method === "DELETE") p = PDA_httpDelete(opts.url, headers);
      else p = PDA_httpGet(opts.url, headers);
    } catch (e) { fire(opts.onerror, e); return; }
    if (!p || typeof p.then !== "function") { fire(opts.onerror); return; }
    const timer = setTimeout(() => fire(opts.ontimeout), opts.timeout || 30_000);
    p.then(
      (res) => { clearTimeout(timer); fire(opts.onload, res); },
      (err) => { clearTimeout(timer); fire(opts.onerror, err); },
    );
  }

  const suspendable = isPDA || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || "");

  const PREFIX = "oracle:";

  function read(key, fallback) {
    try {
      const raw = caps.storage
        ? GM_getValue(PREFIX + key, undefined)
        : window.localStorage.getItem(PREFIX + key);
      if (raw === undefined || raw === null || raw === "") return fallback;
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
      log.warn("storage read failed for " + key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      const raw = JSON.stringify(value);
      if (caps.storage) GM_setValue(PREFIX + key, raw);
      else window.localStorage.setItem(PREFIX + key, raw);
      return true;
    } catch (e) {
      log.warn("storage write failed for " + key, e);
      return false;
    }
  }

  const hasPdaStore = typeof PDA_storage === "object" && PDA_storage !== null;
  const kept = {};

  async function ready() {
    if (!hasPdaStore) return;
    try {
      const all = await Promise.race([
        PDA_storage.loadAll(),
        new Promise((r) => setTimeout(() => r(null), 3000)),
      ]);
      if (all && typeof all === "object") Object.assign(kept, all);
    } catch (e) {
      log.warn("PDA storage read failed", e);
    }
  }

  function keep(key, value) {
    if (!hasPdaStore) return;
    kept[key] = value;
    const fail = (e) => log.warn("PDA storage write failed for " + key, e);
    try { Promise.resolve(PDA_storage.set(key, value)).catch(fail); } catch (e) { fail(e); }
  }

  if (hasPdaStore) {
    document.addEventListener("visibilitychange", () => { if (visible()) ready(); });
    setInterval(() => { if (visible()) ready(); }, 60_000);
  }

  const durable = (key) => (hasPdaStore ? kept[key] ?? null : null);

  function drop(key) {
    try {
      if (typeof GM_deleteValue === "function") GM_deleteValue(PREFIX + key);
      else if (!caps.storage) window.localStorage.removeItem(PREFIX + key);
      else GM_setValue(PREFIX + key, "");
    } catch (e) {  }
  }

  const LOG_MAX = 300;
  const entries = [];

  function record(level, message, detail) {
    const row = { at: Date.now(), level, message, detail: fmtDetail(detail) };
    entries.push(row);
    if (entries.length > LOG_MAX) entries.splice(0, entries.length - LOG_MAX);
    if (level === "error" || level === "warn") {

      console[level === "error" ? "error" : "warn"]("[Torn Oracle]", message, detail || "");
    }
    return row;
  }

  function fmtDetail(detail) {
    if (detail === undefined || detail === null) return null;
    if (typeof detail === "string") return detail;
    if (detail instanceof Error) return detail.message;
    try { return JSON.stringify(detail); } catch (e) { return String(detail); }
  }

  const log = {
    info: (m, d) => record("info", m, d),
    warn: (m, d) => record("warn", m, d),
    error: (m, d) => record("error", m, d),

    event: (m, d) => record("event", m, d),
    entries: () => entries.slice(),
    clear: () => entries.splice(0, entries.length),
  };

  let lastTickAt = 0;

  const Clock = {
    now: () => Date.now(),
    markTick() {
      const prev = lastTickAt;
      lastTickAt = Date.now();
      return prev === 0 ? 0 : lastTickAt - prev;
    },

    sleptThrough(gapMs, expectedMs) {
      return gapMs > Math.max(3 * expectedMs, 90_000);
    },
  };

  function toast(title, body, onclick) {
    if (!caps.notify) return false;
    try {
      GM_notification({
        title: "Torn Oracle: " + title,
        text: body,
        timeout: 25_000,
        onclick: onclick || undefined,
      });
      return true;
    } catch (e) {
      log.warn("notification refused", e);
      return false;
    }
  }

  const tabId = Math.random().toString(36).slice(2) + Date.now().toString(36);

  function visible() {
    try { return document.visibilityState !== "hidden"; }
    catch (e) { return true; }
  }

  return {
    isPDA, suspendable, caps, tabId, visible,
    read, write, drop, ready, keep, durable,
    log, Clock, toast, net,
  };
})();

const Bus = (() => {
  "use strict";
  const handlers = new Map();
  return {
    on(topic, fn) {
      if (!handlers.has(topic)) handlers.set(topic, []);
      handlers.get(topic).push(fn);
    },
    emit(topic, payload) {
      for (const fn of handlers.get(topic) || []) {
        try { fn(payload); } catch (e) { Env.log.warn("handler for " + topic + " failed", e); }
      }
    },
  };
})();

const Data = (() => {
  "use strict";

  const TYPE_ORDER = ["standard", "airstrip", "wlt", "business"];

  const TRAVEL_TYPES = {
    standard: { label: "Standard", mult: 1.0 },
    airstrip: { label: "Airstrip", mult: 0.70 },
    wlt: { label: "Wind Lines Travel", mult: 0.50 },
    business: { label: "Business class", mult: 0.30 },
  };

  const COUNTRY_ROWS = [
    ["mex", "Mexico", [24, 17, 12, 7]],
    ["cay", "Cayman Islands", [33, 23, 17, 10]],
    ["can", "Canada", [39, 27, 19, 12]],
    ["haw", "Hawaii", [127, 89, 63, 38]],
    ["uni", "United Kingdom", [151, 106, 75, 45]],
    ["arg", "Argentina", [158, 111, 79, 47]],
    ["swi", "Switzerland", [166, 116, 83, 50]],
    ["jap", "Japan", [213, 149, 107, 64]],
    ["chi", "China", [229, 160, 114, 69]],
    ["uae", "UAE", [257, 180, 128, 77]],
    ["sou", "South Africa", [282, 197, 141, 85]],
  ];

  const COUNTRIES = {};
  for (const [code, name, minutes] of COUNTRY_ROWS) {
    COUNTRIES[code] = { code, name, minutes };
  }

  const CODE_BY_NAME = {};
  for (const c of Object.values(COUNTRIES)) CODE_BY_NAME[c.name.toLowerCase()] = c.code;

  const TRAVEL_BY_INDEX = {};
  TYPE_ORDER.forEach((code, i) => { TRAVEL_BY_INDEX[String(i + 1)] = code; });

  function flightMinutes(code, travelType) {
    const c = COUNTRIES[code];
    if (!c) return null;
    const idx = TYPE_ORDER.indexOf(travelType);
    if (idx >= 0) return c.minutes[idx];
    const t = TRAVEL_TYPES[travelType] || TRAVEL_TYPES.standard;
    return Math.round(c.minutes[0] * t.mult);
  }

  // Fork : taux des traders Wardogs par objet (généré par maj.py), sinon item market (85 %)
  const TAUX_TRADERS = {"African Violet": 0.98, "Aluminum Plate": 0.9, "Banana Orchid": 0.98, "Basalt Point": 0.9, "Blank Casino Chips": 0.9, "Bolt Cutters": 0.9, "Bonded Latex": 0.9, "Bottle of Sake": 0.95, "Bottle of Tequila": 0.95, "Camel Plushie": 0.98, "Cannabis": 0.95, "Card Skimmer": 0.9, "Ceibo Flower": 0.98, "Chalcedony Point": 0.9, "Chamois Plushie": 0.98, "Cherry Blossom": 0.98, "Chert Point": 0.9, "Claymore Mine": 0.95, "Crocus": 0.98, "Dahlia": 0.98, "Dog Treats": 0.9, "Dozen White Roses": 0.98, "Ecstasy": 0.95, "Edelweiss": 0.98, "Fireworks": 0.95, "Flash Grenade": 0.95, "Glow Stick": 0.9, "Gold Laptop": 0.9, "Grenade": 0.95, "HEG": 0.95, "Heather": 0.98, "Hydrochloric Acid": 0.9, "Inkwell": 0.9, "Jaguar Plushie": 0.98, "Ketamine": 0.95, "LSD": 0.95, "Large Suitcase": 0.9, "Lighter": 0.9, "Lion Plushie": 0.98, "Magnesium Shavings": 0.9, "Medium Suitcase": 0.9, "Meteorite Fragment": 0.9, "Monkey Plushie": 0.98, "Nessie Plushie": 0.98, "Neumune Tablet": 0.9, "Ninja Star": 0.95, "Obsidian Point": 0.9, "Opium": 0.95, "Orchid": 0.98, "PCP": 0.95, "PVC Cards": 0.9, "Panda Plushie": 0.98, "Patagonian Fossil": 0.9, "Peony": 0.98, "Potassium Nitrate": 0.9, "Printing Paper": 0.9, "Quartz Point": 0.9, "Quartzite Point": 0.9, "Red Fox Plushie": 0.98, "Shrooms": 0.95, "Small Suitcase": 0.9, "Smoke Grenade": 0.95, "Speed": 0.95, "Sports Sneakers": 0.9, "Stick Grenade": 0.95, "Stick of Dynamite": 0.9, "Stingray Plushie": 0.98, "Tear Gas": 0.95, "Throwing Knife": 0.95, "Tribulus Omanense": 0.98, "Trout": 0.95, "Vicodin": 0.95, "Wolverine Plushie": 0.98, "Xanax": 0.95, "Zip Ties": 0.9};
  const BOUTIQUES = {"9mm Uzi": "Big Al's Gun Shop", "AK-47": "Big Al's Gun Shop", "African Violet": "Bits 'n' Bobs", "Afro Comb": "Recycling Center", "Ambergris Lump": "Jewelry Store", "ArmaLite M-15A4": "Big Al's Gun Shop", "Axe": "Big Al's Gun Shop", "BT MP9": "Big Al's Gun Shop", "Banana Orchid": "Bits 'n' Bobs", "Bear Gall": "Nikeh Sports", "Bearer Bond": "Pawn Shop", "Bikini": "TC Clothing", "Blowgun": "Big Al's Gun Shop", "Bo Staff": "Big Al's Gun Shop", "Bottle of Sake": "Bits 'n' Bobs", "Bottle of Tequila": "Bits 'n' Bobs", "Bushmaster Carbon 15": "Big Al's Gun Shop", "Camel Plushie": "Bits 'n' Bobs", "Ceibo Flower": "Bits 'n' Bobs", "Chain Whip": "Big Al's Gun Shop", "Chamois Plushie": "Bits 'n' Bobs", "Cherry Blossom": "Bits 'n' Bobs", "Chopsticks": "Bits 'n' Bobs", "Claymore Mine": "Big Al's Gun Shop", "Claymore Sword": "Big Al's Gun Shop", "Cobra Derringer": "Big Al's Gun Shop", "Coconut Bra": "TC Clothing", "Combat Boots": "Big Al's Gun Shop", "Combat Gloves": "Big Al's Gun Shop", "Combat Helmet": "Big Al's Gun Shop", "Combat Pants": "Big Al's Gun Shop", "Combat Vest": "Big Al's Gun Shop", "Compass": "Bits 'n' Bobs", "Construction Helmet": "Big Al's Gun Shop", "Counterfeit Manga": "Pawn Shop", "Crazy Straw": "Recycling Center", "Cricket Bat": "Big Al's Gun Shop", "Crocus": "Bits 'n' Bobs", "Crossbow": "Big Al's Gun Shop", "Dahlia": "Bits 'n' Bobs", "Dart Board": "Recycling Center", "Desert Eagle": "Big Al's Gun Shop", "Diamond Bladed Knife": "Big Al's Gun Shop", "Diving Gloves": "TC Clothing", "Edelweiss": "Bits 'n' Bobs", "Elephant Statue": "Bits 'n' Bobs", "Enfield SA-80": "Big Al's Gun Shop", "Ephedrine Powder": "Pharmacy", "Ergotamine Ampoule": "Pharmacy", "Fire Hydrant": "Recycling Center", "Fireworks": "Big Al's Gun Shop", "Flail": "Big Al's Gun Shop", "Flak Jacket": "Big Al's Gun Shop", "Flamethrower": "Big Al's Gun Shop", "Flare Gun": "Big Al's Gun Shop", "Flash Grenade": "Big Al's Gun Shop", "Flexible Body Armor": "Big Al's Gun Shop", "Flippers": "TC Clothing", "Frying Pan": "Big Al's Gun Shop", "Grenade": "Big Al's Gun Shop", "Guandao": "Big Al's Gun Shop", "HEG": "Big Al's Gun Shop", "Harpoon": "Big Al's Gun Shop", "Heather": "Bits 'n' Bobs", "Heckler & Koch SL8": "Big Al's Gun Shop", "Hockey Stick": "Bits 'n' Bobs", "Hydrochloric Acid": "Pharmacy", "Ice Pick": "Big Al's Gun Shop", "Insulin": "Pharmacy", "Ithaca 37": "Big Al's Gun Shop", "Jackhammer": "Big Al's Gun Shop", "Jade Buddha": "Recycling Center", "Jaguar Plushie": "Bits 'n' Bobs", "Kabuki Mask": "TC Clothing", "Kama": "Big Al's Gun Shop", "Katana": "Big Al's Gun Shop", "Kevlar Gloves": "Big Al's Gun Shop", "Knuckle Dusters": "Big Al's Gun Shop", "Kodachi": "Big Al's Gun Shop", "Large Suitcase": "Bits 'n' Bobs", "Leather Bullwhip": "Big Al's Gun Shop", "Lion Plushie": "Bits 'n' Bobs", "Liquid Body Armor": "Big Al's Gun Shop", "Lorcin 380": "Big Al's Gun Shop", "M249 SAW": "Big Al's Gun Shop", "Macana": "Big Al's Gun Shop", "Mag 7": "Big Al's Gun Shop", "Maneki Neko": "Recycling Center", "Mayan Statue": "Bits 'n' Bobs", "Medium Suitcase": "Bits 'n' Bobs", "Metal Nunchaku": "Big Al's Gun Shop", "Minigun": "Big Al's Gun Shop", "Model Space Ship": "Recycling Center", "Monkey Plushie": "Bits 'n' Bobs", "Mountie Hat": "TC Clothing", "Natural Pearls": "Jewelry Store", "Naval Cutlass": "Big Al's Gun Shop", "Nessie Plushie": "Bits 'n' Bobs", "Neumune Tablet": "Pharmacy", "Ninja Claws": "Big Al's Gun Shop", "Ninja Star": "Big Al's Gun Shop", "Nodding Turtle": "Recycling Center", "Orchid": "Bits 'n' Bobs", "Outer Tactical Vest": "Big Al's Gun Shop", "Panda Plushie": "Bits 'n' Bobs", "Pangolin Scales": "Nikeh Sports", "Paper Weight": "Bits 'n' Bobs", "Pele Charm": "Bits 'n' Bobs", "Peony": "Bits 'n' Bobs", "Proda Sunglasses": "TC Clothing", "Qsz-92": "Big Al's Gun Shop", "Raw Ivory": "Pawn Shop", "Red Fox Plushie": "Bits 'n' Bobs", "SIG 552": "Big Al's Gun Shop", "SKS Carbine": "Big Al's Gun Shop", "Safety Boots": "Big Al's Gun Shop", "Safrole Oil": "Pharmacy", "Sai": "Big Al's Gun Shop", "Samurai Sword": "Big Al's Gun Shop", "Sensu": "Bits 'n' Bobs", "Sextant": "Recycling Center", "Shark Fin": "Nikeh Sports", "Ship in a Bottle": "Recycling Center", "Small Suitcase": "Bits 'n' Bobs", "Smoke Grenade": "Big Al's Gun Shop", "Snorkel": "TC Clothing", "Snowboard": "Recycling Center", "Soccer Ball": "Bits 'n' Bobs", "Spear": "Big Al's Gun Shop", "Speedo": "TC Clothing", "Sports Shades": "TC Clothing", "Springfield 1911": "Big Al's Gun Shop", "Steel Drum": "Recycling Center", "Stick Grenade": "Big Al's Gun Shop", "Stingray Plushie": "Bits 'n' Bobs", "Sumo Doll": "Bits 'n' Bobs", "Swiss Army Knife": "Big Al's Gun Shop", "Tailor's Dummy": "Recycling Center", "Taser": "Big Al's Gun Shop", "Taurus PT92": "Big Al's Gun Shop", "Tavor TAR-21": "Big Al's Gun Shop", "Tear Gas": "Big Al's Gun Shop", "Throwing Knife": "Big Al's Gun Shop", "Tiger Bone Powder": "Nikeh Sports", "Trench Coat": "TC Clothing", "Tribulus Omanense": "Bits 'n' Bobs", "Trout": "Big Al's Gun Shop", "Turtle Shell": "Jewelry Store", "Twin Tiger Hooks": "Big Al's Gun Shop", "Type 98 Anti Tank": "Big Al's Gun Shop", "Uncut Diamonds": "Jewelry Store", "Vektor CR-21": "Big Al's Gun Shop", "WWII Helmet": "Big Al's Gun Shop", "Wetsuit": "TC Clothing", "Whale Meat": "Nikeh Sports", "Wolverine Plushie": "Bits 'n' Bobs", "Wooden Nunchaku": "Big Al's Gun Shop", "Wushu Double Axes": "Big Al's Gun Shop", "Yakitori Lantern": "Recycling Center", "Yucca Plant": "Recycling Center"};

  function unitSell(marketValue, sellPrice, sellTo, name) {
    const best = Math.max((marketValue || 0) * Math.max(TAUX_TRADERS[name] || 0, 0.85), sellPrice || 0);
    return best > 0 ? best : null;
  }

  function channel(marketValue, sellPrice, name) {
    const best = unitSell(marketValue, sellPrice, null, name);
    if (best === null) return null;
    return best === (sellPrice || 0) ? BOUTIQUES[name] || "City" : TAUX_TRADERS[name] > 0.85 ? "Traders" : "Item market";
  }

  function margin(marketValue, sellPrice, cost, sellTo, name) {
    const sell = unitSell(marketValue, sellPrice, sellTo, name);
    return sell === null || cost === null || cost === undefined ? null : sell - cost;
  }

  function profitPerMinute(perItem, code, travelType, capacity) {
    if (perItem === null || perItem === undefined || !capacity) return null;
    const oneWay = flightMinutes(code, travelType);
    if (!oneWay) return null;
    return (perItem * capacity) / (oneWay * 2);
  }

  function name(code) {
    const c = COUNTRIES[code];
    return c ? c.name : String(code || "").toUpperCase();
  }

  const ITEM_TYPES = [
    "Alcohol", "Armor", "Artifact", "Clothing", "Drug", "Enhancer", "Flower",
    "Material", "Medical", "Other", "Plushie", "Tool", "Weapon",
  ];

  const V1_WEAPON_TYPES = ["melee", "primary", "secondary", "temporary"];
  function itemType(name) {
    const low = String(name || "").toLowerCase();
    if (V1_WEAPON_TYPES.includes(low)) return "Weapon";
    return ITEM_TYPES.find((t) => t.toLowerCase() === low) || null;
  }

  const DEFAULT_ITEM_TYPES = ["Flower", "Plushie", "Drug", "Other", "Artifact"];

  return {
    TYPE_ORDER, TRAVEL_TYPES, COUNTRIES, CODE_BY_NAME, ITEM_TYPES,
    DEFAULT_ITEM_TYPES, TRAVEL_BY_INDEX,
    codes: () => Object.keys(COUNTRIES),
    list: () => Object.values(COUNTRIES),
    flightMinutes, profitPerMinute, unitSell, margin, channel, name, itemType,
  };
})();

const Settings = (() => {
  "use strict";

  const KEY = "settings";
  const VERSION = 2;

  const SCHEMA = [

    { name: "torn_key", group: "account", kind: "secret", def: "",
      label: "Torn API key",
      help: "Requires a Limited Access Key. Stored locally in your browser." },
    { name: "oracle_token", group: "account", kind: "secret", def: "",
      label: "Torn Oracle token",
      help: "Required for Oracle services. Create one below or run /token new on Discord." },

    { name: "oracle_token_id", group: "account", kind: "int", def: 0, hidden: true,
      label: "Token id" },

    { name: "travel_type", group: "trips", kind: "choice", def: "airstrip", sync: "travel_type",
      choices: () => Object.entries(Data.TRAVEL_TYPES).map(([v, t]) => [v, t.label]),
      label: "Travel method",
      help: "Sets your flight times." },
    { name: "capacity", group: "trips", kind: "int", def: 28, min: 1, max: 500, sync: "capacity",
      label: "Suitcase size",
      help: "Items you carry per flight." },
    { name: "end_hours", group: "trips", kind: "number", def: 8, min: 0.5, max: 16, step: 0.5,
      unit: "h", sync: "end_hours",
      label: "Plan ahead",
      help: "How far ahead a plan reaches, up to 16 hours." },
    { name: "landing_aim", group: "trips", kind: "choice", def: "auto", sync: "landing_aim",
      choices: () => [["auto", "Automatic"], ["restock", "Start of the restock window"],
                      ["stock", "When stock is likely there"]],
      label: "Landing time",
      help: "Start of the restock window lands you at the earliest restock minute you can reach, to wait in hospital. Automatic picks it when the Assist tab has a self-hosp item." },
    { name: "drug_priority", group: "trips", kind: "bool", def: false, sync: "drug_priority",
      label: "Plan around drug cooldown",
      help: "Times a departure for when your drug cooldown ends." },
    { name: "max_drug_wait", group: "trips", kind: "int", def: 30, min: 1, max: 240,
      unit: "min", sync: "max_drug_wait",
      label: "Longest wait for the cooldown",
      help: "How long a departure may wait for it." },

    { name: "plan_countries", group: "buying", kind: "codes", def: [], sync: "plan_countries",
      label: "Countries",
      help: "None selected means every country." },
    { name: "item_types", group: "buying", kind: "types", def: Data.DEFAULT_ITEM_TYPES,
      sync: "item_types",
      label: "Item categories",
      help: "None selected means every category." },

    { name: "plan_items", group: "buying", kind: "picks", def: {},
      label: "Items",
      help: "Pick items in a category to plan only those. A category with none picked plans all its items." },
    { name: "exclude_types", group: "buying", kind: "types", def: [], hidden: true,
      sync: "exclude_types", label: "Excluded categories" },
    { name: "min_margin", group: "buying", kind: "int", def: 0, min: 0, unit: "$",
      sync: "min_margin",
      label: "Least profit per item",
      help: "Skips items that earn less." },
    { name: "max_cost", group: "buying", kind: "int", def: 0, min: 0, unit: "$", sync: "max_cost",
      label: "Highest price per item",
      help: "0 means no limit." },
    { name: "sell_to", group: "buying", kind: "choice", def: "players", sync: "sell_to",
      choices: () => [["players", "Players"], ["city", "City shops"]],
      label: "Sell to",
      help: "Plans focus on items that are profitable when sold to players or to city shops." },
    { name: "haircut_pct", group: "buying", kind: "number", def: 5, min: 0, max: 99, step: 0.5,
      unit: "%", sync: "haircut_pct", showIf: () => Settings.get("sell_to") !== "city",
      label: "Sell under market by",
      help: "Profit is counted at this discount to market value." },

    { name: "landing_target", group: "forecast", kind: "number", def: 75, min: 0, max: 99, step: 5,
      unit: "%", sync: "landing_target", pct: true,
      label: "Confidence target",
      help: "Lower finds more runs. Higher is safer." },
    { name: "landing_floor", group: "forecast", kind: "number", def: 25, min: 0, max: 95, step: 5,
      unit: "%", sync: "landing_floor", pct: true,
      label: "Stock left when you land",
      help: "The share of a full shelf that must still be there." },

    { name: "alerts_on", group: "alerts", kind: "bool", def: true,
      label: "Browser notifications",
      help: "Board, landing and fly-home alerts on this device." },
    { name: "approach_alert_mins", group: "alerts", kind: "int", def: 5, min: 0, max: 60,
      unit: "min", sync: "approach_alert_mins",
      label: "Warn before landing",
      help: "0 turns it off." },
    { name: "escort_on", group: "alerts", kind: "bool", def: false, sync: "escort_on",
      label: "Discord alerts with this tab closed" },
    { name: "post_plan", group: "alerts", kind: "bool", def: false, sync: "post_plan",
      label: "Show my plan on Discord",
      help: "Posts your plan to your Discord thread or DMs and updates it when you re-plan." },

    { name: "assist_kit", group: "assist", kind: "kit", hidden: true, sync: "assist_kit",
      def: { hosp: null, med: null, meds: 0, extras: [] },
      label: "Trip kit" },
    { name: "assist_track", group: "assist", kind: "itemrefs", def: [], hidden: true,
      sync: "assist_track", label: "Tracked items" },

    { name: "collapsed", group: "display", kind: "bool", def: false, hidden: true,
      label: "Panel collapsed" },
    { name: "tab", group: "display", kind: "string", def: "today", hidden: true,
      label: "Last tab" },
    { name: "minimal", group: "display", kind: "bool", def: false,
      label: "Minimal view",
      help: "Shows only what you need to act." },
    { name: "compact", group: "display", kind: "bool", def: false,
      label: "Compact rows" },
    { name: "clock_24h", group: "display", kind: "bool", def: true,
      label: "24-hour clock" },
    { name: "follow_page", group: "display", kind: "bool", def: true,
      label: "Follow the page",
      help: "The Shops tab shows the country you pick on Torn. Plans use your flight type and free travel slots." },
  ];

  const MAX_MEDS = 20;
  const MAX_TRACKED = 10;
  const MAX_EXTRAS = 10;
  const MAX_EXTRA_COUNT = 50;

  const BY_NAME = {};
  for (const row of SCHEMA) BY_NAME[row.name] = row;

  let values = null;

  function load() {
    const live = Env.read(KEY, null);
    const kept = Env.durable(KEY);
    const at = (b) => (b && typeof b === "object" && Number(b.__at)) || 0;
    const stored = at(kept) > at(live) ? kept : live;
    if (!(stored && typeof stored === "object") && values !== null) return values;
    const out = {};
    for (const row of SCHEMA) out[row.name] = row.def;
    if (stored && typeof stored === "object") {
      const migrated = migrate(stored);
      for (const row of SCHEMA) {
        if (Object.prototype.hasOwnProperty.call(migrated, row.name)) {
          const clean = coerce(row, migrated[row.name]);
          if (clean !== undefined) out[row.name] = clean;
        }
      }
    }
    values = out;
    return out;
  }

  function migrate(stored) {
    const v = Number(stored.__v || 1);
    let out = Object.assign({}, stored);
    if (v < 2) {

      out.torn_key = out.torn_key || Env.read("torn_key", "") || "";
      out.oracle_token = out.oracle_token || Env.read("token", "") || "";
      if (Array.isArray(out.countries) && !out.plan_countries) {
        out.plan_countries = out.countries;
      }

      if (out.escort_on === undefined) out.escort_on = Env.read("escort", false) === true;
    }
    return out;
  }

  function coerce(row, raw) {
    switch (row.kind) {
      case "bool":
        return typeof raw === "boolean" ? raw : undefined;
      case "int": {
        const n = Math.round(Number(raw));
        if (!isFinite(n)) return undefined;
        if (row.min !== undefined && n < row.min) return undefined;
        if (row.max !== undefined && n > row.max) return undefined;
        return n;
      }
      case "number": {
        const n = Number(raw);
        if (!isFinite(n)) return undefined;
        if (row.min !== undefined && n < row.min) return undefined;
        if (row.max !== undefined && n > row.max) return undefined;
        return n;
      }
      case "choice": {
        const allowed = row.choices().map(([v]) => v);
        return allowed.includes(raw) ? raw : undefined;
      }
      case "codes": {
        if (!Array.isArray(raw)) return undefined;
        return raw.filter((c) => Data.COUNTRIES[c]);
      }
      case "types": {
        if (!Array.isArray(raw)) return undefined;
        return [...new Set(raw.map(Data.itemType).filter(Boolean))];
      }
      case "picks": {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
        const out = {};
        for (const [type, ids] of Object.entries(raw)) {
          if (!Array.isArray(ids)) continue;
          const clean = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
          if (clean.length) out[type] = clean;
        }
        return out;
      }
      case "kit": {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
        const meds = Math.round(Number(raw.meds));
        const extras = [];
        for (const e of Array.isArray(raw.extras) ? raw.extras : []) {
          const ref = itemRef(e);
          const n = Math.round(Number(e && e.n));
          if (!ref || !(n >= 1) || extras.some((x) => x.id === ref.id)) continue;
          extras.push(Object.assign(ref, { n: Math.min(n, MAX_EXTRA_COUNT) }));
        }
        return { hosp: itemRef(raw.hosp), med: itemRef(raw.med),
                 meds: isFinite(meds) ? Math.min(Math.max(meds, 0), MAX_MEDS) : 0,
                 extras: extras.slice(0, MAX_EXTRAS) };
      }
      case "itemrefs": {
        if (!Array.isArray(raw)) return undefined;
        const out = [];
        for (const ref of raw.map(itemRef)) {
          if (ref && !out.some((o) => o.id === ref.id)) out.push(ref);
        }
        return out.slice(0, MAX_TRACKED);
      }
      case "secret":
      case "string":
        return typeof raw === "string" ? raw : undefined;
      default:
        return undefined;
    }
  }

  function itemRef(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = Number(raw.id);
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    return Number.isInteger(id) && id > 0 && name ? { id, name } : null;
  }

  function all() {
    if (values === null) load();
    return values;
  }

  function sync() {
    if (values === null) { load(); return false; }
    const before = JSON.stringify(values);
    load();
    return JSON.stringify(values) !== before;
  }

  function get(name) {
    return all()[name];
  }

  function set(name, value) {
    const row = BY_NAME[name];
    if (!row) { Env.log.warn("unknown setting " + name); return false; }
    const clean = coerce(row, value);
    if (clean === undefined) return false;
    load();
    values[name] = clean;
    persist();
    listeners.forEach((fn) => { try { fn(name, clean); } catch (e) { Env.log.warn("settings listener", e); } });
    return true;
  }

  function apply(changes) {
    load();
    const moved = [];
    for (const [name, value] of Object.entries(changes)) {
      const row = BY_NAME[name];
      const clean = row ? coerce(row, value) : undefined;
      if (clean === undefined) continue;
      if (JSON.stringify(values[name]) === JSON.stringify(clean)) continue;
      values[name] = clean;
      moved.push(name);
    }
    if (moved.length) {
      persist();
      Bus.emit("settings:remote", moved);
    }
    return moved;
  }

  function persist() {
    const blob = Object.assign({ __v: VERSION, __at: Date.now() }, values);
    Env.write(KEY, blob);
    Env.keep(KEY, blob);
  }

  const listeners = [];
  function onChange(fn) { listeners.push(fn); }

  function exportSafe() {
    const out = {};
    for (const row of SCHEMA) {
      if (row.kind === "secret") out[row.name] = get(row.name) ? "(set)" : "(not set)";
      else out[row.name] = get(row.name);
    }
    return out;
  }

  const SHARED_GROUPS = ["trips", "buying", "forecast"];
  const shareable = () => SCHEMA.filter((r) => SHARED_GROUPS.includes(r.group) && !r.hidden);
  const SHARE_MARK = "torn_oracle_travel";

  function exportShared() {
    const lines = [[SHARE_MARK, 1], ...shareable().map((row) => [row.name, get(row.name)])]
      .map(([name, v]) => "  " + JSON.stringify(name) + ": " + JSON.stringify(v));
    return "{\n" + lines.join(",\n") + "\n}";
  }

  function importShared(text) {
    let blob;
    try { blob = JSON.parse(text); } catch (e) { return null; }
    if (!blob || typeof blob !== "object" || !blob[SHARE_MARK]) return null;
    let applied = 0;
    let skipped = 0;
    for (const row of shareable()) {
      if (!Object.prototype.hasOwnProperty.call(blob, row.name)) continue;
      if (set(row.name, blob[row.name])) applied += 1; else skipped += 1;
    }
    return { applied, skipped };
  }

  function aimAtRestock() {
    const aim = get("landing_aim");
    return aim === "restock" || (aim === "auto" && !!get("assist_kit").hosp);
  }

  function planCountries() {
    const chosen = get("plan_countries");
    return chosen && chosen.length ? chosen.slice() : Data.codes();
  }

  return {
    SCHEMA, BY_NAME, VERSION, MAX_MEDS, MAX_TRACKED, MAX_EXTRAS, MAX_EXTRA_COUNT,
    load, all, get, set, apply, sync, onChange, exportSafe, exportShared, importShared,
    planCountries, aimAtRestock,
    groups: () => ["account", "trips", "buying", "forecast", "alerts", "display"],
  };
})();

const Oracle = (() => {
  "use strict";

  const HOST = "https://torn-oracle.duckdns.org";
  const PREFIX = "/api/v1";

  const SCRIPT_VERSION = "2.6.5";

  let backoffUntil = 0;
  let consecutiveFailures = 0;
  let updateDue = false;

  const MESSAGES = {
    backoff: "Torn Oracle asked for a moment. Trying again shortly.",
    no_xhr: "This userscript manager cannot reach Torn Oracle. Tampermonkey, "
          + "Violentmonkey and TornPDA can.",
    network: "Could not reach Torn Oracle. Check your connection.",
    timeout: "Torn Oracle took too long to answer.",
    bad_json: "Torn Oracle sent something this panel could not read.",
    no_token: "Torn Oracle needs an account to read the shops. Set one up in Settings.",
    bad_token: "Torn Oracle no longer recognises this account. Set it up again in Settings.",
    rate_limited: "Too many requests at once. Torn Oracle catches up in a moment.",
    busy: "Torn Oracle is busy right now. Try again shortly.",
    internal: "Something went wrong on Torn Oracle's side.",
    premium_required: "Forecasts aren't available on this account yet. "
                    + "Stock and restock times are.",
    signup_closed: "Torn Oracle is not taking new accounts from the panel yet. "
                 + "Use /token new on Discord.",
    bad_key: "Torn did not accept that key.",
    bad_land_at: "Your flight has landed. Stock at landing is not shown.",
    too_many_watches: "That is as many watches as Torn Oracle allows. Remove one first.",
    too_many_tokens: "That is as many tokens as Torn Oracle allows. Delete an old one first.",
    no_account: "That Torn Oracle account no longer exists.",
    no_watch: "That watch is already gone.",
    no_token_found: "That token is already gone.",
  };

  const FALLBACK = "Torn Oracle could not answer that.";

  class OracleError extends Error {
    constructor(status, code, message, extra) {
      super(message);
      this.status = status;
      this.code = code;
      Object.assign(this, extra || {});
    }
  }

  function friendly(code) {
    return MESSAGES[code] || FALLBACK;
  }

  function token() {
    return Settings.get("oracle_token") || "";
  }

  function haveToken() {
    return token().length > 0;
  }

  function attempt(method, url, headers, body) {
    return new Promise((resolve, reject) => {
      Env.net({
        method,
        url,
        headers,
        data: body === undefined ? undefined : JSON.stringify(body),
        timeout: 30_000,
        onload: (res) => {
          if (!updateDue && /^x-oracle-update:\s*1\s*$/im.test(res.responseHeaders || "")) {
            updateDue = true;
            Bus.emit("oracle:update");
          }
          let payload = null;
          try { payload = JSON.parse(res.responseText); } catch (e) {  }
          if (res.status >= 200 && res.status < 300) {
            consecutiveFailures = 0;
            if (!payload) { reject(new OracleError(res.status, "bad_json", friendly("bad_json"))); return; }
            resolve(payload);
            return;
          }
          const err = (payload && payload.error) || {};
          const code = err.code || "http_" + res.status;
          if (res.status === 429 || res.status === 503) {
            const retry = Number(res.responseHeaders && /retry-after:\s*(\d+)/i.exec(res.responseHeaders)?.[1]) || 15;
            backoffUntil = Date.now() + retry * 1000;
          }
          consecutiveFailures += 1;

          reject(new OracleError(res.status, code, friendly(code),
                                 { serverMessage: err.message || null, detail: err }));
        },
        onerror: () => {
          consecutiveFailures += 1;
          reject(new OracleError(0, "network", friendly("network")));
        },
        ontimeout: () => {
          consecutiveFailures += 1;
          reject(new OracleError(0, "timeout", friendly("timeout")));
        },
      });
    });
  }

  const READ_RETRIES = 2;
  const RETRY_DELAY_MS = 700;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function request(method, path, body) {
    if (Date.now() < backoffUntil) {
      throw new OracleError(0, "backoff", friendly("backoff"));
    }
    if (!Env.caps.xhr) {
      throw new OracleError(0, "no_xhr", friendly("no_xhr"));
    }
    const url = HOST + PREFIX + path;
    const headers = { Accept: "application/json", "X-Oracle-Script-Version": SCRIPT_VERSION };
    if (haveToken()) headers.Authorization = "Bearer " + token();
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const tries = method === "GET" ? READ_RETRIES + 1 : 1;
    let lastErr;
    for (let i = 0; i < tries; i += 1) {
      try {
        return await attempt(method, url, headers, body);
      } catch (err) {
        lastErr = err;
        const transient = err.code === "network" || err.code === "timeout";
        if (!transient || i === tries - 1) throw err;
        await sleep(RETRY_DELAY_MS);
      }
    }
    throw lastErr;
  }

  const get = (path) => request("GET", path);
  const post = (path, body) => request("POST", path, body || {});
  const del = (path) => request("DELETE", path);

  const me = () => get("/me").then((r) => r.data);

  const countries = (travel) =>
    get("/countries?travel=" + encodeURIComponent(travel)).then((r) => r.data);

  const shop = (code) =>
    get("/shop/" + encodeURIComponent(code)).then((r) => r.data);

  const itemStock = (itemId) =>
    get("/item/" + Number(itemId) + "/stock").then((r) => r.data);

  const dials = (q) => {
    q.set("floor", String(Settings.get("landing_floor") / 100));
    q.set("target", String(Settings.get("landing_target") / 100));
    q.set("aim", Settings.aimAtRestock() ? "1" : "0");
    return q;
  };

  const forecasts = (code, { travel, landAt }) => {
    const q = dials(new URLSearchParams({ travel }));
    if (landAt) q.set("land_at", String(Math.floor(landAt / 1000)));
    return get("/forecasts/" + encodeURIComponent(code) + "?" + q).then((r) => r.data);
  };

  const exports = () => get("/exports").then((r) => r.data);

  const announcements = () => get("/announcements").then((r) => r.data.announcements);

  const board = ({ travel } = {}) => {
    const q = dials(new URLSearchParams());
    if (travel != null) q.set("travel", travel);
    return get("/board?" + q.toString()).then((r) => r.data);
  };

  const watches = () => get("/watches").then((r) => r.data.watches);

  const addWatch = (body) => post("/watches", body).then((r) => r.data);

  const removeWatch = (id) => del("/watches/" + Number(id)).then((r) => r.data);

  const tokensList = () =>
    get("/tokens").then((r) => ({ list: r.data.tokens, max: r.data.max }));

  const tokenCreate = (label) =>
    post("/tokens", label ? { label } : {}).then((r) => r.data);

  const tokenDelete = (id) => del("/tokens/" + Number(id)).then((r) => r.data);

  const putTrip = (body) => post("/trip", body).then((r) => r.data);
  const clearTrip = () => del("/trip").then((r) => r.data);

  const heartbeat = (body) => post("/trip/heartbeat", body).then((r) => r.data);

  const planGet = () => get("/plan").then((r) => r.data);
  const planPut = (body) => post("/plan", body).then((r) => r.data);

  const settingsGet = () => get("/settings").then((r) => r.data);
  const settingsSave = (changes) => post("/settings", changes).then((r) => r.data);

  const signup = (tornKey, evictOldest = false) => {
    const body = { key: tornKey };
    if (evictOldest) body.evict_oldest = true;
    return post("/signup", body).then((r) => r.data);
  };

  function health() {
    return {
      host: HOST,
      haveToken: haveToken(),
      backoffFor: Math.max(0, backoffUntil - Date.now()),
      consecutiveFailures,
    };
  }

  return {
    HOST, OracleError,
    haveToken, health, friendly,
    me, countries, shop, itemStock, forecasts, board, exports, announcements,
    watches, addWatch, removeWatch,
    tokensList, tokenCreate, tokenDelete,
    putTrip, clearTrip, heartbeat,
    settingsGet, settingsSave, planGet, planPut,
    signup,
    updateDue: () => updateDue,
  };
})();

const Account = (() => {
  "use strict";

  const TTL = 5 * 60_000;

  let data = null;
  let at = 0;
  let loading = false;

  async function load(force) {
    if (!Oracle.haveToken()) { data = null; return null; }
    if (loading) return data;
    if (!force && data && Date.now() - at < TTL) return data;
    loading = true;
    try {
      data = await Oracle.me();
      at = Date.now();
      Bus.emit("account", state());
    } catch (err) {

      Env.log.warn("account read failed", err.message);
    } finally {
      loading = false;
    }
    return data;
  }

  function forget() {
    data = null;
    at = 0;
  }

  function state() {
    return {
      haveToken: Oracle.haveToken(),
      known: data !== null,
      tornName: data ? data.torn_name : null,
      tornId: data ? data.torn_id : null,
      premium: data ? data.premium === true : false,
      discordLinked: data ? data.discord_linked === true : false,
      expiresAt: data && data.expires_at ? Date.parse(data.expires_at) : null,
    };
  }

  function knownWithoutDiscord() {
    return data !== null && data.discord_linked !== true;
  }

  return { load, forget, state, knownWithoutDiscord };
})();

const PlanSync = (() => {
  "use strict";

  const STORE_KEY = "plansync";
  const PUSH_DELAY_MS = 1_000;
  const MAX_RETRIES = 3;

  const STEP = { pending: 0, enroute: 1, abroad: 2, returning: 3, done: 4, missed: 4, unconfirmed: 4 };
  const FINISHED = 4;

  let known = false;
  let busy = false;
  let timer = null;
  let lastError = null;

  const STALE_MS = 12 * 3600_000;

  const held = () => Env.read(STORE_KEY, null) || { rev: 0, fp: "null" };
  const hold = (rev, plan) => Env.write(STORE_KEY, { rev, fp: JSON.stringify(plan) });
  const step = (rt) => STEP[rt && rt.status] || 0;

  function live(plan) {
    const last = plan && plan.legs.length ? plan.legs[plan.legs.length - 1].home_again : 0;
    return plan && Date.now() - last <= STALE_MS ? plan : null;
  }

  function merge(mine, theirs, theirsAt) {
    if (!theirs) return mine && mine.createdAt > theirsAt ? mine : null;
    if (!mine) return theirs;
    if (mine.createdAt !== theirs.createdAt) return mine.createdAt > theirs.createdAt ? mine : theirs;
    const base = (mine.shapedAt || 0) >= (theirs.shapedAt || 0) ? mine : theirs;
    const other = base === mine ? theirs : mine;
    const runtime = base.runtime.map((rt, i) => {
      const alt = other.runtime[i];
      return alt && Trip.sameLeg(base.legs[i], other.legs[i]) && step(alt) > step(rt) ? alt : rt;
    });
    let cursor = base.cursor;
    while (cursor < runtime.length && step(runtime[cursor]) === FINISHED) cursor += 1;
    return Object.assign({}, base, { runtime, cursor });
  }

  async function reconcile(remote, tries) {
    const h = held();
    const mine = Trip.shared();
    const mineFp = JSON.stringify(mine);
    if (remote.revision === h.rev && mineFp === h.fp) return;
    const theirs = live(remote.plan);

    const merged = remote.revision === h.rev ? mine
      : mineFp === h.fp ? theirs
        : merge(mine, theirs, remote.updated_at ? Date.parse(remote.updated_at) : 0);
    if (JSON.stringify(merged) !== mineFp) {
      const kind = Trip.applyShared(merged);
      if (kind) Bus.emit("plan:synced", kind);
    }
    const plan = Trip.shared();
    if (JSON.stringify(plan) === JSON.stringify(remote.plan)) { hold(remote.revision, plan); return; }
    try {
      const res = await Oracle.planPut({ base: remote.revision, plan });
      hold(res.revision, plan);
    } catch (err) {
      const current = err.code === "plan_conflict" && err.detail && err.detail.current;
      if (!current || tries >= MAX_RETRIES) throw err;
      await reconcile(current, tries + 1);
    }
  }

  async function pull() {
    if (!Oracle.haveToken() || busy) return;
    busy = true;
    try {
      const remote = await Oracle.planGet();
      known = true;
      await reconcile(remote, 1);
      lastError = null;
    } catch (err) {
      lastError = err.message;
      Env.log.warn("plan sync failed", err.code || err.message);
    } finally {
      busy = false;
    }
  }

  async function push() {
    timer = null;
    if (!known || busy || !Oracle.haveToken()) return;
    const h = held();
    const mine = Trip.shared();
    if (JSON.stringify(mine) === h.fp) return;
    busy = true;
    try {
      await reconcile({ revision: h.rev, plan: JSON.parse(h.fp), updated_at: null }, 1);
      lastError = null;
    } catch (err) {
      lastError = err.message;
      Env.log.warn("plan sync failed", err.code || err.message);
    } finally {
      busy = false;
    }
  }

  function changed() {
    if (!known) return;
    clearTimeout(timer);
    timer = setTimeout(push, PUSH_DELAY_MS);
  }

  function forget() {
    known = false;
    Env.write(STORE_KEY, null);
  }

  return { pull, changed, forget, state: () => ({ known, lastError }) };
})();

const SettingsSync = (() => {
  "use strict";

  const PULL_MS = 5 * 60_000;
  const RETURN_MS = 30_000;
  const PUSH_DELAY_MS = 800;

  const pending = new Set();
  let pulledAt = 0;
  let pulling = false;
  let pushTimer = null;
  let lastError = null;
  let known = false;

  const rows = () => Settings.SCHEMA.filter((r) => r.sync);

  function toWire(row, v) {
    if (row.pct) return v / 100;
    if (row.kind === "types") {

      const list = row.name === "item_types" && !v.length ? Data.ITEM_TYPES : v;
      return list.map((t) => t.toLowerCase());
    }
    return v;
  }

  function fromWire(row, v) {
    if (v === null || v === undefined) return undefined;
    if (row.pct) return Math.round(v * 100);
    if (row.kind === "types") {
      return [...new Set(v.map(Data.itemType).filter(Boolean))];
    }
    return v;
  }

  async function push() {
    clearTimeout(pushTimer);
    if (!known || !Oracle.haveToken() || !pending.size) return;
    const names = [...pending];
    pending.clear();
    const body = {};
    for (const name of names) {
      const row = Settings.BY_NAME[name];
      body[row.sync] = toWire(row, Settings.get(name));
    }
    try {
      await Oracle.settingsSave(body);
      pulledAt = Date.now();
      lastError = null;
    } catch (err) {

      const refused = err.status >= 400 && err.status < 500 && err.status !== 429;
      if (!refused) names.forEach((n) => pending.add(n));
      lastError = err.message;
      Env.log.warn("settings save failed", err.message);
    }
    Bus.emit("sync");
  }

  async function pull(force) {
    if (!Oracle.haveToken() || pulling) return;
    if (!force && Date.now() - pulledAt < PULL_MS) return;
    pulling = true;
    try {
      if (known && pending.size) await push();
      const remote = await Oracle.settingsGet();
      pulledAt = Date.now();
      lastError = null;
      known = true;
      if (!remote.saved) {
        rows().forEach((r) => pending.add(r.name));
        await push();
        return;
      }
      const changes = {};
      for (const row of rows()) {
        if (pending.has(row.name)) continue;

        if (row.group === "assist" && remote[row.sync] === null
            && JSON.stringify(Settings.get(row.name)) !== JSON.stringify(row.def)) {
          pending.add(row.name);
          continue;
        }
        const v = fromWire(row, remote[row.sync]);
        if (v !== undefined) changes[row.name] = v;
      }
      Settings.apply(changes);
      if (pending.size) await push();
    } catch (err) {
      lastError = err.message;
      Env.log.warn("settings sync failed", err.message);
    } finally {
      pulling = false;
      Bus.emit("sync");
    }
  }

  function changed(name) {
    const row = Settings.BY_NAME[name];
    if (!row || !row.sync) return;
    pending.add(name);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DELAY_MS);
  }

  function forget() {
    pending.clear();
    pulledAt = 0;
    lastError = null;
    known = false;
  }

  function returned() {
    pull(Date.now() - pulledAt >= RETURN_MS);
  }

  function state() {
    return { lastError, pulledAt, pending: pending.size };
  }

  return { pull, push, changed, forget, returned, state };
})();

const Phase = (() => {
  "use strict";

  const PHASES = ["home", "outbound", "abroad", "inbound"];

  const PHASE_EVENT = {
    "home>outbound": "departed",
    "outbound>abroad": "landed",
    "abroad>inbound": "returning",
    "inbound>home": "returned_home",
  };

  const TORN = "torn";

  const TRAVEL_RE = /^travell?ing from (.+?) to (.+?)$/;

  function parseTravelDescription(description) {
    const m = TRAVEL_RE.exec(String(description || "").trim().toLowerCase());
    if (!m) return null;
    return { origin: m[1].trim(), dest: m[2].trim() };
  }

  function flightDirection(description) {
    const parsed = parseTravelDescription(description);
    if (!parsed) return null;
    if (parsed.dest === TORN) return "inbound";
    if (parsed.origin === TORN) return "outbound";
    return null;
  }

  function liveCountryCode(state, description) {
    const desc = String(description || "").trim();
    if (state === "Abroad") {
      const low = desc.toLowerCase();
      if (!low.startsWith("in ")) return null;
      return Data.CODE_BY_NAME[low.slice(3).trim()] || null;
    }
    if (state === "Traveling") {
      const parsed = parseTravelDescription(desc);
      if (!parsed) return null;
      if (parsed.origin === TORN && parsed.dest !== TORN) {
        return Data.CODE_BY_NAME[parsed.dest] || null;
      }
      return null;
    }
    return null;
  }

  function travelPhase(state, description, prevPhase) {
    if (state === "Traveling") {
      const direction = flightDirection(description);
      if (direction !== null) return direction;
      if (prevPhase === "outbound" || prevPhase === "inbound") return prevPhase;
      if (prevPhase === "abroad") return "inbound";
      if (prevPhase === "home") return "outbound";
      return null;
    }
    if (state === "Abroad") return "abroad";
    if (state === "Okay") return "home";

    return null;
  }

  function phaseWalk(prev, next) {
    if (next === null || next === undefined) return [];
    const start = PHASES.indexOf(prev) >= 0 ? prev : "home";
    if (start === next) return [];
    const events = [];
    let i = PHASES.indexOf(start);
    for (let n = 0; n < PHASES.length; n++) {
      const from = PHASES[i];
      const j = (i + 1) % PHASES.length;
      const event = PHASE_EVENT[from + ">" + PHASES[j]];
      if (event) events.push(event);
      i = j;
      if (PHASES[i] === next) break;
    }
    return events;
  }

  const BUY_RESIDUAL_TOLERANCE = 0.15;

  function evaluateBuy(drop, unitCost, maxUnits) {
    if (!(unitCost > 0) || drop < unitCost * 0.5) return { verdict: "none", units: 0 };
    const k = Math.round(drop / unitCost);
    if (k < 1) return { verdict: "none", units: 0 };
    const residual = Math.abs(drop - k * unitCost);
    const clean = residual <= Math.max(unitCost * BUY_RESIDUAL_TOLERANCE, 1);
    if (maxUnits > 0 && k > maxUnits) return { verdict: "ambiguous", units: k };
    return { verdict: clean ? "bought" : "ambiguous", units: k };
  }

  const IDENTIFY_TOLERANCE = 0.02;

  const UNEXPECTED_RANK = 99;

  function preferRank(itemId, preferIds) {
    for (let i = 0; i < (preferIds || []).length; i++) {
      if (preferIds[i] !== null && preferIds[i] !== undefined && preferIds[i] === itemId) return i;
    }
    return UNEXPECTED_RANK;
  }

  function buyFits(drop, priced, maxUnits, preferIds) {
    if (!(drop > 0)) return [];
    const fits = [];
    for (const item of priced || []) {
      const cost = item.cost;
      if (!(cost > 0) || drop < cost * 0.5) continue;
      const k = Math.round(drop / cost);
      if (k < 1 || (maxUnits > 0 && k > maxUnits)) continue;
      const residual = Math.abs(drop - k * cost);
      if (residual > Math.max(cost * IDENTIFY_TOLERANCE, 1)) continue;

      fits.push({
        error: residual / cost,
        rank: preferRank(item.itemId, preferIds),
        itemId: item.itemId, name: item.name, cost, units: k,
      });
    }
    fits.sort((a, b) => (a.error - b.error) || (a.rank - b.rank));
    return fits;
  }

  function uniqueFit(fits) {
    if (!fits || !fits.length) return null;
    const best = fits[0];

    if (best.rank !== UNEXPECTED_RANK) return best;

    return fits.length === 1 ? best : null;
  }

  function identifyBuy(drop, priced, maxUnits, preferIds) {
    return uniqueFit(buyFits(drop, priced, maxUnits, preferIds));
  }

  function statusFromBasic(payload) {
    const inner = (payload && (payload.profile || payload.basic)) || payload || {};
    const status = inner.status;
    if (!status || typeof status !== "object") return { state: null, description: "" };
    return { state: status.state || null, description: status.description || "" };
  }

  const RACING_ICON_ID = 17;

  function inRace(payload) {
    const icons = (payload && payload.icons) || [];
    if (!Array.isArray(icons)) return false;
    return icons.some((i) => i && i.id === RACING_ICON_ID);
  }

  return {
    PHASES, PHASE_EVENT,
    parseTravelDescription, flightDirection, liveCountryCode,
    travelPhase, phaseWalk, evaluateBuy, statusFromBasic, inRace,
    buyFits, uniqueFit, identifyBuy,
    BUY_RESIDUAL_TOLERANCE, IDENTIFY_TOLERANCE,
  };
})();

const Torn = (() => {
  "use strict";

  const BASE = "https://api.torn.com/v2";

  const COMMENT = "Oracle Travel";

  const RPM_BUDGET = 40;
  const WINDOW_MS = 60_000;

  const FATAL_KEY = new Set([1, 2, 10, 13]);
  const PAUSED = new Set([18]);
  const RATE_LIMITED = new Set([5]);
  const ACCESS_LEVEL = new Set([16]);
  const DAILY_CAP = new Set([14]);

  const MESSAGES = {
    1: "Your Torn key is missing. Re-save it in Settings.",
    2: "Torn rejected your API key. Replace it in Settings.",
    5: "Torn is rate-limiting this key. Torn Oracle slows down and tries again.",
    9: "Torn's API is in maintenance. Nothing to do but wait.",
    10: "Your Torn key has been disabled. Make a new one and replace it in Settings.",
    13: "Your Torn key was disabled for inactivity. Make a new one in Torn "
      + "and replace it in Settings.",
    14: "You have hit Torn's daily API limit. It resets tomorrow.",
    16: "This key does not have enough access. Limited is the minimum.",
    18: "Your Torn key is paused. Un-pause it in Torn's API settings.",
  };

  const stamps = [];
  const inflight = new Map();
  const cache = new Map();

  let keyState = "unknown";
  let lastError = null;

  let verdictFor = null;

  function budgetLeft() {
    const cutoff = Date.now() - WINDOW_MS;
    while (stamps.length && stamps[0] < cutoff) stamps.shift();
    return RPM_BUDGET - stamps.length;
  }

  function key() {
    return Settings.get("torn_key") || "";
  }

  function haveKey() {
    return key().length > 0;
  }

  function reconcile() {
    if (verdictFor !== null && verdictFor !== key()) forget();
  }

  class TornError extends Error {

    constructor(code, message, raw) {
      super(message);
      this.code = code;
      this.raw = raw || null;

      this.fatal = FATAL_KEY.has(code) || ACCESS_LEVEL.has(code) || DAILY_CAP.has(code);
    }
  }

  function friendly(code) {
    return MESSAGES[code] || "Torn would not answer that request.";
  }

  function raw(path, params) {
    const query = new URLSearchParams(params || {});
    query.set("comment", COMMENT);
    query.set("key", key());
    const url = BASE + "/" + path.replace(/^\//, "") + "?" + query.toString();
    return new Promise((resolve, reject) => {
      if (!Env.caps.xhr) {
        reject(new TornError(-1, "This userscript manager cannot reach the Torn "
                                 + "API. Tampermonkey, Violentmonkey and TornPDA can."));
        return;
      }
      Env.net({
        method: "GET",
        url,
        timeout: 20_000,
        headers: { Accept: "application/json" },
        onload: (res) => {
          let payload;
          try { payload = JSON.parse(res.responseText); }
          catch (e) { reject(new TornError(-1, "Torn sent something that was not JSON.")); return; }
          if (payload && payload.error) {
            const code = Number(payload.error.code);
            reject(new TornError(code, friendly(code),
                                 String(payload.error.error || "unknown")));
            return;
          }
          resolve(payload);
        },
        onerror: () => reject(new TornError(-1, "Could not reach the Torn API.")),
        ontimeout: () => reject(new TornError(-1, "The Torn API timed out.")),
      });
    });
  }

  async function get(path, { params = null, ttl = 0, priority = false } = {}) {
    if (!haveKey()) throw new TornError(-1, "No Torn API key saved yet.");
    reconcile();
    if (keyState === "invalid") {
      throw new TornError(2, "Your saved Torn key was rejected. Replace it in Settings.");
    }

    const cacheKey = path + "?" + new URLSearchParams(params || {}).toString();
    if (ttl > 0) {
      const hit = cache.get(cacheKey);
      if (hit && Date.now() - hit.at < ttl) return hit.payload;
    }

    const shared = inflight.get(cacheKey);
    if (shared) return shared;

    if (!priority && budgetLeft() <= 2) {
      const hit = cache.get(cacheKey);
      if (hit) return hit.payload;
      throw new TornError(-2, "Holding off on Torn API calls for a moment.");
    }

    stamps.push(Date.now());
    const promise = raw(path, params)
      .then((payload) => {
        keyState = "ok";
        verdictFor = key();
        lastError = null;
        if (ttl > 0) cache.set(cacheKey, { at: Date.now(), payload });
        return payload;
      })
      .catch((err) => {
        lastError = err;
        verdictFor = key();
        if (FATAL_KEY.has(err.code)) keyState = "invalid";
        else if (PAUSED.has(err.code)) keyState = "paused";
        else if (DAILY_CAP.has(err.code)) keyState = "capped";
        Env.log.warn("Torn " + path + " failed", err.message);
        throw err;
      })
      .finally(() => inflight.delete(cacheKey));

    inflight.set(cacheKey, promise);
    return promise;
  }

  const api = {

    basic: () => get("user/basic", { ttl: 0, priority: true }),

    travel: () => get("user/travel", { ttl: 0, priority: true }),

    money: () => get("user/money", { ttl: 0, priority: true }),
    bars: () => get("user/bars", { ttl: 20_000 }),
    cooldowns: () => get("user/cooldowns", { ttl: 20_000 }),
    profile: () => get("user/profile", { ttl: 60_000 }),
    personalstats: () => get("user/personalstats", { ttl: 300_000 }),
    races: () => get("user/races", { ttl: 60_000 }),

    icons: () => get("user/icons", { ttl: 60_000 }),

    newEvents: () => get("user/newevents", { ttl: 30_000 }),
    events: (limit = 25) => get("user/events", { params: { limit }, ttl: 30_000 }),

    otherProfile: (id) => get("user/" + Number(id) + "/profile", { ttl: 120_000 }),
    otherBasic: (id) => get("user/" + Number(id) + "/basic", { ttl: 60_000 }),

    itemMarket: (itemId, limit = 5) =>
      get("market/" + Number(itemId) + "/itemmarket", { params: { limit }, ttl: 60_000 }),

    items: () => get("torn/items", { ttl: 6 * 3600_000 }),

    keyInfo: () => get("key/info", { ttl: 300_000 }),
  };

  function verify(candidate) {
    const query = new URLSearchParams({ comment: COMMENT, key: candidate });
    const url = BASE + "/user/basic?" + query.toString();
    return new Promise((resolve) => {

      if (!Env.caps.xhr) {
        resolve({ ok: false, message: "This userscript manager cannot reach the "
                                    + "Torn API. Tampermonkey, Violentmonkey and "
                                    + "TornPDA can." });
        return;
      }
      Env.net({
        method: "GET", url, timeout: 20_000,
        onload: (res) => {
          let payload;
          try { payload = JSON.parse(res.responseText); }
          catch (e) { resolve({ ok: false, message: "Torn sent something unreadable." }); return; }
          if (payload && payload.error) {
            resolve({ ok: false, message: friendly(Number(payload.error.code)) });
            return;
          }
          const inner = (payload && (payload.profile || payload.basic)) || {};
          resolve({ ok: true, id: inner.id || null, name: inner.name || null });
        },
        onerror: () => resolve({ ok: false, message: "Could not reach the Torn API." }),
        ontimeout: () => resolve({ ok: false, message: "The Torn API timed out." }),
      });
    });
  }

  function health() {
    reconcile();
    return {
      haveKey: haveKey(),
      state: keyState,
      budgetLeft: budgetLeft(),
      budget: RPM_BUDGET,
      lastError: lastError
        ? { code: lastError.code, message: lastError.message, raw: lastError.raw || null }
        : null,
    };
  }

  function forget() {
    cache.clear();
    keyState = "unknown";
    verdictFor = null;
    lastError = null;
  }

  return Object.assign(api, { get, verify, health, haveKey, forget, TornError });
})();

const Trip = (() => {
  "use strict";

  const STORE_KEY = "trip";

  const VERSION = 2;

  const LATE_SOFT_MS = 5 * 60_000;

  const LATE_HARD_MS = 20 * 60_000;

  const LATE_GRACE_MS = 60_000;

  const STALE_MS = 100_000;

  const LANDING_BUFFER_MS = 2 * 60_000;

  let state = null;

  let revision = 0;

  function blank() {
    return {
      __v: VERSION,
      active: false,
      legs: [],
      runtime: [],
      cursor: 0,
      phase: null,
      since: 0,
      observedAt: 0,
      country: null,
      from: null,
      arrivalAt: null,

      racing: false,

      preserved: 0,

      endsAt: null,

      offPlan: null,

      journal: [],
      planNote: null,
      createdAt: 0,

      shapedAt: 0,
    };
  }

  function legRuntime() {
    return {

      status: "pending",
      departedAt: null,
      landedAt: null,
      leftAt: null,
      homeAt: null,
      arrivalAt: null,
      boughtQty: null,
      spend: null,

      paidCost: null,

      item: null,

      flewTo: null,
      ambiguous: null,
      baseline: null,
      weakBaseline: false,
      shelf: null,

      extra: [],
    };
  }

  function load() {
    const stored = migrate(Env.read(STORE_KEY, null));
    if (stored && stored.__v === VERSION && Array.isArray(stored.legs)) {
      state = Object.assign(blank(), stored);

      const last = state.legs.length ? state.legs[state.legs.length - 1].home_again : 0;
      if (state.active && last && Date.now() - last > 12 * 3600_000) {
        Env.log.info("Discarded a plan whose last run ended over 12 hours ago.");
        state = blank();
      }
    } else {
      state = blank();
    }
    return state;
  }

  function migrate(stored) {
    if (!stored || typeof stored !== "object") return stored;

    if (stored.__v === 1) {

      stored.runtime = (Array.isArray(stored.runtime) ? stored.runtime : [])
        .map((rt) => Object.assign(legRuntime(), rt, {
          item: null, baseline: null, weakBaseline: false, shelf: null,
        }));
      delete stored.wallet;
      delete stored.walletPhase;
      stored.__v = 2;
    }

    return stored;
  }

  function save() {
    state.savedAt = Date.now();
    Env.write(STORE_KEY, state);
  }

  function sync() {
    const stored = migrate(Env.read(STORE_KEY, null));
    if (!stored || stored.__v !== VERSION || !Array.isArray(stored.legs)) return false;
    if (state !== null && !((stored.savedAt || 0) > (state.savedAt || 0))) return false;
    const before = shape();
    state = Object.assign(blank(), stored);

    if (shape() !== before) revision += 1;
    return true;
  }

  function shape() {
    if (state === null) return "-";
    return (state.createdAt || 0) + "|" + state.legs.length + "|" + (state.active ? 1 : 0);
  }

  function get() {
    if (state === null) load();
    return state;
  }

  function journal(kind, text, detail) {
    const s = get();
    s.journal.push({ at: Date.now(), kind, text, detail: detail || null });
    if (s.journal.length > 120) s.journal.splice(0, s.journal.length - 120);
    Env.log.event(text, detail);
  }

  function started() {
    const s = get();
    return s.active && s.runtime.some((rt) => rt.status !== "pending");
  }

  function dayOver(now) {
    const s = get();
    now = now || Date.now();
    if (!s.active || !s.endsAt || now < s.endsAt) return false;
    if (s.phase !== "home" && s.phase !== null) return false;
    return !s.runtime.some((rt) => rt.ambiguous
      || rt.status === "enroute" || rt.status === "abroad" || rt.status === "returning");
  }

  function flownCount() {
    const s = get();
    let n = 0;
    while (n < s.legs.length && s.runtime[n].status !== "pending") n += 1;
    return n;
  }

  function adopt(legs, note, endsAt) {
    const s = get();
    s.legs = legs.slice();
    s.endsAt = endsAt || null;
    s.runtime = legs.map(legRuntime);
    s.cursor = 0;
    s.active = true;
    s.offPlan = null;
    s.planNote = note || null;
    s.createdAt = Date.now();
    s.shapedAt = s.createdAt;
    s.preserved = 0;
    revision += 1;
    save();
    journal("plan", legs.length + (legs.length === 1 ? " run planned" : " runs planned"));
    return s;
  }

  function replaceTail(tailLegs, note, endsAt) {
    const s = get();
    if (endsAt) s.endsAt = endsAt;
    const n = flownCount();
    const keep = s.legs.slice(0, n);
    const keepRuntime = s.runtime.slice(0, n);
    s.legs = keep.concat(tailLegs);
    s.runtime = keepRuntime.concat(tailLegs.map(legRuntime));

    s.cursor = Math.min(s.cursor, keep.length);
    s.offPlan = null;

    s.planNote = note || null;
    s.preserved = n;
    s.shapedAt = Date.now();
    revision += 1;
    save();
    journal("replan", "Re-planned " + tailLegs.length
                      + (tailLegs.length === 1 ? " remaining run" : " remaining runs"));
    return s;
  }

  function stop(reason) {
    const s = get();
    const had = s.active;
    const keptJournal = s.journal;
    const seenPhase = s.phase;
    const seenSince = s.since;
    const seenAt = s.observedAt;
    const seenCountry = s.country;
    const seenFrom = s.from;
    const seenArrival = s.arrivalAt;
    state = blank();
    state.journal = keptJournal;
    state.phase = seenPhase;
    state.since = seenSince;
    state.observedAt = seenAt;
    state.country = seenCountry;
    state.from = seenFrom;
    state.arrivalAt = seenArrival;
    revision += 1;
    save();
    if (had) journal("stop", reason || "Plan stopped.");
    return state;
  }

  const LOCAL_ONLY = ["baseline", "weakBaseline", "shelf"];
  const FIELDS = ["legs", "cursor", "endsAt", "planNote", "createdAt", "shapedAt",
                  "preserved", "offPlan"];

  function shared() {
    const s = get();
    if (!s.active) return null;
    const out = {};
    for (const k of FIELDS) out[k] = s[k];
    out.runtime = s.runtime.map((rt) => {
      const o = Object.assign({}, rt);
      for (const k of LOCAL_ONLY) delete o[k];
      return o;
    });
    return out;
  }

  const sameLeg = (a, b) => !!a && !!b && a.country === b.country
    && a.item_id === b.item_id && a.depart === b.depart;

  function applyShared(plan) {
    const s = get();
    if (!plan) {
      if (!s.active) return null;
      stop("Stopped on another device.");
      return "stopped";
    }
    const same = s.active && s.createdAt === plan.createdAt;
    const kind = !same ? "new" : s.shapedAt !== plan.shapedAt ? "reshaped" : "progress";
    const runtime = plan.legs.map((leg, i) => {
      const mine = same && sameLeg(s.legs[i], leg) ? s.runtime[i] : legRuntime();
      const keep = {};
      for (const k of LOCAL_ONLY) keep[k] = mine[k];
      return Object.assign(legRuntime(), plan.runtime[i] || {}, keep);
    });
    for (const k of FIELDS) s[k] = plan[k] === undefined ? blank()[k] : plan[k];
    s.legs = plan.legs.slice();
    s.runtime = runtime;
    s.active = true;
    revision += 1;
    save();
    if (!same) journal("plan", "Following the plan from another device.");
    return kind;
  }

  function currentIndex() {
    const s = get();
    return s.cursor < s.legs.length ? s.cursor : -1;
  }

  function currentLeg() {
    const i = currentIndex();
    return i < 0 ? null : s_leg(i);
  }

  function s_leg(i) {
    const s = get();
    return Object.assign({ index: i }, s.legs[i], { runtime: s.runtime[i] });
  }

  function legs() {
    const s = get();
    return s.legs.map((_, i) => s_leg(i));
  }

  function lateness(now) {
    const i = currentIndex();
    if (i < 0) return null;
    const s = get();
    if (s.runtime[i].status !== "pending") return null;
    if (s.phase !== "home") return null;
    const by = (now || Date.now()) - s.legs[i].depart;
    if (by < LATE_GRACE_MS) return null;
    return { by, soft: by >= LATE_SOFT_MS, hard: by >= LATE_HARD_MS };
  }

  function hospitalAbroad(state, now) {
    const s = get();
    return state === "Hospital" && (s.phase === "abroad"
      || (s.phase === "outbound" && !!s.arrivalAt && now >= s.arrivalAt));
  }

  function phaseOf(state, description, now) {
    return hospitalAbroad(state, now || Date.now()) ? "abroad"
      : Phase.travelPhase(state, description, get().phase);
  }

  function apply(obs) {

    sync();
    const s = get();
    const now = obs.at || Date.now();
    const prevPhase = s.phase;

    if (obs.at && s.observedAt && obs.at < s.observedAt) {
      return { events: [], phase: prevPhase, stale: true };
    }

    s.racing = !!obs.racing;

    const hospAbroad = hospitalAbroad(obs.state, now);
    const nextPhase = phaseOf(obs.state, obs.description, now);

    if (nextPhase === null) {
      s.observedAt = now;
      save();
      return { events: [], phase: prevPhase, held: true };
    }

    s.from = nextPhase === "inbound" ? originOf(obs.description, prevPhase, s) : null;
    if (!hospAbroad) s.country = Phase.liveCountryCode(obs.state, obs.description);

    s.arrivalAt = (nextPhase === "outbound" || nextPhase === "inbound")
      ? (obs.arrivalAt || s.arrivalAt) : null;

    const walk = Phase.phaseWalk(prevPhase, nextPhase);
    s.observedAt = now;

    if (nextPhase !== prevPhase) s.since = now;
    s.phase = nextPhase;

    rememberShelf(obs);

    const events = [];
    for (let n = 0; n < walk.length; n++) {
      events.push(...handle(walk[n], obs, now, n === walk.length - 1));
    }

    if (obs.arrivalAt) rememberArrival(obs.arrivalAt);

    if (nextPhase === "abroad") {

      const bought = detectBuy(obs);
      if (bought) events.push(bought);
    } else if (nextPhase === "outbound"
               && Phase.flightDirection(obs.description) === "outbound"
               && typeof obs.wallet === "number") {

      openBaseline(obs.wallet);
    }

    save();
    return { events, phase: nextPhase, held: false };
  }

  function originOf(description, prevPhase, s) {
    const parsed = Phase.parseTravelDescription(description);
    if (parsed && parsed.dest === "torn") return Data.CODE_BY_NAME[parsed.origin] || null;
    if (prevPhase === "abroad") return s.country;
    return prevPhase === "inbound" ? s.from : null;
  }

  function rememberShelf(obs) {
    if (!obs.shelf || !obs.shelf.length) return;
    const s = get();
    const i = currentIndex();
    if (i < 0 || s.runtime[i].shelf) return;
    s.runtime[i].shelf = obs.shelf;
  }

  function openBaseline(wallet, weak) {
    const s = get();
    const i = currentIndex();
    if (i < 0) return;
    const rt = s.runtime[i];

    if (weak && rt.baseline !== null) return;
    rt.baseline = typeof wallet === "number" ? wallet : null;
    rt.weakBaseline = rt.baseline === null ? false : !!weak;
  }

  function rememberArrival(arrivalAt) {
    const s = get();
    const i = currentIndex();
    if (i < 0) return;

    if (s.runtime[i].status === "enroute" || s.runtime[i].status === "returning") {
      s.runtime[i].arrivalAt = arrivalAt;
    }
  }

  function handle(kind, obs, now, live) {
    const s = get();
    const i = currentIndex();

    if (kind === "departed") {
      if (i < 0) {
        journal("offplan", "You took off with no run left to fly.");
        return [{ kind: "departed", offPlan: true }];
      }
      const leg = s.legs[i];
      const flying = s.country;

      if (flying && flying !== leg.country) {
        s.offPlan = { expected: leg.country, actual: flying, at: now };
        s.runtime[i].status = "enroute";
        s.runtime[i].departedAt = now;

        s.runtime[i].flewTo = flying;
        journal("offplan", "Flying to " + Data.name(flying) + ", not "
                           + Data.name(leg.country) + " as planned.");
        return [{ kind: "departed", leg: s_leg(i), offPlan: true }];
      }
      s.runtime[i].status = "enroute";
      s.runtime[i].departedAt = now;

      openBaseline(live ? obs.wallet : null);
      journal("departed", "Departed for " + Data.name(leg.country) + ".");
      return [{ kind: "departed", leg: s_leg(i) }];
    }

    if (kind === "landed") {
      if (i < 0) return [{ kind: "landed", offPlan: true }];
      s.runtime[i].status = "abroad";
      s.runtime[i].landedAt = now;

      openBaseline(live ? obs.wallet : null, true);
      journal("landed", "Landed in " + Data.name(legCountry(i)) + ".");
      return [{ kind: "landed", leg: s_leg(i) }];
    }

    if (kind === "returning") {
      if (i < 0) return [{ kind: "returning", offPlan: true }];
      const last = detectBuy(obs);
      s.runtime[i].leftAt = now;
      s.runtime[i].status = "returning";
      const out = [{ kind: "returning", leg: s_leg(i) }];
      if (last) out.unshift(last);
      return out;
    }

    if (kind === "returned_home") {
      if (i < 0) return [{ kind: "home", offPlan: true }];
      const rt = s.runtime[i];
      const last = detectBuy(obs);
      const out = [];
      if (last) out.push(last);

      if (rt.boughtQty === null && rt.ambiguous === null) {
        const proven = rt.baseline !== null && !rt.weakBaseline
                       && typeof obs.wallet === "number";
        if (proven) {
          rt.boughtQty = 0;
          journal("nobuy", "Left " + Data.name(legCountry(i)) + " without buying.");
        } else {
          const asked = ask(i, null, null);
          if (asked) out.push(asked);
        }
      }

      rt.homeAt = now;
      rt.status = unitsBought(rt) ? "done" : (rt.ambiguous ? "unconfirmed" : "missed");
      s.cursor = i + 1;
      journal("home", "Back in Torn.");
      out.push({ kind: "home", leg: s_leg(i), finishedIndex: i });
      return out;
    }

    return [];
  }

  function extras(rt) {
    return Array.isArray(rt.extra) ? rt.extra : [];
  }

  function unitsBought(rt) {
    return (rt.boughtQty || 0) + extras(rt).reduce((n, e) => n + e.units, 0);
  }

  function marginBought(i) {
    const rt = get().runtime[i];
    return (rt.boughtQty || 0) * boughtItem(i).margin
      + extras(rt).reduce((n, e) => n + e.units * e.margin, 0);
  }

  function priced(rt, itemId, row) {
    const entry = (rt.shelf || []).find((r) => r.itemId === itemId)
                  || (row && Number(row.id) === itemId
                      ? { itemId, name: row.name, cost: row.cost, value: row.value, sell: row.sell }
                      : null);
    if (!entry || !(entry.cost > 0)) return null;
    const margin = Data.margin(entry.value, entry.sell, entry.cost, Settings.get("sell_to"), entry.name) || 0;
    return { id: entry.itemId, name: entry.name, cost: entry.cost, margin };
  }

  function boughtItem(i) {
    const s = get();
    const rt = s.runtime[i];
    const leg = s.legs[i];
    if (rt.item) return rt.item;
    const planned = leg.unit_cost || 0;

    if (rt.paidCost !== null && rt.paidCost !== undefined) {
      return {
        id: leg.item_id, name: leg.item_name,
        cost: rt.paidCost, margin: (leg.unit_margin || 0) + (planned - rt.paidCost),
      };
    }
    return {
      id: leg.item_id, name: leg.item_name,
      cost: planned, margin: leg.unit_margin || 0,
    };
  }

  function legCountry(i) {
    const s = get();
    return s.runtime[i].flewTo || s.legs[i].country;
  }

  function carryable(i) {
    const s = get();
    return Math.max(Settings.get("capacity") || 0, s.legs[i].units || 0);
  }

  function shelfFor(i) {
    const s = get();
    const shelf = s.runtime[i].shelf;
    if (!shelf || !shelf.length) return [];
    const planned = s.legs[i].item_id;
    return shelf.filter((row) => row.cost > 0
                               && (row.quantity > 0 || row.itemId === planned));
  }

  function shelfOptions(i) {
    const s = get();
    const shelf = s.runtime[i].shelf;
    if (!shelf || !shelf.length) return [];
    return shelf.filter((row) => row.cost > 0);
  }

  function detectBuy(obs) {
    const s = get();
    const i = currentIndex();
    if (i < 0 || typeof obs.wallet !== "number") return null;
    const rt = s.runtime[i];
    if (rt.boughtQty !== null) return extendBuy(obs, i);
    if (rt.baseline === null) return null;

    const drop = rt.baseline - obs.wallet;
    if (drop <= 0) return null;

    const leg = s.legs[i];
    const max = carryable(i);

    const priced = shelfFor(i);
    if (priced.length) {
      const fits = Phase.buyFits(drop, priced, max, [leg.item_id]);
      if (fits.length) {
        const hit = Phase.uniqueFit(fits);
        if (hit === null) return ask(i, drop, null);
        if (hit.itemId === leg.item_id) {
          return record(i, hit.units, { cost: hit.cost }, obs);
        }
        return bookSwap(i, hit, obs, drop);
      }
    }

    const verdict = Phase.evaluateBuy(drop, leg.unit_cost || 0, max);
    if (verdict.verdict === "bought") {
      return record(i, verdict.units, { cost: drop / verdict.units }, obs);
    }
    if (verdict.verdict === "ambiguous") return ask(i, drop, verdict.units);
    return null;
  }

  function extendBuy(obs, i) {
    const s = get();
    const rt = s.runtime[i];
    if (rt.status !== "abroad") return null;
    const item = boughtItem(i);
    if (!(item.cost > 0)) return null;
    if (rt.baseline === null) {

      openBaseline(obs.wallet);
      return null;
    }
    const drop = rt.baseline - obs.wallet;
    if (drop < item.cost * 0.5) return null;
    const k = Math.round(drop / item.cost);
    if (k < 1 || unitsBought(rt) + k > carryable(i)) return null;
    if (Math.abs(drop - k * item.cost) > Math.max(item.cost * Phase.IDENTIFY_TOLERANCE, 1)) {
      return null;
    }
    rt.boughtQty = (rt.boughtQty || 0) + k;
    rt.spend = (rt.spend || 0) + k * item.cost;
    rt.baseline = obs.wallet;
    rt.weakBaseline = false;
    journal("bought", k + " more " + item.name + ", " + rt.boughtQty + " in the case.");
    return { kind: "bought", leg: s_leg(i), units: k, total: rt.boughtQty, more: true };
  }

  function record(i, units, priceOverride, obs) {
    const s = get();
    const rt = s.runtime[i];

    if (!rt.item && priceOverride && priceOverride.cost > 0) {
      rt.paidCost = priceOverride.cost;
    }
    const item = boughtItem(i);
    rt.boughtQty = units;
    rt.spend = units * item.cost;
    rt.ambiguous = null;

    if (typeof obs.wallet === "number") {
      rt.baseline = obs.wallet;
      rt.weakBaseline = false;
    }
    journal("bought", units + "x " + item.name + " bought.");
    return { kind: "bought", leg: s_leg(i), units, item: item.name };
  }

  function bookSwap(i, hit, obs, drop) {
    const s = get();
    const leg = s.legs[i];
    const entry = (s.runtime[i].shelf || []).find((row) => row.itemId === hit.itemId);
    const sell = entry ? Data.unitSell(entry.value, entry.sell, Settings.get("sell_to"), entry.name) : null;
    if (sell === null) {

      return ask(i, drop, hit.units, hit);
    }
    const margin = sell - hit.cost;
    s.runtime[i].item = {
      id: hit.itemId, name: hit.name, cost: hit.cost,
      margin, swappedFrom: leg.item_name,
    };
    const ev = record(i, hit.units, { cost: hit.cost }, obs);
    journal("swap", "Booked as " + hit.name + ", not " + leg.item_name + ".");
    return Object.assign(ev, { swappedFrom: leg.item_name });
  }

  function ask(i, drop, units, hit) {
    const s = get();
    const rt = s.runtime[i];
    if (rt.ambiguous || rt.boughtQty !== null) return null;
    rt.ambiguous = {
      drop: drop === null || drop === undefined ? null : drop,
      units: units || (hit ? hit.units : null),
      itemId: hit ? hit.itemId : null,
      itemName: hit ? hit.name : null,
    };
    journal("ambiguous", drop === null
      ? "Left " + Data.name(legCountry(i)) + " without seeing what you bought."
      : "Cash fell $" + drop.toLocaleString() + " and nothing on the shelf "
        + "explains it on its own.");
    return { kind: "ambiguous", leg: s_leg(i), drop: rt.ambiguous.drop,
             units: rt.ambiguous.units, itemName: rt.ambiguous.itemName };
  }

  function setBuy(index, answer) {
    const s = get();
    if (index < 0 || index >= s.legs.length) return false;
    const rt = s.runtime[index];
    const leg = s.legs[index];
    const units = Math.max(0, Math.round(Number(answer && answer.units) || 0));

    const wanted = answer && answer.itemId !== undefined && answer.itemId !== null
      ? Number(answer.itemId) : null;
    if (wanted !== null && wanted !== leg.item_id) {

      const hit = priced(rt, wanted, answer.item);
      if (hit) rt.item = Object.assign(hit, { swappedFrom: leg.item_name });
    } else if (wanted !== null) {
      rt.item = null;
    }

    rt.extra = [];
    for (const more of (answer && answer.extra) || []) {
      const n = Math.max(0, Math.round(Number(more.units) || 0));
      const id = Number(more.itemId);
      const hit = n > 0 && id ? priced(rt, id, more.item) : null;
      if (hit) rt.extra.push(Object.assign(hit, { units: n }));
    }

    const item = boughtItem(index);
    rt.boughtQty = units;
    rt.spend = units * item.cost + rt.extra.reduce((n, e) => n + e.units * e.cost, 0);
    rt.ambiguous = null;

    if (rt.status === "done" || rt.status === "missed" || rt.status === "unconfirmed") {
      rt.status = unitsBought(rt) > 0 ? "done" : "missed";
    }

    rt.baseline = null;
    rt.weakBaseline = false;
    const said = [units > 0 ? units + "x " + item.name : null]
      .concat(rt.extra.map((e) => e.units + "x " + e.name)).filter(Boolean);
    journal(said.length ? "bought" : "nobuy",
            said.length ? "You recorded " + said.join(", ") + "."
                        : "You recorded nothing bought.");
    save();
    return true;
  }

  function staleFor(now) {
    const s = get();
    if (!s.observedAt) return Infinity;
    return (now || Date.now()) - s.observedAt;
  }

  function isStale(now) {
    return staleFor(now) > STALE_MS;
  }

  function position(now) {
    const s = get();
    if (s.phase === null) return { known: false, why: "not_established" };
    if (isStale(now)) return { known: false, why: "stale", phase: s.phase, for: staleFor(now) };
    return { known: true, phase: s.phase, country: s.country, since: s.since };
  }

  function racing(now) {
    return !!get().racing && !isStale(now);
  }

  function earliestHome(now) {
    const s = get();
    now = now || Date.now();
    if (s.phase === "home" || s.phase === null) return now;

    const i = currentIndex();
    const leg = i < 0 ? null : s.legs[i];
    const rt = i < 0 ? null : s.runtime[i];

    const code = (leg && leg.country) || s.country;
    const flightMs = (Data.flightMinutes(code, Settings.get("travel_type")) || 0) * 60_000;
    const eta = (rt && rt.arrivalAt) || s.arrivalAt || null;

    if (s.phase === "outbound") {
      const flown = rt && rt.departedAt ? rt.departedAt + flightMs : now + flightMs;
      return Math.max(now, eta || flown) + flightMs + LANDING_BUFFER_MS;
    }
    if (s.phase === "abroad") {

      return now + flightMs + LANDING_BUFFER_MS;
    }
    if (s.phase === "inbound") {

      const flown = rt && rt.leftAt ? rt.leftAt + flightMs : (leg ? now + flightMs : now);
      return Math.max(now, eta || flown) + LANDING_BUFFER_MS;
    }
    return now;
  }

  function canReplan(now) {
    const s = get();
    if (!s.active) return { ok: true };
    if (s.phase === null) return { ok: false, why: "unknown" };
    if (isStale(now)) return { ok: false, why: "stale" };
    if (s.phase !== "home") return { ok: false, why: "flying", phase: s.phase };
    return { ok: true };
  }

  function value() {
    const s = get();
    let realised = 0;
    let expected = 0;
    let bought = 0;
    let flown = 0;
    let unresolved = 0;
    for (let i = 0; i < s.legs.length; i++) {
      const leg = s.legs[i];
      const rt = s.runtime[i];
      if (rt.status === "unconfirmed") { flown += 1; unresolved += 1; continue; }
      if (rt.status === "missed") { flown += 1; continue; }
      if (unitsBought(rt)) {
        realised += marginBought(i);
        bought += unitsBought(rt);
        if (rt.status === "done") flown += 1;
      } else if (rt.status === "pending" || rt.status === "enroute"
                 || rt.status === "abroad") {

        expected += leg.units * (leg.unit_margin || 0);
      }
    }
    return { realised, expected, bought, flown, unresolved, total: s.legs.length };
  }

  return {
    LATE_SOFT_MS, LATE_HARD_MS, STALE_MS, LANDING_BUFFER_MS,
    load, save, sync, get, blank,
    adopt, replaceTail, stop, started, dayOver, flownCount, shared, applyShared, sameLeg,
    revision: () => revision,
    apply, phaseOf, setBuy, boughtItem, extras, unitsBought, marginBought,
    legCountry, shelfFor, shelfOptions, carryable,
    legs, currentLeg, currentIndex,
    lateness, staleFor, isStale, position, racing, earliestHome, canReplan, value,
    journal: () => get().journal.slice(),
  };
})();

const Tracker = (() => {
  "use strict";

  const CADENCE = {
    home: 30_000,
    outbound: 60_000,
    abroad: 20_000,
    inbound: 60_000,
    unknown: 30_000,
  };

  const CLOSE_MS = 3 * 60_000;
  const CLOSE_CADENCE = 15_000;

  const LEASE_KEY = "poll_lease";

  const LEASE_MS = 100_000;

  const IDLE_MS = 20_000;

  function leaseHolder() {
    const held = Env.read(LEASE_KEY, null);
    if (!held || typeof held !== "object" || !held.tab) return null;
    if (Date.now() - (held.at || 0) > LEASE_MS) return null;
    return held.tab;
  }

  function claim(steal) {
    const holder = leaseHolder();
    if (holder && holder !== Env.tabId && !steal) return false;
    Env.write(LEASE_KEY, { tab: Env.tabId, at: Date.now() });
    return true;
  }

  function polling() {
    const holder = leaseHolder();
    return holder === null || holder === Env.tabId;
  }

  let timer = null;
  let running = false;
  let pendingSteal = false;
  let lastGap = 0;
  const subscribers = [];

  function onEvents(fn) { subscribers.push(fn); }

  function emit(result) {
    for (const fn of subscribers) {
      try { fn(result); } catch (e) { Env.log.warn("tracker subscriber failed", e); }
    }
  }

  function cadence() {

    if (!polling()) return IDLE_MS;
    const s = Trip.get();
    const base = CADENCE[s.phase || "unknown"] || CADENCE.unknown;
    const i = Trip.currentIndex();
    if (i >= 0) {
      const rt = s.runtime[i];

      if (rt.arrivalAt && rt.arrivalAt - Date.now() < CLOSE_MS) return CLOSE_CADENCE;
    }

    if (s.phase === "home" && i >= 0) {
      const due = s.legs[i].depart - Date.now();
      if (due > 0 && due < CLOSE_MS) return CLOSE_CADENCE;
    }
    return base;
  }

  function needBaseline() {
    const i = Trip.currentIndex();
    if (i < 0) return false;
    return Trip.get().runtime[i].baseline === null;
  }

  const SHELF_RETRY_MS = 90_000;
  let shelfFailedAt = 0;

  function wantShelf() {
    const i = Trip.currentIndex();
    if (i < 0 || !Oracle.haveToken()) return false;
    if (Trip.get().runtime[i].shelf) return false;
    return Date.now() - shelfFailedAt > SHELF_RETRY_MS;
  }

  async function readShelf(code) {
    if (!code) return null;
    try {
      const shop = await Oracle.shop(code);
      return (shop.items || []).map((item) => ({
        itemId: item.item_id,
        name: item.name,
        cost: item.cost,
        value: item.market_value,
        sell: item.sell_price,
        quantity: item.quantity,
      })).filter((row) => row.cost > 0);
    } catch (err) {
      shelfFailedAt = Date.now();
      Env.log.warn("shelf read failed", err.message);
      return null;
    }
  }

  async function observe() {
    const s = Trip.get();

    let basic;
    try {
      basic = await Torn.basic();
    } catch (err) {
      Env.log.warn("status read failed", err.message);
      emit({ error: err, events: [] });
      return null;
    }

    const status = Phase.statusFromBasic(basic);
    const phaseNow = Trip.phaseOf(status.state, status.description);

    const obs = {
      at: Date.now(),
      state: status.state,
      description: status.description,
      arrivalAt: null,
      wallet: undefined,
      racing: false,
    };

    if (status.state === "Okay") {
      try {
        obs.racing = Phase.inRace(await Torn.icons());
      } catch (err) {
        Env.log.warn("icons read failed", err.message);
      }
    }

    if (status.state === "Traveling") {
      try {
        const payload = await Torn.travel();
        const travel = (payload && payload.travel) || {};
        if (travel.arrival_at) obs.arrivalAt = Number(travel.arrival_at) * 1000;
      } catch (err) {

        Env.log.warn("travel read failed", err.message);
      }
    }

    const wantWallet =
         phaseNow === "abroad"
      || s.phase === "abroad"
      || (phaseNow === "outbound" && needBaseline())
      || (phaseNow === "home" && s.phase !== "home");
    if (wantWallet) {
      try {
        const payload = await Torn.money();
        const m = (payload && (payload.money || payload)) || {};
        const wallet = typeof m.wallet === "number" ? m.wallet
                     : typeof m.money_onhand === "number" ? m.money_onhand : null;
        if (wallet !== null) obs.wallet = wallet;
      } catch (err) {

        Env.log.warn("money read failed", err.message);
      }
    }

    if (phaseNow === "abroad" && wantShelf()) {
      const shelf = await readShelf(s.country || Phase.liveCountryCode(status.state,
                                                                      status.description));
      if (shelf) obs.shelf = shelf;
    }

    const result = Trip.apply(obs);
    emit(Object.assign({ error: null, observation: obs }, result));
    return result;
  }

  async function tick(steal) {

    if (running) {
      if (steal) pendingSteal = true;
      return;
    }
    running = true;
    try {
      lastGap = Env.Clock.markTick();

      if (lastGap && Env.Clock.sleptThrough(lastGap, cadence())) {
        Env.log.info("Tab was asleep for " + Math.round(lastGap / 1000)
                     + "s. Re-reading position.");
      }

      const dayMoved = Trip.sync();
      const settingsMoved = Settings.sync();
      const moved = dayMoved || settingsMoved;

      const arrived = lastGap === 0 && Env.visible();

      if (claim(steal || arrived)) {
        if (Torn.haveKey()) await observe();
      } else if (moved) {

        emit({ error: null, events: [], phase: Trip.get().phase, followed: true });
      }
    } catch (e) {
      Env.log.error("tracker tick failed", e);
    } finally {
      running = false;
      const again = pendingSteal;
      pendingSteal = false;
      if (again) tick(true);
      else schedule();
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, cadence());
  }

  function start() {
    if (timer) clearTimeout(timer);
    tick();
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function poke() {
    if (timer) clearTimeout(timer);
    tick(true);
  }

  function health() {
    return { running, lastGap, cadence: cadence(), polling: polling() };
  }

  return { start, stop, poke, onEvents, health, cadence, polling };
})();

const Alerts = (() => {
  "use strict";

  const STORE_KEY = "alerts_fired";

  const KINDS = {
    board:     { title: "Board now",     prompt: true,  escort: true },
    late:      { title: "Still on the ground", prompt: true, escort: true },
    departed:  { title: "Departed",      prompt: false, escort: true },
    approach:  { title: "Nearly there",  prompt: false, escort: true },
    landed:    { title: "Landed",        prompt: false, escort: true },
    home:      { title: "Back in Torn",  prompt: false, escort: true },
    bought:    { title: "Bought",        prompt: false },
    ambiguous: { title: "Did you buy?",  prompt: false },
    offplan:   { title: "Off plan",      prompt: false },
  };

  let fired = null;

  let unreported = [];

  const UNREPORTED_MAX = 640;

  function load() {
    const stored = Env.read(STORE_KEY, null);
    fired = (stored && typeof stored === "object") ? stored : {};
    unreported = Array.isArray(fired.__unreported) ? fired.__unreported : [];
    delete fired.__unreported;
    return fired;
  }

  function save() {
    if (fired === null) load();
    Env.write(STORE_KEY, Object.assign({}, fired, { __unreported: unreported }));
  }

  function all() {
    if (fired === null) load();
    return fired;
  }

  function reload() {
    const stored = Env.read(STORE_KEY, null);
    if (!stored || typeof stored !== "object") return all();
    const merged = Object.assign({}, stored, all());
    delete merged.__unreported;

    const theirs = Array.isArray(stored.__unreported) ? stored.__unreported : [];
    for (const key of theirs) if (unreported.indexOf(key) === -1) unreported.push(key);
    fired = merged;
    return fired;
  }

  function planId() {
    return String(Trip.get().createdAt || 0);
  }

  function keyFor(kind, legIndex) {
    return planId() + ":" + (legIndex === undefined || legIndex === null ? "-" : legIndex)
           + ":" + kind;
  }

  function escortKey(kind, legIndex) {
    const spec = KINDS[kind];
    if (!spec || !spec.escort) return null;
    if (legIndex === undefined || legIndex === null || legIndex < 0) return null;
    return (legIndex + 1) + ":" + kind;
  }

  function forgetOtherPlans() {
    const prefix = planId() + ":";
    const keep = {};
    for (const k of Object.keys(all())) if (k.startsWith(prefix)) keep[k] = fired[k];
    fired = keep;
    save();
  }

  function forgetFrom(index) {
    if (!(index >= 0)) return;
    const prefix = planId() + ":";
    const keep = {};
    const dropped = [];
    for (const key of Object.keys(all())) {
      if (!key.startsWith(prefix)) { keep[key] = fired[key]; continue; }
      const seq = Number(key.slice(prefix.length).split(":")[0]);

      if (!isFinite(seq) || seq < index) keep[key] = fired[key];
      else dropped.push(seq);
    }
    fired = keep;

    if (dropped.length) {
      unreported = unreported.filter((key) => {
        const seq = Number(String(key).split(":")[0]);
        return !isFinite(seq) || seq - 1 < index;
      });
    }
    save();
  }

  function already(kind, legIndex) {
    return Object.prototype.hasOwnProperty.call(all(), keyFor(kind, legIndex));
  }

  function fire(kind, legIndex, body, options) {
    reload();
    const key = keyFor(kind, legIndex);
    if (already(kind, legIndex)) return false;
    if (!Settings.get("alerts_on") && !(options && options.always)) {

      all()[key] = Date.now();
      save();
      return false;
    }

    all()[key] = Date.now();
    const shared = escortKey(kind, legIndex);
    if (shared && unreported.indexOf(shared) === -1) {
      unreported.push(shared);
      if (unreported.length > UNREPORTED_MAX) {
        unreported.splice(0, unreported.length - UNREPORTED_MAX);
      }
    }
    save();

    const spec = KINDS[kind] || { title: kind };
    const title = (options && options.title) || spec.title;

    const code = options && options.code;
    Env.toast(title, body, () => {
      try { window.focus(); } catch (e) {  }
      if (code) Page.preselect(code);
    });

    Bus.emit("alert", { kind, legIndex, title, body, at: Date.now() });
    Env.log.event("alert: " + title + " — " + body);
    return true;
  }

  function onTracked(result) {
    if (!Trip.get().active) return;
    const now = Date.now();

    for (const ev of result.events || []) {
      const idx = ev.leg ? ev.leg.index : null;
      switch (ev.kind) {
        case "departed":
          if (ev.offPlan) {
            fire("offplan", idx,
                 "You have gone off plan. Torn Oracle re-plans when you land in Torn.");
          } else {
            fire("departed", idx,
                 "Flying to " + Data.name(ev.leg.country) + " for "
                 + ev.leg.units + "x " + ev.leg.item_name + ".");
          }
          break;
        case "landed":
          if (ev.leg) {

            const flew = ev.leg.runtime.flewTo;
            fire("landed", idx, flew
              ? "Landed in " + Data.name(flew) + ", off plan. Buy what you came "
                + "for. Torn Oracle re-plans when you get home."
              : "Buy " + ev.leg.units + "x " + ev.leg.item_name + " in "
                + Data.name(ev.leg.country) + ".");
          }
          break;
        case "bought":
          if (ev.more) {

            break;
          }
          fire("bought", idx,
               ev.swappedFrom
                 ? ev.units + "x " + ev.item + ", not " + ev.swappedFrom
                   + ". Booked at what you paid. Fly home."
                 : ev.units + "x " + ev.leg.item_name + " confirmed. Fly home.");
          break;
        case "ambiguous":
          fire("ambiguous", idx, askText(ev));
          break;
        case "home": {

          const rt = ev.leg ? ev.leg.runtime : null;
          const carried = rt && Trip.unitsBought(rt) > 0;
          fire("home", idx, carried
            ? "Nice haul. Get ready for your next run."
            : "Back in Torn. Get ready for your next run.");
          break;
        }
        default:
          break;
      }
    }

    prompts(now);
    approach(now);
  }

  function askText(ev) {
    if (ev.drop === null || ev.drop === undefined) {
      return "Torn Oracle missed your wallet on this stop. What did you buy?";
    }
    if (ev.itemName) {
      return "Cash fell $" + ev.drop.toLocaleString() + ". That is "
           + ev.itemName + ", not " + ev.leg.item_name + ". Confirm it in the panel.";
    }
    return "Cash fell $" + ev.drop.toLocaleString() + ". Nothing on the shelf "
         + "matches. What did you buy?";
  }

  function prompts(now) {
    const s = Trip.get();
    const i = Trip.currentIndex();
    if (i < 0) return;
    if (s.phase !== "home" || Trip.isStale(now)) return;
    if (s.runtime[i].status !== "pending") return;

    const leg = s.legs[i];
    if (leg.depart - now <= 60_000 && leg.depart - now > -Trip.LATE_SOFT_MS) {
      fire("board", i, "Fly to " + Data.name(leg.country) + " for "
                       + leg.units + "x " + leg.item_name + ". Take $"
                       + Math.round(leg.units * (leg.unit_cost || 0)).toLocaleString() + ".",
           { code: leg.country });
    }

    const late = Trip.lateness(now);
    if (late && late.soft) {
      fire("late", i, Math.round(late.by / 60_000) + " minutes past this run's "
                      + "departure. Re-plan to rebuild your day from now.");
    }
  }

  function approach(now) {
    const mins = Settings.get("approach_alert_mins");
    if (!mins || mins <= 0) return;
    const s = Trip.get();
    const i = Trip.currentIndex();
    if (i < 0 || s.phase !== "outbound") return;
    const arrival = s.runtime[i].arrivalAt;
    if (!arrival) return;
    const left = arrival - now;
    if (left <= 0 || left > mins * 60_000) return;

    const flew = s.runtime[i].flewTo;
    fire("approach", i,
         Math.max(1, Math.round(left / 60_000)) + " minutes to "
         + Data.name(Trip.legCountry(i)) + "."
         + (flew ? "" : " You are buying " + s.legs[i].units + "x "
                        + s.legs[i].item_name + "."));
  }

  function drainUnreported() {
    const out = unreported.slice();
    return {
      keys: out,

      ack: () => {
        unreported = unreported.filter((k) => !out.includes(k));
        save();
      },
    };
  }

  function reset() {
    fired = {};
    unreported = [];
    save();
  }

  return { fire, already, onTracked, forgetOtherPlans, forgetFrom,
           drainUnreported, reset, load, KINDS };
})();

const Escort = (() => {
  "use strict";

  const BEAT_MS = 45_000;

  const RETRY_MS = 60_000;

  const TAIL_MS = 30 * 60_000;

  function finished(legs) {
    return Date.now() > Math.max(...legs.map((l) => l.home_again)) + TAIL_MS;
  }

  let beatTimer = null;
  let lastBeatAt = 0;
  let lastTryAt = 0;
  let uploading = false;

  let uploadError = null;
  let beatError = null;

  let needClear = false;

  let wasEnabled = null;

  const BEAT_GRACE_MS = 150_000;

  function beatStalled() {
    if (!beatError) return false;
    if (!lastBeatAt) return true;
    return Date.now() - lastBeatAt > BEAT_GRACE_MS;
  }

  function trouble() {
    return uploadError || (beatStalled() ? beatError : null);
  }

  const HELD_KEY = "escort_held";

  function held() {
    const row = Env.read(HELD_KEY, null);
    if (!row || typeof row !== "object" || !row.fp) return null;
    if (row.until) {
      const until = Date.parse(row.until);
      if (isFinite(until) && Date.now() > until) return null;
    }
    return row;
  }

  function remember(fp, res) {
    Env.write(HELD_KEY, {
      fp,
      delivery: (res && res.delivery) || null,

      until: (res && res.until) || null,
      at: Date.now(),
    });
  }

  function forgetHeld() {
    Env.drop(HELD_KEY);
  }

  function forget() {
    forgetHeld();
    needClear = false;
    wasEnabled = null;
  }

  function enabled() {
    return (alertsOn() || Settings.get("post_plan") === true) && Oracle.haveToken();
  }

  function alertsOn() {
    return Settings.get("escort_on") === true;
  }

  function fingerprint(legs) {
    return JSON.stringify([alertsOn(), Settings.get("post_plan") === true].concat(
      legs.map((l) => [l.country, l.item_id, l.units, l.depart, l.land, l.home_again])));
  }

  function why(err) {
    const code = err.code || "error";
    const status = err.status ? " " + err.status : "";
    const detail = err.serverMessage ? ": " + err.serverMessage : "";
    return code + status + detail + " (" + err.message + ")";
  }

  function payload(legs) {
    return {
      kept: Trip.get().preserved || 0,
      alerts: alertsOn(),
      post: Settings.get("post_plan") === true,
      legs: legs.map((l) => ({
        country: l.country,
        item_id: l.item_id,
        item_name: l.item_name,
        depart: l.depart,
        land: l.land,
        home_again: l.home_again,
        units: l.units,
        land_by: l.land_by || undefined,
        unit_cost: l.unit_cost ? Math.round(l.unit_cost) : undefined,
        profit: l.unit_margin > 0 ? Math.round(l.units * l.unit_margin) : undefined,
        hit: typeof l.hit === "number" ? Math.min(1, Math.max(0, l.hit)) : undefined,
      })),
      approach_alert_mins: Settings.get("approach_alert_mins"),
      travel_type: Settings.get("travel_type"),
    };
  }

  async function upload(legs) {
    if (!enabled() || !legs || !legs.length || finished(legs)) return;

    if (uploading) return;
    const fp = fingerprint(legs);
    const have = held();
    if (have && have.fp === fp) return;
    if (uploadError && Date.now() - lastTryAt < RETRY_MS) return;
    lastTryAt = Date.now();
    uploading = true;
    try {
      const res = await Oracle.putTrip(payload(legs));
      remember(fp, res);
      needClear = true;
      uploadError = null;
      Env.log.info("Escort holds " + legs.length + " leg(s).");
      Bus.emit("escort", state());
    } catch (err) {

      forgetHeld();

      uploadError = err.code === "premium_required"
        ? "Alerts with the browser closed aren't available on this account yet."
        : err.message;

      Env.log.warn("escort upload failed", why(err));
      Bus.emit("escort", state());
    } finally {
      uploading = false;
    }
  }

  async function clear() {
    stopBeat();
    if (!Oracle.haveToken()) { forgetHeld(); needClear = false; return; }
    try {
      await Oracle.clearTrip();

      forgetHeld();
      needClear = false;
    } catch (err) {

      needClear = true;
      Env.log.warn("escort clear failed", why(err));
    }
    Bus.emit("escort", state());
  }

  async function beat() {
    if (!enabled() || !alertsOn() || !Trip.get().active) return;

    if (!Tracker.polling()) return;
    const drain = Alerts.drainUnreported();
    try {
      const res = await Oracle.heartbeat({ fired: drain.keys, phase: Trip.get().phase });
      drain.ack();
      lastBeatAt = Date.now();
      beatError = null;

      if (res && res.holding === false) forgetHeld();
    } catch (err) {

      beatError = err.message;
      Env.log.warn("heartbeat failed", err.message);
    }
  }

  function startBeat() {
    stopBeat();
    if (!enabled() || !alertsOn()) return;
    beat();
    beatTimer = setInterval(beat, BEAT_MS);
  }

  function stopBeat() {
    if (beatTimer) clearInterval(beatTimer);
    beatTimer = null;
  }

  function sync(opts) {
    const s = Trip.get();
    const on = enabled();
    const pressed = !!(opts && opts.pressed);
    const flipped = wasEnabled !== null && wasEnabled !== on;

    if (wasEnabled === true && !on) needClear = true;
    wasEnabled = on;

    if (on) {

      if (s.active && s.legs.length && (pressed || flipped || Tracker.polling())) {
        upload(s.legs);
      }
    } else if ((needClear || held()) && Oracle.haveToken()) {

      clear();
    }

    const worth = s.active && on && alertsOn();
    if (worth && !beatTimer) startBeat();
    else if (!worth && beatTimer) stopBeat();
  }

  function state() {
    const have = held();
    return {
      enabled: enabled(),
      haveToken: Oracle.haveToken(),
      holding: have !== null,
      delivery: have ? have.delivery : null,
      lastBeatAt,
      lastError: trouble(),
    };
  }

  function explain() {
    if (!Oracle.haveToken()) {

      return { ok: false, text: "Account required. Configure credentials in Settings, "
                                + "or use /token new on Discord." };
    }
    if (!Settings.get("escort_on")) {
      return { ok: true, text: "Disabled. Alerts only reach you while a Torn tab is open." };
    }

    if (Account.knownWithoutDiscord()) {
      return { ok: false, text: "Discord account not linked. Run /register on Discord with your Torn key." };
    }

    const have = held();
    const delivery = have ? have.delivery : null;
    if (delivery && delivery.discord === false) {
      return { ok: false, text: "Discord account not linked. Run /register on Discord." };
    }
    if (delivery && delivery.key === false) {
      return { ok: false, text: "No backend API key registered. Run /register on Discord to enable tracking." };
    }
    const bad = trouble();
    if (bad) return { ok: false, text: bad };
    if (have) {

      const where = delivery && delivery.where === "dm"
        ? "in your Discord DMs"
        : "in your private thread on Discord";
      return { ok: true, text: "On. Alerts sent " + where + " when this tab is closed." };
    }
    return { ok: true, text: "On. Nothing to watch until you make a plan." };
  }

  return { enabled, upload, clear, sync, beat, state, explain, fingerprint, forget, held };
})();

function plannerCore() {
  "use strict";

  const MIN_HIT = 0.05;
  const MIN_FILL_GAP_MS = 35 * 60_000;
  const FILL_SLACK_MS = 5 * 60_000;
  const MAX_SORTIES = 64;

  function sampleAt(win, at) {
    const a = win.anchors;
    if (!a || !a.length) return null;
    if (at <= a[0].at) return a[0];
    if (at >= a[a.length - 1].at) return a[a.length - 1];
    for (let i = 0; i < a.length - 1; i++) {
      const lo = a[i], hi = a[i + 1];
      if (at >= lo.at && at <= hi.at) {
        const span = hi.at - lo.at;
        if (span <= 0) return lo;
        const w = (at - lo.at) / span;
        return {
          at,
          hit: lo.hit + w * (hi.hit - lo.hit),

          shelf: (lo.shelf === null || hi.shelf === null)
            ? null : lo.shelf + w * (hi.shelf - lo.shelf),
        };
      }
    }
    return a[a.length - 1];
  }

  function windowAt(prep, at) {
    for (const w of prep.windows) if (w.start <= at && at < w.end) return w;
    return null;
  }

  function doseClearAt(cfg) {
    if (!cfg.prioritizeDrug || !cfg.drugCooldownSecs) return null;
    return cfg.now + cfg.drugCooldownSecs * 1000;
  }

  function doseDeparture(cfg, t) {
    const clear = doseClearAt(cfg);

    const cap = cfg.maxDrugPushMs || 0;
    if (clear === null || clear <= t || clear > t + cap) return null;
    return clear;
  }

  const EMPTY_SHELF = { taken: null };

  function shelfKey(prep, land) {
    const w = windowAt(prep, land);
    return prep.country + "|" + prep.itemId + "|" + (w ? w.start : "-");
  }

  function shelfTaken(shelf, key) {
    return (shelf.taken && shelf.taken[key]) || 0;
  }

  function shelfBooked(shelf, key, units) {
    if (units <= 0 || !shelf.enabled) return shelf;
    const next = Object.assign({}, shelf.taken);
    next[key] = (next[key] || 0) + units;
    return { taken: next, enabled: true };
  }

  function unitsFor(prep, cfg, cash, stockCap) {
    let units = cfg.capacity;
    if (stockCap !== null && stockCap >= 0) units = Math.min(units, stockCap);
    if (cash !== null && prep.cost > 0) units = Math.min(units, Math.floor(cash / prep.cost));
    return Math.max(0, Math.trunc(units));
  }

  function recoverableWait(idleMs) {
    return idleMs >= MIN_FILL_GAP_MS + FILL_SLACK_MS ? idleMs : 0;
  }

  function specFromLanding(prep, t, cfg, cash, kind, land, win, oneway, shelf) {
    let depart = land - prep.flightMs;
    if (depart < t) { depart = t; land = t + prep.flightMs; }
    const homeAgain = land + prep.flightMs;
    if ((oneway ? land : homeAgain) > cfg.endTime) return null;

    const doseClear = doseClearAt(cfg);
    if (cfg.doseStrict !== false && doseClear !== null
        && depart < doseClear && doseClear < homeAgain) {
      return null;
    }

    win = win || windowAt(prep, land);
    if (!win) return null;
    const s = sampleAt(win, land);
    if (!s) return null;

    let hit = s.hit;
    if (hit < MIN_HIT) return null;

    const stock = s.shelf === null ? null : Math.max(1, Math.round(s.shelf));
    let buyCap = null;
    if (shelf.taken && stock !== null) {
      const taken = shelfTaken(shelf, shelfKey(prep, land));
      if (taken) {
        const remaining = stock - taken;
        if (remaining < 1) return null;

        buyCap = remaining;
        hit *= Math.min(1, remaining / stock);
      }
    }

    if (kind === "instock" && prep.stockQty > 0) {
      buyCap = buyCap === null ? prep.stockQty : Math.min(buyCap, prep.stockQty);
    }

    const units = unitsFor(prep, cfg, cash, buyCap);
    if (units <= 0) return null;
    const profit = hit * units * prep.margin;

    const spanEnd = oneway ? land : homeAgain;
    const idle = Math.max(0, depart - t);
    const rate = profit / Math.max(1, (spanEnd - t - recoverableWait(idle)) / 1000);

    const w = windowAt(prep, land);
    const target = (kind === "restock" && w && w.start > cfg.seenAt
                    && depart <= w.start && w.start <= land)
      ? w.start : null;

    return {
      rate, profit, prep, kind, depart, land, homeAgain,
      restock: target, idle, units, oneway,
      landBy: w ? w.end : null,
      latestDepart: w ? w.end - prep.flightMs : null,
      hit,
      shelf: s.shelf,
    };
  }

  function sortieSpec(prep, t, cfg, cash, kind, terminal, shelf) {
    const oneway = !!(terminal && cfg.endAbroad);
    if (kind === "instock") {
      if (!prep.inStockNow || prep.stockQty <= 0) return [];

      if (t > cfg.now) return [];

      const doseDepart = doseDeparture(cfg, t);
      const lands = [t + prep.flightMs];
      if (doseDepart !== null) lands.push(doseDepart + prep.flightMs);
      let best = null;
      const seen = new Set();
      for (const land of lands) {
        if (seen.has(land)) continue;
        seen.add(land);

        if (prep.selloutAt !== null && prep.selloutAt <= land) continue;
        const spec = specFromLanding(prep, t, cfg, cash, kind, land,
                                     windowAt(prep, land), oneway, shelf);
        if (spec && (!best || spec.rate > best.rate)) best = spec;
      }
      return best ? [best] : [];
    }

    const earliest = t + prep.flightMs;
    const doseDepart = doseDeparture(cfg, t);
    const doseLand = doseDepart === null ? null : doseDepart + prep.flightMs;
    let best = null;
    let first = null;
    for (const w of prep.windows) {
      if (w.end <= earliest) continue;
      const opening = Math.max(w.start, earliest);
      const lands = [opening];
      if (doseLand !== null && opening <= doseLand && doseLand < w.end) lands.push(doseLand);
      const seen = new Set();
      for (const land of lands) {
        if (seen.has(land)) continue;
        seen.add(land);
        const spec = specFromLanding(prep, t, cfg, cash, kind, land, w, oneway, shelf);
        if (!spec) continue;
        if (first === null) first = spec;
        if (!best || spec.rate > best.rate) best = spec;
      }
    }
    if (!best) return [];
    return first === best ? [best] : [best, first];
  }

  function sortieSpecs(preps, t, cfg, cash, shelf) {
    const out = [];
    for (const prep of preps) {
      for (const kind of ["instock", "restock"]) {
        out.push(...sortieSpec(prep, t, cfg, cash, kind, false, shelf));
      }
    }
    return out;
  }

  function bestSequence(preps, t, cfg, cash, depth, shelf) {
    const specs = sortieSpecs(preps, t, cfg, cash, shelf);
    if (!specs.length) return [0, []];
    const k = Math.max(1, cfg.beamWidth);
    let beam = specs;
    if (specs.length > k) {
      beam = specs.slice().sort((a, b) => b.rate - a.rate).slice(0, k);
    }

    let bestTotal = 0, bestSeq = [];
    for (const spec of beam) {
      let total, seq;
      if (depth <= 1) {
        total = spec.profit;
        seq = [spec];
      } else {

        const nextCash = cash === null ? null : cash + spec.profit;
        const [sub, subSeq] = bestSequence(
          preps, spec.homeAgain, cfg, nextCash, depth - 1,
          shelfBooked(shelf, shelfKey(spec.prep, spec.land), spec.units));
        total = spec.profit + sub;
        seq = [spec, ...subSeq];
      }
      if (total > bestTotal) { bestTotal = total; bestSeq = seq; }
    }
    return [bestTotal, bestSeq];
  }

  function fillGap(preps, t, cfg, cash, anchor, shelf) {
    const windowCfg = Object.assign({}, cfg, { endTime: anchor.depart - FILL_SLACK_MS });
    const [, seq] = bestSequence(preps, t, windowCfg, cash, cfg.depth, shelf);
    if (!seq.length || seq[0].profit <= 0) return null;
    return seq[0];
  }

  function terminalOneway(preps, t, cfg, cash, shelf) {
    let best = null;
    for (const prep of preps) {
      for (const kind of ["instock", "restock"]) {
        for (const spec of sortieSpec(prep, t, cfg, cash, kind, true, shelf)) {
          if (!best || spec.profit > best.profit) best = spec;
        }
      }
    }
    if (!best || best.profit <= 0) {

      if (cfg.doseStrict !== false && doseClearAt(cfg) !== null) {
        return terminalOneway(
          preps, t, Object.assign({}, cfg, { doseStrict: false }), cash, shelf);
      }
      return null;
    }
    return Object.assign({}, best, { oneWay: true });
  }

  function soonestHome(preps, t, cfg, cash, shelf) {
    let best = null;
    for (const spec of sortieSpecs(preps, t, cfg, cash, shelf)) {
      if (!best || spec.homeAgain < best.homeAgain
          || (spec.homeAgain === best.homeAgain && spec.profit > best.profit)) {
        best = spec;
      }
    }
    return best;
  }

  function planDay(preps, cfg, forced) {
    const sorties = [];
    let t = cfg.now;
    let cash = cfg.cash;
    let shelf = cfg.shelfDebit ? { taken: {}, enabled: true } : EMPTY_SHELF;
    let pending = forced || null;

    for (let i = 0; i < MAX_SORTIES; i++) {
      if (pending) {
        let next = pending;
        if (pending.depart - t >= MIN_FILL_GAP_MS) {
          next = fillGap(preps, t, cfg, cash, pending, shelf) || pending;
        }
        if (next === pending) pending = null;
        sorties.push(next);
        shelf = shelfBooked(shelf, shelfKey(next.prep, next.land), next.units);
        t = next.homeAgain;
        if (cash !== null) cash += next.profit;
        continue;
      }

      let passCfg = cfg;
      let [, seq] = bestSequence(preps, t, passCfg, cash, cfg.depth, shelf);
      if (!seq.length && cfg.doseStrict !== false && doseClearAt(cfg) !== null) {
        passCfg = Object.assign({}, cfg, { doseStrict: false });
        const soonest = soonestHome(preps, t, passCfg, cash, shelf);
        seq = soonest ? [soonest] : [];
      }
      if (!seq.length) break;
      let first = seq[0];
      if (first.idle >= MIN_FILL_GAP_MS) {
        first = fillGap(preps, t, passCfg, cash, first, shelf) || first;
      }
      sorties.push(first);

      shelf = shelfBooked(shelf, shelfKey(first.prep, first.land), first.units);
      t = first.homeAgain;

      if (cash !== null) cash += first.profit;
    }

    if (cfg.endAbroad) {
      const tEnd = sorties.length ? sorties[sorties.length - 1].homeAgain : cfg.now;
      const oneway = terminalOneway(preps, tEnd, cfg, cash, shelf);
      if (oneway) sorties.push(oneway);
    }
    return sorties;
  }

  function prepare(items, cfg) {
    const preps = [];
    for (const it of items) {
      if (!it.forecast || !it.forecast.upcoming || !it.forecast.upcoming.length) continue;
      if (it.cost === null || it.cost === undefined) continue;

      const city = cfg.sellTo === "city";
      const value = city ? it.sell_price : it.market_value;
      if (!value || value <= 0) continue;
      if (cfg.maxCost !== null && it.cost > cfg.maxCost) continue;
      const type = (it.type || "").trim().toLowerCase();

      if (cfg.includeTypes && cfg.includeTypes.indexOf(type) === -1) continue;
      if (cfg.excludeTypes && cfg.excludeTypes.indexOf(type) !== -1) continue;
      if (cfg.excludeItems && cfg.excludeItems.indexOf(it.item_id) !== -1) continue;

      // Fork : meilleur canal, traders Wardogs (taux par catégorie), item market (85 %), ville
      const TRADERS = { flower: .98, plushie: .98, temporary: .95, drug: .95, alcohol: .95, candy: .95,
        booster: .95, "energy drink": .95, "supply pack": .95, tool: .90, material: .90, medical: .90,
        enhancer: .90, special: .90, artifact: .90 };
      const mv = it.market_value || 0;
      const margin = Math.max(mv * (TRADERS[type] || 0.25), mv * 0.85, it.sell_price || 0) - it.cost;
      if (margin <= 0 || margin < cfg.minMargin) continue;

      const windows = [];
      for (const w of it.forecast.upcoming) {
        if (!w.anchors || !w.anchors.length) continue;
        windows.push({
          start: Date.parse(w.land_at),
          end: Date.parse(w.land_by),
          anchors: w.anchors.map((a) => ({
            at: Date.parse(a.at),
            hit: a.hit,
            shelf: a.shelf === undefined ? null : a.shelf,
          })),
        });
      }
      if (!windows.length) continue;

      const selloutAt = it.forecast.sellout_at ? Date.parse(it.forecast.sellout_at) : null;
      preps.push({
        country: it.country,
        itemId: it.item_id,
        name: it.name,
        cost: it.cost,
        margin,
        stockQty: it.quantity || 0,
        inStockNow: !!it.in_stock_now,
        flightMs: it.forecast.flight_minutes * 60_000,
        windows,
        selloutAt: selloutAt !== null && !isNaN(selloutAt) ? selloutAt : null,
      });
    }
    return preps;
  }

  function plan(input) {
    return schedule(planDay(prepare(input.items, input.cfg), input.cfg), input.cfg);
  }

  function plans(input, count) {
    const cfg = input.cfg;
    const preps = prepare(input.items, cfg);
    const days = [planDay(preps, cfg)];
    const key = (s) => s.prep.country + "|" + s.prep.itemId;
    const route = (day) => day.map((s) => key(s) + "@" + s.depart).join(",");
    const tried = new Set();
    const routes = new Set([route(days[0])]);
    const shelf = cfg.shelfDebit ? { taken: {}, enabled: true } : EMPTY_SHELF;
    const firsts = sortieSpecs(preps, cfg.now, cfg, cfg.cash, shelf)
      .sort((a, b) => b.rate - a.rate);
    for (const spec of firsts) {
      if (days.length >= count) break;
      if (tried.has(key(spec))) continue;
      tried.add(key(spec));
      const day = planDay(preps, cfg, spec);
      if (routes.has(route(day))) continue;
      routes.add(route(day));
      days.push(day);
    }
    const total = (day) => day.reduce((n, s) => n + s.profit, 0);
    return days.filter((day) => day.length)
      .sort((a, b) => total(b) - total(a))
      .map((day) => schedule(day, cfg));
  }

  function schedule(sorties, cfg) {
    const clear = doseClearAt(cfg);
    return sorties.map((s) => ({
      country: s.prep.country,
      item_id: s.prep.itemId,
      item_name: s.prep.name,
      kind: s.kind,
      depart: s.depart,
      land: s.land,
      home_again: s.homeAgain,
      restock: s.restock,
      idle_wait: s.idle,
      units: s.units,
      unit_cost: s.prep.cost,
      unit_margin: s.prep.margin,
      expected_profit: s.profit,
      land_by: s.landBy,
      hit: s.hit,
      one_way: !!s.oneWay,

      dose: clear !== null && s.depart === clear,
    }));
  }

  const api = { plan, plans, planDay, prepare, sampleAt };

  if (typeof self !== "undefined" && typeof window === "undefined") {
    self.onmessage = (e) => {
      try {
        const legs = e.data.count ? api.plans(e.data, e.data.count) : api.plan(e.data);
        self.postMessage({ id: e.data.id, legs });
      } catch (err) {
        self.postMessage({ id: e.data.id, error: String(err && err.message || err) });
      }
    };
  }
  return api;
}

if (typeof module !== "undefined" && module.exports) module.exports = plannerCore;

const Plan = (() => {
  "use strict";

  const SHELF_WARN_MS = 4 * 60_000;

  const AUTO_REPLAN_MIN_GAP_MS = 5 * 60_000;

  const CHOICES = 3;
  const CHOICE_TTL_MS = 10 * 60_000;

  const GLOBAL_FAILURE = new Set([
    "backoff", "rate_limited", "busy", "no_token", "bad_token", "no_xhr",
  ]);

  let running = false;
  let stage = null;
  let lastAutoAt = 0;
  let lastError = null;
  let worker = null;

  let choices = null;

  let searchSeq = 0;

  function workerSource() {
    return "(" + plannerCore.toString() + ")();";
  }

  function ensureWorker() {
    if (worker !== null) return worker;
    try {
      const blob = new Blob([workerSource()], { type: "application/javascript" });
      worker = new Worker(URL.createObjectURL(blob));
      return worker;
    } catch (e) {
      Env.log.info("Worker unavailable (page CSP); planning on the main thread.");
      worker = false;
      return false;
    }
  }

  function runSearch(input) {
    const w = ensureWorker();
    if (w === false) {
      const core = plannerCore();
      return Promise.resolve(input.count ? core.plans(input, input.count) : core.plan(input));
    }
    return new Promise((resolve, reject) => {
      const id = "search-" + (++searchSeq);
      const timeout = setTimeout(() => {
        w.removeEventListener("message", onMessage);
        reject(new Error("The search took too long and was abandoned."));
      }, 45_000);
      function onMessage(ev) {
        if (!ev.data || ev.data.id !== id) return;
        clearTimeout(timeout);
        w.removeEventListener("message", onMessage);
        if (ev.data.error) reject(new Error(ev.data.error));
        else resolve(ev.data.legs);
      }
      w.addEventListener("message", onMessage);

      w.postMessage({ id, items: input.items, cfg: input.cfg, count: input.count || 0 });
    });
  }

  async function drugCooldown() {
    if (!Settings.get("drug_priority")) return 0;
    try {
      const payload = await Torn.cooldowns();
      const cds = (payload && payload.cooldowns) || payload || {};
      return Math.max(0, Number(cds.drug) || 0);
    } catch (err) {
      Env.log.warn("cooldowns unreadable; planning without the dose", err.message);
      return 0;
    }
  }

  function unpicked(items) {
    const picks = {};
    for (const [type, ids] of Object.entries(Settings.get("plan_items"))) {
      picks[type.toLowerCase()] = ids;
    }
    const out = items
      .filter((it) => {
        const ids = picks[(it.type || "").trim().toLowerCase()];
        return ids && !ids.includes(it.item_id);
      })
      .map((it) => it.item_id);
    return out.length ? [...new Set(out)] : null;
  }

  function config(originMs, seenAt, items, drugCooldownSecs, endTime) {
    const haveTypes = items.some((i) => i.type);
    const chosen = Settings.get("item_types");

    const includeTypes = (haveTypes && chosen && chosen.length)
      ? chosen.map((t) => t.toLowerCase())
      : null;
    const excluded = Settings.get("exclude_types");
    const excludeTypes = haveTypes && excluded.length
      ? excluded.map((t) => t.toLowerCase())
      : null;
    const onCooldown = Math.max(
      0, (drugCooldownSecs || 0) - Math.max(0, originMs - Date.now()) / 1000);
    return {
      now: originMs,
      endTime: endTime || originMs + Settings.get("end_hours") * 3600_000,
      capacity: Settings.get("capacity"),
      haircutPct: Settings.get("haircut_pct"),
      sellTo: Settings.get("sell_to"),
      minMargin: Settings.get("min_margin"),
      maxCost: Settings.get("max_cost") > 0 ? Settings.get("max_cost") : null,
      includeTypes,
      excludeTypes,
      excludeItems: unpicked(items),

      cash: null,
      seenAt: seenAt ? Date.parse(seenAt) : originMs,

      beamWidth: 3,
      depth: 3,
      shelfDebit: true,

      prioritizeDrug: onCooldown > 0,
      drugCooldownSecs: onCooldown,
      maxDrugPushMs: Settings.get("max_drug_wait") * 60_000,
      doseStrict: true,
    };
  }

  async function gather(originMs) {
    const travel = Settings.get("travel_type");
    const codes = Settings.planCountries();

    const items = [];
    let seenAt = null;

    let failedCountries = 0;
    let forecastError = null;

    const missing = [];
    let read = 0;
    let shelfRun = 0;

    for (let n = 0; n < codes.length; n++) {
      stage = "Reading " + Data.name(codes[n]) + " (" + (n + 1) + " of " + codes.length + ")";
      Bus.emit("plan:stage", stage);

      let shop;
      try {
        shop = await Oracle.shop(codes[n]);
        read += 1;
        shelfRun = 0;
      } catch (err) {
        missing.push(codes[n]);
        Env.log.warn("shelf for " + codes[n] + " failed", err.message);

        if (GLOBAL_FAILURE.has(err.code) || ++shelfRun >= 2) {

          if (read === 0) throw err;
          for (let m = n + 1; m < codes.length; m++) missing.push(codes[m]);
          break;
        }
        continue;
      }
      let forecasts = {};
      try {
        const batch = await Oracle.forecasts(codes[n], { travel });
        forecasts = batch.forecasts || {};
      } catch (err) {

        failedCountries += 1;
        if (forecastError === null) forecastError = err.message;
        Env.log.warn("forecasts for " + codes[n] + " failed", err.message);
      }

      if (!seenAt || Date.parse(shop.observed_at) < Date.parse(seenAt)) {
        seenAt = shop.observed_at;
      }

      for (const item of shop.items) {
        items.push({
          country: codes[n],
          item_id: item.item_id,
          name: item.name,
          type: item.type,
          cost: item.cost,
          quantity: item.quantity,
          market_value: item.market_value,
          sell_price: item.sell_price,
          in_stock_now: (item.quantity || 0) > 0,
          forecast: forecasts[String(item.item_id)] || null,
        });
      }
    }

    return {
      items, seenAt, forecastError, missing,

      allForecastsFailed: read > 0 && failedCountries === read,
      someForecastsFailed: failedCountries > 0,
    };
  }

  function shortfall(gathered) {
    const out = [];
    const miss = gathered.missing || [];
    if (miss.length === 1) {
      out.push("The " + Data.name(miss[0]) + " shop could not be read. Planned "
               + "without it.");
    } else if (miss.length) {
      out.push(miss.length + " shops could not be read. Planned without them.");
    }
    if (gathered.someForecastsFailed) {
      out.push("Some countries could not be forecast. Planned without them.");
    }
    return out.length ? out.join(" ") : null;
  }

  async function planDay() {
    return build({ explicit: true });
  }

  async function replanTail(reason) {

    if (!Trip.get().active) return { skipped: "no_plan" };
    if (Trip.get().endsAt && Date.now() >= Trip.get().endsAt) return { skipped: "ended" };
    const gate = Trip.canReplan();
    if (!gate.ok) return { skipped: gate.why };
    if (Date.now() - lastAutoAt < AUTO_REPLAN_MIN_GAP_MS) return { skipped: "too_soon" };
    lastAutoAt = Date.now();
    return build({ explicit: false, reason });
  }

  async function build({ explicit, reason }) {
    if (running) return { skipped: "already_running" };
    running = true;
    lastError = null;
    Bus.emit("plan:start", { explicit, reason });

    try {

      const revision = Trip.revision();

      const origin = Math.max(Date.now(), Trip.earliestHome());

      const t = Trip.get();
      const fresh = !(t.active && Trip.started()) || Trip.dayOver();
      const keepEnd = !fresh && t.endsAt && Date.now() < t.endsAt;
      const endTime = keepEnd ? t.endsAt : origin + Settings.get("end_hours") * 3600_000;

      const gathered = await gather(origin);
      const { items, seenAt } = gathered;

      stage = "Searching for the best plan";
      Bus.emit("plan:stage", stage);

      const cooldown = await drugCooldown();

      const offer = explicit && fresh;
      const found = await runSearch({
        items, cfg: config(origin, seenAt, items, cooldown, endTime),
        count: offer ? CHOICES : 0,
      });
      const legs = offer ? (found[0] || []) : found;

      const partial = shortfall(gathered);

      if ((!legs || !legs.length) && !explicit && Trip.get().active
          && !Trip.get().runtime.some((rt) => rt.status === "pending")) {
        return finish({ ok: true, legs: [] }, { skipped: "ended" });
      }

      if (!legs || !legs.length) {

        lastError = gathered.allForecastsFailed && gathered.forecastError
          ? gathered.forecastError + " Without forecasts there is nothing to plan."
          : keepEnd
            ? "No profitable flights found before this plan ends."
            : "No profitable flights found in the next " + Settings.get("end_hours") + " hours.";
        if (partial) lastError += " " + partial;
        return finish({ ok: false, message: lastError });
      }

      const readAge = seenAt ? Date.now() - Date.parse(seenAt) : 0;
      const stale = readAge > SHELF_WARN_MS
        ? "Planned on stock up to " + Math.round(readAge / 60_000) + " minutes old."
        : null;
      const note = [partial, stale].filter(Boolean).join(" ") || null;

      if (Trip.revision() !== revision) {
        Env.log.info("Plan discarded: it changed while it was being built.");
        return finish({ ok: true, legs: [] }, { skipped: "superseded" });
      }

      if (offer && found.length > 1) {
        choices = { days: found, note, endTime, at: Date.now() };
        return finish({ ok: true, legs: [], choices: found.length }, { ok: true, choices: found.length });
      }

      if (!Trip.get().active || !Trip.started() || Trip.dayOver()) {
        Trip.adopt(legs, note, endTime);
        Alerts.forgetOtherPlans();
      } else {
        Trip.replaceTail(legs, note, endTime);

        Alerts.forgetFrom(Trip.get().preserved);
      }

      Escort.upload(Trip.get().legs);
      return finish({ ok: true, legs, note }, { ok: true, legs });
    } catch (err) {
      lastError = err.message || String(err);
      Env.log.error("planning failed", lastError);
      return finish({ ok: false, message: lastError });
    }
  }

  function finish(event, result) {
    running = false;
    stage = null;
    Bus.emit("plan:done", event);
    return result || event;
  }

  function offered() {
    if (choices && Date.now() - choices.at > CHOICE_TTL_MS) choices = null;
    return choices;
  }

  function choose(i) {
    const c = offered();
    choices = null;
    if (!c || !c.days[i] || (Trip.started() && !Trip.dayOver())) return false;
    Trip.adopt(c.days[i], c.note, c.endTime);
    Alerts.forgetOtherPlans();
    Escort.upload(Trip.get().legs);
    Bus.emit("plan:done", { ok: true, legs: c.days[i] });
    return true;
  }

  function stop() {
    choices = null;
    Trip.stop("You stopped the plan.");
    Alerts.reset();
    Escort.clear();
    Bus.emit("plan:done", { ok: true, legs: [] });
  }

  function status() {
    return { running, stage, lastError };
  }

  return { planDay, replanTail, stop, status, config, offered, choose,
           dismiss: () => { choices = null; } };
})();

const Page = (() => {
  "use strict";

  const PANEL_ID = "oracle-panel";

  function mode() {
    if (document.body.dataset.traveling === "true") return "flight";

    if (abroadOnPage()) return "abroad";
    if (agencyOnPage() || blockedAgencyOnPage()) return "agency";
    return "other";
  }

  const TYPE_OPTION_RE = /^option-(?:Standard|Airstrip|Private|Business)-([1-4])$/;
  const DEST_OPTION_RE = /^option-[A-Za-z-]+-(\d+)$/;

  function agencyOnPage() {
    return !!(document.querySelector('button[aria-label="Next flight type"]')
              || typeOptions().length
              || mapPins().length);
  }

  function options() {
    return [...document.querySelectorAll('li[role="option"][id^="option-"]')];
  }

  function typeOptions() {
    return options().filter((li) => TYPE_OPTION_RE.test(li.id));
  }

  function destinationOptions() {
    return options().filter((li) => !TYPE_OPTION_RE.test(li.id) && DEST_OPTION_RE.test(li.id));
  }

  function mapPins() {
    return [...document.querySelectorAll("button[aria-pressed][aria-label]")]
      .filter((b) => codeFromText(b.getAttribute("aria-label")));
  }

  function hasMap() {
    return destinationOptions().length > 0 || mapPins().length > 0;
  }

  function blockedAgencyOnPage() {
    for (const h of document.querySelectorAll("h1, h2, h3, h4")) {
      if (/^\s*travel agency\s*$/i.test(h.textContent || "")) return true;
    }
    return false;
  }

  function abroadOnPage() {
    return document.body.dataset.abroad === "true" && !agencyOnPage();
  }

  function insertionPoint(node, panel) {
    let next = node.nextSibling;
    while (next) {
      const blank = next.nodeType === 3 && !next.textContent.trim();
      const clear = next.nodeType === 1 && next.classList.contains("clear");
      if (!blank && !clear && next !== panel) break;
      next = next.nextSibling;
    }
    return next;
  }

  function mountPoint(panel, currentMode) {

    const tt = currentMode === "flight" ? null : document.querySelector("#travelDestinations");
    if (tt && tt.parentNode) {
      return { parent: tt.parentNode, before: insertionPoint(tt, panel) };
    }
    const root = document.querySelector("#travel-root");
    if (root && root.parentNode) {
      return { parent: root.parentNode, before: insertionPoint(root, panel) };
    }

    const notice = document.querySelector(".info-msg-cont");
    if (notice && notice.parentNode) {
      return { parent: notice.parentNode, before: insertionPoint(notice, panel) };
    }
    const wrap = document.querySelector(".content-wrapper");
    return { parent: wrap || document.body, before: null };
  }

  let placing = false;

  function place(panel, currentMode) {
    if (placing || !panel) return;
    const spot = mountPoint(panel, currentMode);
    if (panel.parentNode === spot.parent && panel.nextSibling === spot.before) return;
    placing = true;
    try { spot.parent.insertBefore(panel, spot.before); }
    finally { placing = false; }
  }

  function selectedTravelType() {
    const li = typeOptions().find((o) => o.getAttribute("aria-selected") === "true");
    return li ? (Data.TRAVEL_BY_INDEX[TYPE_OPTION_RE.exec(li.id)[1]] || null) : null;
  }

  function codeFromText(text) {
    if (!text) return null;
    const lower = text.trim().toLowerCase();
    for (const name of Object.keys(Data.CODE_BY_NAME)) {
      if (lower.startsWith(name)) return Data.CODE_BY_NAME[name];
    }
    return null;
  }

  function codeFromOption(li) {
    const m = DEST_OPTION_RE.exec(li.id);
    return m ? (CODE_BY_TORN_ID[m[1]] || null) : null;
  }

  function selectedDestination() {
    const li = destinationOptions().find((o) => o.getAttribute("aria-selected") === "true");
    if (li) return codeFromOption(li);
    const pin = mapPins().find((b) => b.getAttribute("aria-pressed") === "true");
    return pin ? codeFromText(pin.getAttribute("aria-label")) : null;
  }

  const TORN_IDS = { mex: 2, haw: 3, sou: 4, jap: 5, chi: 6, arg: 7, swi: 8,
                     can: 9, uni: 10, uae: 11, cay: 12 };
  const CODE_BY_TORN_ID = {};
  for (const [code, id] of Object.entries(TORN_IDS)) CODE_BY_TORN_ID[String(id)] = code;

  function destinationControl(code) {
    const pin = mapPins().find((b) => codeFromText(b.getAttribute("aria-label")) === code);
    if (pin) return { el: pin, chosen: () => pin.getAttribute("aria-pressed") === "true" };
    const li = destinationOptions().find((o) => codeFromOption(o) === code);
    return li ? { el: li, chosen: () => li.getAttribute("aria-selected") === "true" } : null;
  }

  function canPreselect(code) {
    return mode() === "agency" && destinationControl(code) !== null;
  }

  function preselect(code, scroll = true) {
    const found = mode() === "agency" ? destinationControl(code) : null;
    if (!found) return false;
    if (!found.chosen()) found.el.click();
    if (scroll) found.el.scrollIntoView({ block: "center", behavior: "smooth" });
    return true;
  }

  const HASH_RE = /(?:^#|&)oracle-to=([a-z]{3})\b/;

  function travelLink(code) {
    return "https://www.torn.com/page.php?sid=travel#oracle-to=" + code;
  }

  const LINK_HOLD_MS = 30_000;
  let linked = null;
  let holdTimer = null;

  function followLink() {
    const m = HASH_RE.exec(location.hash || "");
    if (!m || !Data.COUNTRIES[m[1]]) return;
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) {  }
    linked = m[1];
    const until = Date.now() + LINK_HOLD_MS;
    let scrolled = preselect(linked);
    clearInterval(holdTimer);
    holdTimer = setInterval(() => {
      if (!linked || Date.now() > until) {
        clearInterval(holdTimer);
        linked = null;
        return;
      }
      if (preselect(linked, !scrolled)) scrolled = true;
    }, 250);
  }

  document.addEventListener("click", (ev) => {
    if (!linked || !ev.isTrusted || !ev.target.closest) return;
    if (ev.target.closest('li[role="option"], button[aria-pressed]')) linked = null;
  }, true);

  function darkMode() {
    return document.body.classList.contains("dark-mode");
  }

  function watch(onChange) {
    let current = mode();
    if (current === "flight") return () => {};

    const observer = new MutationObserver(() => {
      if (placing) return;
      const next = mode();
      const changed = next !== current;
      current = next;
      onChange(next, changed);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const stop = setTimeout(() => observer.disconnect(), 30_000);
    return () => { clearTimeout(stop); observer.disconnect(); };
  }

  function onFormChange(fn) {
    let type = selectedTravelType();
    let dest = selectedDestination();
    let packed = "";
    let timer = null;
    const check = () => {
      timer = null;
      const t = selectedTravelType();
      if (t && t !== type) fn("travelType", t);
      type = t || type;
      const d = selectedDestination();
      if (d && d !== dest) fn("destination", d);
      dest = d || dest;
      const inv = mode() === "agency" ? travelInventory() : null;
      const k = inventoryKey(inv);
      if (inv && k !== packed) fn("inventory", inv);
      packed = k;
    };
    const later = (ev) => {
      if (!ev.isTrusted || mode() !== "agency") return;
      clearTimeout(timer);
      timer = setTimeout(check, 250);
    };
    document.addEventListener("click", later, true);
    document.addEventListener("keyup", later, true);
    check();
    return check;
  }

  function travelInventory() {
    const list = document.querySelector('ul[aria-label^="Inventory"]');
    if (!list) return null;
    const slots = list.querySelectorAll(":scope > li").length;
    const m = /(\d+)/.exec(list.getAttribute("aria-label") || "");
    if (!slots || !m) return null;
    const items = [];
    for (const b of list.querySelectorAll(":scope > li > button[aria-label]")) {
      const name = /^(.*) slot \d+$/.exec(b.getAttribute("aria-label"));
      if (name) items.push(name[1]);
    }
    return { slots, packed: Number(m[1]), items };
  }

  function inventoryKey(inv) {
    return inv ? inv.slots + "/" + inv.packed + "/" + inv.items.join("|") : "";
  }

  function shopRows() {
    const out = [];
    for (const form of document.querySelectorAll('#travel-root form[id^="item-"][id$="-form"]')) {
      const id = Number(/^item-(\d+)-form$/.exec(form.id)?.[1]);
      const row = form.closest("li");
      if (!id || !row) continue;
      const nameEl = row.querySelector('button[aria-controls$="-itemInfoWrapper"]');
      let stock = null;
      for (const label of row.querySelectorAll("span")) {
        if (label.textContent.trim() !== "stock" || !label.parentElement) continue;
        stock = Number(label.parentElement.textContent.replace(/\D/g, ""));
        break;
      }
      const priceEl = row.querySelector('[class*="displayPrice"]');
      const price = priceEl ? Number(priceEl.textContent.replace(/\D/g, "")) : null;
      if (stock === null || !isFinite(stock)) continue;
      out.push({ id, name: nameEl ? nameEl.textContent.trim() : "", stock, price });
    }
    return out;
  }

  function shopWallet() {
    for (const msg of document.querySelectorAll("#travel-root .msg")) {
      const text = msg.textContent || "";
      const money = /have \$([\d,]+)/.exec(text);
      const used = /purchased (\d+) \/ (\d+)/.exec(text);
      if (money && used) {
        return { money: Number(money[1].replace(/,/g, "")),
                 taken: Number(used[1]), capacity: Number(used[2]) };
      }
    }
    return null;
  }

  function hospitalLayout() {
    return document.body.dataset.layout === "hospital";
  }

  function placeBar(bar) {
    const root = document.querySelector("#travel-root");
    if (!root || !root.parentNode) {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
      return;
    }
    if (bar.nextSibling === root) return;
    placing = true;
    try { root.parentNode.insertBefore(bar, root); }
    finally { placing = false; }
  }

  return {
    PANEL_ID, mode, agencyOnPage, hasMap, place, watch, onFormChange,
    selectedTravelType, selectedDestination, travelInventory, darkMode,
    shopRows, shopWallet, hospitalLayout, placeBar,
    canPreselect, preselect, travelLink, followLink,
  };
})();

const Style = (() => {
  "use strict";

  const CSS = `
#oracle-panel {
  --o-bg: #ffffff;
  --o-bg-sunk: #f4f6f8;
  --o-bg-raise: #ffffff;
  --o-line: #dde3e9;
  --o-text: #10161c;
  --o-dim: #4a5763;
  --o-faint: #626f7c;
  --o-accent: #0d9488;
  --o-accent-soft: #ccfbf1;
  --o-go: #047857;
  --o-go-soft: #d1fae5;
  --o-warn: #b45309;
  --o-warn-soft: #fef3c7;
  --o-bad: #b91c1c;
  --o-bad-soft: #fee2e2;
  --o-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --o-radius: 10px;
  color-scheme: light;

  container-type: inline-size;
  container-name: oracle;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  margin: 10px 0;
  border: 1px solid var(--o-line);
  border-radius: var(--o-radius);
  background: var(--o-bg);
  color: var(--o-text);
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  overflow: hidden;
}
#oracle-panel.o-dark {
  --o-bg: #171d24;
  --o-bg-sunk: #10151b;
  --o-bg-raise: #1e262f;
  --o-line: #2c3742;
  --o-text: #e7edf3;
  --o-dim: #b3c0cd;
  --o-faint: #97a5b3;
  --o-accent: #2dd4bf;
  --o-accent-soft: #134e4a;
  --o-go: #34d399;
  --o-go-soft: #064e3b;
  --o-warn: #fbbf24;
  --o-warn-soft: #451a03;
  --o-bad: #f87171;
  --o-bad-soft: #450a0a;
  color-scheme: dark;
}
#oracle-panel *, #oracle-panel *::before, #oracle-panel *::after { box-sizing: inherit; }
#oracle-panel table, #oracle-panel tr, #oracle-panel th, #oracle-panel td,
#oracle-panel p, #oracle-panel h4, #oracle-panel b, #oracle-panel label,
#oracle-panel span, #oracle-panel div, #oracle-panel summary {
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}

#oracle-panel .o-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  background: var(--o-bg-raise);
  border-bottom: 1px solid var(--o-line);
  cursor: pointer;
  user-select: none;
}
#oracle-panel.o-collapsed .o-head { border-bottom: 0; }
#oracle-panel .o-brand {
  display: inline-flex; align-items: center; gap: 6px;
  font-weight: 700; letter-spacing: .02em; color: var(--o-accent);
  flex: 0 0 auto;
}
#oracle-panel .o-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--o-faint); flex: 0 0 auto; }
#oracle-panel .o-dot.is-live { background: var(--o-go); }
#oracle-panel .o-dot.is-warn { background: var(--o-warn); }
#oracle-panel .o-dot.is-bad  { background: var(--o-bad); }
#oracle-panel .o-head-line {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--o-dim);
}
#oracle-panel .o-head-acts { display: flex; gap: 4px; flex: 0 0 auto; }
#oracle-panel .o-caret { width: 14px; height: 14px; fill: currentColor; transition: transform .15s; }
#oracle-panel.o-collapsed .o-caret { transform: rotate(-90deg); }
#oracle-panel.o-collapsed .o-body { display: none; }

#oracle-panel .o-update {
  padding: 6px 10px; font-size: 12px; font-weight: 600;
  background: var(--o-warn-soft); color: var(--o-warn); border-bottom: 1px solid var(--o-line);
}
#oracle-panel .o-update[hidden] { display: none; }
#oracle-panel .o-update a { color: inherit; text-decoration: underline; }

#oracle-panel .o-tabs {
  display: flex; gap: 2px; padding: 6px 6px 0;
  background: var(--o-bg-raise);
  border-bottom: 1px solid var(--o-line);
  overflow-x: auto; scrollbar-width: none;
}
#oracle-panel .o-tabs::-webkit-scrollbar { display: none; }
#oracle-panel .o-tab {
  appearance: none; border: 0; background: transparent;
  color: var(--o-dim); font: inherit; font-weight: 600;
  padding: 7px 11px; border-radius: 8px 8px 0 0;
  cursor: pointer; white-space: nowrap;
  border-bottom: 2px solid transparent;
}
#oracle-panel .o-tab:hover { color: var(--o-text); background: var(--o-bg-sunk); }
#oracle-panel .o-tab.is-on { color: var(--o-accent); border-bottom-color: var(--o-accent); background: var(--o-bg); }
#oracle-panel .o-tab .o-pip {
  display: inline-block; min-width: 16px; padding: 0 4px; margin-left: 5px;
  border-radius: 8px; background: var(--o-accent); color: #fff;
  font-size: 10px; line-height: 16px; text-align: center; font-weight: 700;
}
#oracle-panel .o-tab .o-pip[hidden] { display: none; }

#oracle-panel .o-pane { padding: 10px; display: none; }
#oracle-panel .o-pane.is-on { display: block; }

#oracle-panel .o-flash {
  display: flex; align-items: center; gap: 8px;
  margin: 0 0 10px; padding: 7px 10px; border-radius: 8px;
  background: var(--o-accent-soft); color: var(--o-text); font-size: 12px;
  animation: o-in .15s ease-out;
}
#oracle-panel .o-flash.is-warn { background: var(--o-warn-soft); color: var(--o-warn); }
#oracle-panel .o-flash.is-bad { background: var(--o-bad-soft); color: var(--o-bad); }
#oracle-panel .o-flash > span { flex: 1 1 auto; min-width: 0; }
#oracle-panel .o-flash button.o-icon { color: inherit; padding: 2px 4px; line-height: 1; font-size: 15px; }
@keyframes o-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }

#oracle-panel .o-now {
  border: 1px solid var(--o-line); border-radius: var(--o-radius);
  background: var(--o-bg-sunk); overflow: hidden; margin-bottom: 10px;
}
#oracle-panel .o-now.is-go { border-color: var(--o-go); background: var(--o-go-soft); }
#oracle-panel .o-now.is-warn { border-color: var(--o-warn); background: var(--o-warn-soft); }
#oracle-panel .o-now.is-bad { border-color: var(--o-bad); background: var(--o-bad-soft); }
#oracle-panel .o-now > .o-acts { margin: 0; padding: 0 10px 10px; }

#oracle-panel .o-where {
  display: flex; align-items: center; gap: 6px;
  padding: 0 2px 8px; font-size: 11px; color: var(--o-dim);
}
#oracle-panel .o-where b { color: var(--o-text); font-weight: 600; }
#oracle-panel .o-where .o-age { margin-left: auto; font-family: var(--o-mono); font-size: 10px; color: var(--o-faint); }
#oracle-panel .o-where.is-stale { color: var(--o-warn); }

#oracle-panel .o-do { display: flex; align-items: center; gap: 12px; padding: 10px; }
#oracle-panel .o-meter { flex: 0 0 auto; text-align: center; min-width: 78px; }
#oracle-panel .o-clock {
  display: block; font-family: var(--o-mono); font-size: 26px; font-weight: 700;
  line-height: 1.05; letter-spacing: -.02em; font-variant-numeric: tabular-nums;
}
#oracle-panel .o-cap { display: block; font-size: 10px; color: var(--o-dim); text-transform: uppercase; letter-spacing: .06em; }
#oracle-panel .o-what { flex: 1 1 auto; min-width: 0; }
#oracle-panel .o-what-main { display: block; font-size: 14px; font-weight: 600; }
#oracle-panel .o-what-sub { display: block; font-size: 11px; color: var(--o-dim); margin-top: 2px; }
#oracle-panel .o-rail { height: 3px; background: var(--o-line); }
#oracle-panel .o-rail > i { display: block; height: 100%; background: var(--o-accent); }

#oracle-panel .o-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
#oracle-panel table { width: 100%; border-collapse: collapse; font-size: 12px; }
#oracle-panel th {
  text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .05em; color: var(--o-faint);
  padding: 6px 8px; border-bottom: 1px solid var(--o-line); white-space: nowrap;
}
#oracle-panel td { padding: 7px 8px; border-bottom: 1px solid var(--o-line); vertical-align: top; color: var(--o-text); }
#oracle-panel.o-compact td { padding: 4px 8px; }
#oracle-panel tbody tr:last-child td { border-bottom: 0; }
#oracle-panel tfoot td { border-top: 1px solid var(--o-line); border-bottom: 0; font-size: 11px; color: var(--o-dim); }
#oracle-panel td.num, #oracle-panel th.num { text-align: right; font-variant-numeric: tabular-nums; }
#oracle-panel .o-mono, #oracle-panel .clock { font-family: var(--o-mono); }
#oracle-panel .o-sub { display: block; font-size: 10px; color: var(--o-faint); margin-top: 1px; }

#oracle-panel .o-choices {
  display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch; padding-bottom: 6px; margin-bottom: 10px;
}
#oracle-panel .o-choice {
  flex: 0 0 min(260px, 88%); scroll-snap-align: start; display: flex; flex-direction: column;
  border: 1px solid var(--o-line); border-radius: var(--o-radius); background: var(--o-bg-sunk);
  padding: 10px;
}
#oracle-panel .o-choice-head { margin-bottom: 8px; }
#oracle-panel .o-choice-head b { font-size: 16px; }
#oracle-panel .o-choice-runs { list-style: none; margin: 0 0 10px; padding: 0; flex: 1 1 auto; }
#oracle-panel .o-choice-runs li {
  display: grid; grid-template-columns: 44px 1fr; gap: 6px; padding: 5px 0;
  border-bottom: 1px solid var(--o-line); font-size: 12px;
}
#oracle-panel .o-choice-runs li:last-child { border-bottom: 0; }
#oracle-panel tr.o-cat td {
  padding: 8px 8px 4px; font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .05em; color: var(--o-faint);
}
#oracle-panel tr.leg-done td:first-child { box-shadow: inset 3px 0 0 var(--o-go); }
#oracle-panel tr.leg-live td:first-child { box-shadow: inset 3px 0 0 var(--o-accent); }
#oracle-panel tr.leg-late td:first-child { box-shadow: inset 3px 0 0 var(--o-warn); }
#oracle-panel tr.leg-missed td:first-child { box-shadow: inset 3px 0 0 var(--o-bad); }
#oracle-panel tr.leg-done { opacity: .62; }

#oracle-panel .o-mhead {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  margin: 0 0 8px; font-size: 12px;
}
#oracle-panel .o-sets { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0 10px; align-items: start; }
#oracle-panel .o-sect.o-mset > summary::after { margin-left: 4px; }
#oracle-panel .o-mset-state { margin-left: auto; font-size: 11px; font-weight: 600; white-space: nowrap; }
#oracle-panel .o-mset .o-sect-body { padding: 4px 0; }
#oracle-panel table.o-set { table-layout: fixed; }
#oracle-panel table.o-set col.o-set-where { width: 42%; }
#oracle-panel table.o-set col.o-set-n { width: 64px; }
#oracle-panel table.o-set td { padding: 4px 8px; }
#oracle-panel table.o-set td:nth-child(2) { font-size: 11px; color: var(--o-dim); }
#oracle-panel table.o-set td button.o-link { display: inline; margin: 0; padding: 0; font-size: 11px; }

#oracle-panel button.o-btn {
  appearance: none; font: inherit; font-weight: 600; cursor: pointer;
  padding: 6px 12px; border-radius: 8px;
  border: 1px solid var(--o-line); background: var(--o-bg-raise); color: var(--o-text);
}
#oracle-panel button.o-btn:hover { border-color: var(--o-accent); color: var(--o-accent); }
#oracle-panel button.o-btn.is-primary { background: var(--o-accent); border-color: var(--o-accent); color: #fff; }
#oracle-panel button.o-btn.is-primary:hover { filter: brightness(1.08); color: #fff; }
#oracle-panel button.o-btn:disabled { opacity: .45; cursor: not-allowed; }
#oracle-panel button.o-btn.is-busy:disabled { opacity: 1; cursor: progress; }
#oracle-panel button.o-icon {
  appearance: none; border: 0; background: transparent; color: var(--o-dim);
  padding: 4px; border-radius: 6px; cursor: pointer; line-height: 0;
}
#oracle-panel button.o-icon:hover { background: var(--o-bg-sunk); color: var(--o-accent); }
#oracle-panel .o-ic { width: 15px; height: 15px; fill: currentColor; }
#oracle-panel .o-acts { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 10px; }
#oracle-panel .o-acts .o-grow { flex: 1 1 auto; }
#oracle-panel button.o-link {
  appearance: none; border: 0; background: transparent; padding: 2px 0;
  font: inherit; font-size: 11px; color: var(--o-accent); cursor: pointer;
  text-decoration: underline; text-underline-offset: 2px;
}
#oracle-panel td button.o-link { display: block; margin-left: auto; font-size: 10px; color: var(--o-dim); }
#oracle-panel button.o-link:hover { color: var(--o-accent); }

#oracle-panel input[type=text], #oracle-panel input[type=number], #oracle-panel input[type=password], #oracle-panel select {
  font: inherit; padding: 5px 7px; border-radius: 7px;
  border: 1px solid var(--o-line); background: var(--o-bg); color: var(--o-text);
  max-width: 100%;
}
#oracle-panel input:focus-visible, #oracle-panel select:focus-visible, #oracle-panel button:focus-visible, #oracle-panel summary:focus-visible {
  outline: 2px solid var(--o-accent); outline-offset: 1px;
}
#oracle-panel .o-hours { width: auto; padding: 5px 6px; }

#oracle-panel .o-note { margin-top: 8px; font-size: 11px; color: var(--o-dim); }
#oracle-panel .o-note.is-warn { color: var(--o-warn); }
#oracle-panel .o-note.is-bad { color: var(--o-bad); }
#oracle-panel .o-note b { color: inherit; font-weight: 700; }
#oracle-panel .o-banner {
  margin-bottom: 10px; padding: 8px 10px; border-radius: 8px;
  background: var(--o-bad-soft); color: var(--o-bad); font-size: 12px;
}
#oracle-panel .o-empty { padding: 22px 10px; text-align: center; color: var(--o-faint); }
#oracle-panel .o-empty p { margin: 0 0 8px; }
#oracle-panel .go { color: var(--o-go); font-weight: 600; }
#oracle-panel .warn { color: var(--o-warn); font-weight: 600; }
#oracle-panel .bad { color: var(--o-bad); font-weight: 600; }
#oracle-panel .muted { color: var(--o-faint); }
#oracle-panel .money { font-variant-numeric: tabular-nums; }

#oracle-panel .o-buy {
  margin-top: 10px; padding: 10px; border-radius: 10px;
  background: var(--o-bg); border: 1px solid var(--o-line);
}
#oracle-panel .o-now .o-buy { margin: 0 10px 10px; }
#oracle-panel .o-buy-head { font-weight: 600; margin-bottom: 8px; }
#oracle-panel .o-buy-line { display: grid; grid-template-columns: minmax(0,1fr) 72px 24px; gap: 6px; align-items: center; margin-bottom: 6px; }
#oracle-panel .o-buy-line select, #oracle-panel .o-buy-line input { width: 100%; }

#oracle-panel .o-sect {
  border: 1px solid var(--o-line); border-radius: 8px;
  background: var(--o-bg); margin-bottom: 5px; overflow: hidden;
}
#oracle-panel .o-sect > summary {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; cursor: pointer; user-select: none; list-style: none;
}
#oracle-panel .o-sect > summary::-webkit-details-marker { display: none; }
#oracle-panel .o-sect > summary::after {
  content: ""; flex: 0 0 auto; width: 6px; height: 6px; margin: 0 3px 0 auto;
  border-right: 2px solid var(--o-dim); border-bottom: 2px solid var(--o-dim);
  transform: rotate(-45deg); transition: transform .15s;
}
#oracle-panel .o-sect[open] > summary::after { transform: rotate(45deg); }
#oracle-panel .o-sect > summary:hover { background: var(--o-bg-sunk); }
#oracle-panel .o-sect-text { display: flex; flex-direction: column; min-width: 0; }
#oracle-panel .o-sect-title { font-size: 13px; line-height: 1.3; font-weight: 700; color: var(--o-text); }
#oracle-panel .o-sect[open] .o-sect-title { color: var(--o-accent); }
#oracle-panel .o-sect-hint {
  font-size: 10px; line-height: 1.3; color: var(--o-faint);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#oracle-panel .o-sect[open] .o-sect-hint { display: none; }
#oracle-panel .o-sect-body {
  margin: 0 6px 6px; padding: 0 10px;
  border-radius: 6px; background: var(--o-bg-sunk);
}
#oracle-panel .o-sect > .o-sect-body:first-child { margin-top: 6px; }

#oracle-panel .o-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 0; border-bottom: 1px solid var(--o-line);
}
#oracle-panel .o-row:last-child { border-bottom: 0; }
#oracle-panel .o-row.is-found { animation: o-found 1.6s ease-out; }
@keyframes o-found { from { background: color-mix(in srgb, var(--o-accent) 22%, transparent); } to { background: transparent; } }
#oracle-panel .o-row.is-stack { flex-direction: column; align-items: stretch; gap: 8px; }
#oracle-panel .o-row-text { flex: 1 1 auto; min-width: 0; }
#oracle-panel .o-row-label { display: block; font-size: 12px; font-weight: 500; color: var(--o-text); }
#oracle-panel .o-row-help { display: block; font-size: 11px; color: var(--o-faint); margin-top: 1px; }
#oracle-panel .o-row-ctl { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }
#oracle-panel .o-unit { display: inline-flex; align-items: center; gap: 4px; color: var(--o-faint); font-size: 11px; }
#oracle-panel .o-unit input { width: 6.5em; text-align: right; }
#oracle-panel .o-unit input.o-money { width: 9em; }
#oracle-panel .o-picks { display: flex; flex-direction: column; gap: 4px; width: 100%; }
#oracle-panel .o-pick { border: 1px solid var(--o-line); border-radius: 7px; background: var(--o-bg); }
#oracle-panel .o-pick > summary {
  display: flex; justify-content: space-between; gap: 8px; padding: 5px 9px;
  font-size: 12px; cursor: pointer; list-style: none;
}
#oracle-panel .o-pick > summary::-webkit-details-marker { display: none; }
#oracle-panel .o-pick-state { font-size: 11px; color: var(--o-faint); }
#oracle-panel .o-pick-state.is-on { color: var(--o-accent); font-weight: 600; }
#oracle-panel .o-pick > .o-chips { padding: 2px 9px 8px; }
#oracle-panel .o-pick > button.o-link { margin: 0 9px 8px; }
#oracle-panel textarea.o-share {
  width: 100%; box-sizing: border-box; resize: vertical;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 7px;
  border-radius: 7px; border: 1px solid var(--o-line); background: var(--o-bg); color: var(--o-text);
}
#oracle-panel .o-state { font-size: 11px; font-weight: 600; }
#oracle-panel button.o-disclose {
  appearance: none; width: 100%; margin: 0; text-align: left; font: inherit; color: inherit;
  background: transparent; border: 0; border-bottom: 1px solid var(--o-line); cursor: pointer;
}
#oracle-panel button.o-disclose::after {
  content: ""; flex: 0 0 auto; width: 6px; height: 6px; margin: 0 5px 0 auto;
  border-right: 2px solid var(--o-dim); border-bottom: 2px solid var(--o-dim);
  transform: rotate(-45deg); transition: transform .15s;
}
#oracle-panel button.o-disclose[aria-expanded=true]::after { transform: rotate(45deg); }
#oracle-panel button.o-disclose:hover .o-row-label { color: var(--o-accent); }
#oracle-panel .o-row:has(+ .o-subrows) { border-bottom: 0; padding-bottom: 4px; }
#oracle-panel .o-subrows {
  margin: 0 0 0 18px; padding: 0 0 10px 12px;
  border-left: 1px solid var(--o-line); border-bottom: 1px solid var(--o-line);
}
#oracle-panel .o-subrows:last-child { border-bottom: 0; }
#oracle-panel .o-subrows .o-row { padding: 6px 0; border-bottom: 0; }
#oracle-panel .o-subrows .o-row-label { font-size: 11px; font-weight: 400; color: var(--o-dim); }
#oracle-panel .o-subrows .o-row-help { font-size: 10px; }
#oracle-panel .o-subrows .o-acts { margin-top: 6px; }
#oracle-panel .o-spin {
  display: inline-block; width: 11px; height: 11px; margin-right: 6px; vertical-align: -1px;
  border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
  animation: o-rot .8s linear infinite;
}
@keyframes o-rot { to { transform: rotate(360deg); } }

#oracle-panel .o-switch { position: relative; display: inline-block; width: 34px; height: 20px; flex: 0 0 auto; }
#oracle-panel .o-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
#oracle-panel .o-switch i {
  position: absolute; inset: 0; border-radius: 999px; background: var(--o-line);
  transition: background .15s; pointer-events: none;
}
#oracle-panel .o-switch i::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: transform .15s;
  box-shadow: 0 1px 2px rgba(0,0,0,.3);
}
#oracle-panel .o-switch input:checked + i { background: var(--o-accent); }
#oracle-panel .o-switch input:checked + i::after { transform: translateX(14px); }
#oracle-panel .o-switch input:focus-visible + i { outline: 2px solid var(--o-accent); outline-offset: 2px; }

#oracle-panel .o-group { margin-bottom: 14px; }
#oracle-panel .o-group > h4 {
  margin: 0 0 4px; font-size: 10px; text-transform: uppercase; letter-spacing: .07em;
  color: var(--o-faint); font-weight: 700;
}
#oracle-panel .o-field {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 0; border-bottom: 1px solid var(--o-line);
}
#oracle-panel .o-field:last-child { border-bottom: 0; }
#oracle-panel .o-field-label { flex: 1 1 auto; min-width: 0; font-size: 12px; font-weight: 500; }
#oracle-panel .o-chips { display: flex; flex-wrap: wrap; gap: 4px; }
#oracle-panel svg.o-flag {
  display: inline-block; width: 1.5em; height: 1em; margin-right: .4em;
  vertical-align: -.16em; border-radius: 2px; overflow: hidden; flex: none;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .18);
}
#oracle-panel .o-chip {
  appearance: none; font: inherit; font-size: 11px; cursor: pointer;
  padding: 3px 9px; border-radius: 999px;
  border: 1px solid var(--o-line); background: var(--o-bg); color: var(--o-dim);
}
#oracle-panel .o-chip.is-on {
  background: var(--o-accent-soft); border-color: var(--o-accent); color: var(--o-accent);
  font-weight: 600;
}

#oracle-panel .o-acct-dot {
  display: inline-block; width: 8px; height: 8px; margin-right: 6px; vertical-align: 1px;
  border-radius: 50%; flex: 0 0 auto; background: var(--o-faint);
}
#oracle-panel .o-acct-dot.is-go { background: var(--o-go); }
#oracle-panel .o-acct-dot.is-warn { background: var(--o-warn); }
#oracle-panel .o-acct-dot.is-none { visibility: hidden; }
#oracle-panel .o-keyform { display: flex; gap: 6px; }
#oracle-panel .o-keyform input { flex: 1 1 auto; min-width: 0; }

#oracle-panel .o-foot {
  padding: 6px 12px; border-top: 1px solid var(--o-line);
  background: var(--o-bg-raise); text-align: center;
}
#oracle-panel .o-support { margin: 0; font-size: 10px; color: var(--o-faint); }
#oracle-panel .o-support a { color: var(--o-accent); text-decoration: none; font-weight: 600; }
#oracle-panel .o-support a:hover { text-decoration: underline; }

#oracle-panel.o-minimal .o-sub, #oracle-panel.o-minimal .o-where, #oracle-panel.o-minimal .o-col-mid,
#oracle-panel.o-minimal .o-col-extra, #oracle-panel.o-minimal .o-cap, #oracle-panel.o-minimal .o-rail,
#oracle-panel.o-minimal .o-note:not(.is-warn):not(.is-bad), #oracle-panel.o-minimal .o-row-help:not(.o-keep),
#oracle-panel.o-minimal .o-sect-hint, #oracle-panel.o-minimal tfoot,
#oracle-panel.o-minimal .o-spare { display: none; }
#oracle-panel.o-minimal .o-clock { font-size: 20px; }
#oracle-panel.o-minimal .o-meter { min-width: 56px; }
#oracle-panel.o-minimal .o-do { padding: 8px 10px; }
#oracle-panel.o-minimal td { padding: 5px 8px; }

@container oracle (max-width: 460px) {
  #oracle-panel .o-tabs .o-tab { flex: 1 1 auto; padding: 8px 4px; text-align: center; font-size: 12px; }
  #oracle-panel .o-clock { font-size: 22px; }
  #oracle-panel .o-meter { min-width: 66px; }
  #oracle-panel .o-acts button.o-btn { flex: 1 1 auto; }
  #oracle-panel .o-row.is-wrap { flex-wrap: wrap; }
  #oracle-panel .o-row.is-wrap .o-row-ctl { width: 100%; }
  #oracle-panel .o-row.is-wrap .o-row-ctl select { width: 100%; }
  #oracle-panel .o-buy-line { grid-template-columns: minmax(0,1fr) 60px 24px; }
}
@container oracle (max-width: 340px) {
  #oracle-panel .o-col-mid { display: none; }
  #oracle-panel .o-do { flex-direction: column; align-items: stretch; text-align: center; gap: 6px; }
}
@media (pointer: coarse) {
  #oracle-panel button.o-btn, #oracle-panel select, #oracle-panel input[type=text], #oracle-panel input[type=number],
  #oracle-panel input[type=password] { min-height: 34px; }
  #oracle-panel .o-tab { padding: 9px 12px; }
  #oracle-panel td, #oracle-panel th { padding: 9px 8px; }
  #oracle-panel table.o-set td { padding: 7px 8px; }
}
@media (prefers-reduced-motion: reduce) {
  #oracle-panel *, #oracle-panel *::before, #oracle-panel *::after { transition: none !important; animation: none !important; }
  #oracle-panel .o-spin { animation: o-rot 2s linear infinite !important; }
}

#oracle-panel button.o-news-pill {
  appearance: none; border: 0; cursor: pointer; font: inherit; font-size: 11px; font-weight: 700;
  padding: 2px 8px; border-radius: 999px; background: var(--o-accent); color: #fff;
}
#oracle-panel button.o-news {
  display: block; width: 100%; text-align: left; appearance: none; cursor: pointer;
  padding: 6px 10px; font: inherit; font-size: 12px; font-weight: 600;
  border: 0; border-bottom: 1px solid var(--o-line);
  background: var(--o-accent-soft); color: var(--o-accent);
}
#oracle-panel [hidden].o-news, #oracle-panel [hidden].o-news-pill { display: none; }
#oracle-panel .o-notice {
  margin: 0 0 12px; padding: 14px 16px 12px;
  background: var(--o-bg-raise); border: 1px solid var(--o-line);
  border-left: 4px solid var(--o-accent); border-radius: var(--o-radius);
}
#oracle-panel .o-notice:last-child { margin-bottom: 0; }
#oracle-panel .o-notice h4 { margin: 0; font-size: 17px; font-weight: 700; line-height: 1.3; }
#oracle-panel .o-notice-when {
  font-size: 11px; color: var(--o-faint); margin: 4px 0 12px;
  padding-bottom: 10px; border-bottom: 1px solid var(--o-line);
}
#oracle-panel .o-notice-body { font-size: 14px; line-height: 1.65; max-width: 68ch; }
#oracle-panel .o-notice-body.is-clamped {
  max-height: 8.25em; overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom, #000 55%, transparent);
  mask-image: linear-gradient(to bottom, #000 55%, transparent);
}
#oracle-panel .o-notice > button.o-link { margin-top: 6px; font-size: 12px; font-weight: 600; }
#oracle-panel .o-notice-body p { margin: 0 0 12px; }
#oracle-panel .o-notice-body > :last-child { margin-bottom: 0; }
#oracle-panel .o-notice-body strong { color: inherit; font-weight: 700; }
#oracle-panel .o-notice-body a { color: var(--o-accent); }
#oracle-panel .o-notice-body ol {
  margin: 4px 0 14px; padding: 0; list-style: none; counter-reset: o-step;
}
#oracle-panel .o-notice-body li {
  position: relative; margin: 0 0 10px; padding: 10px 12px 10px 44px;
  background: var(--o-bg-sunk); border-radius: 8px;
  color: inherit; font: inherit; list-style: none; counter-increment: o-step;
}
#oracle-panel .o-notice-body li::before {
  content: counter(o-step);
  position: absolute; left: 12px; top: 10px;
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--o-accent-soft); color: var(--o-accent);
  font-size: 12px; font-weight: 700; line-height: 22px; text-align: center;
}
#oracle-panel .o-new {
  font-size: 10px; font-weight: 700; padding: 0 6px; border-radius: 999px;
  background: var(--o-accent); color: #fff; vertical-align: 1px;
}

#oracle-assist {
  --oa-bg: #ffffff; --oa-line: #dde3e9; --oa-text: #10161c; --oa-dim: #4a5763;
  --oa-accent: #0d9488; --oa-go: #047857; --oa-warn: #b45309;
  position: sticky; top: 0; z-index: 50;
  box-sizing: border-box; width: 100%; margin: 0 0 8px;
  padding: 8px 10px; border: 1px solid var(--oa-line); border-radius: 10px;
  background: var(--oa-bg); color: var(--oa-text);
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
#oracle-assist.o-dark {
  --oa-bg: #171d24; --oa-line: #2c3742; --oa-text: #e7edf3; --oa-dim: #b3c0cd;
  --oa-accent: #2dd4bf; --oa-go: #34d399; --oa-warn: #fbbf24;
}
#oracle-assist[hidden] { display: none; }
#oracle-assist * { box-sizing: border-box; }
#oracle-assist .oa-line { display: flex; gap: 8px; align-items: baseline; margin-bottom: 6px; }
#oracle-assist .oa-brand { font-weight: 700; font-size: 11px; color: var(--oa-accent); }
#oracle-assist .oa-note { font-size: 12px; color: var(--oa-dim); }
#oracle-assist button.oa-go {
  appearance: none; display: block; width: 100%; min-height: 44px; cursor: pointer;
  font: inherit; font-size: 15px; font-weight: 700; border-radius: 8px;
  border: 1px solid var(--oa-accent); background: var(--oa-accent); color: #fff;
  touch-action: manipulation; user-select: none;
}
#oracle-assist button.oa-go:disabled {
  cursor: default; background: transparent; color: var(--oa-dim); border-color: var(--oa-line);
}
#oracle-assist.is-ready button.oa-go { background: var(--oa-go); border-color: var(--oa-go); animation: oa-pulse 1.2s ease-in-out 3; }
#oracle-assist .oa-msg { font-size: 12px; color: var(--oa-dim); margin-top: 6px; }
#oracle-assist .oa-msg:empty { display: none; }
#oracle-assist .oa-msg.is-warn { color: var(--oa-warn); }
@keyframes oa-pulse { 50% { filter: brightness(1.25); } }
@media (prefers-reduced-motion: reduce) { #oracle-assist button.oa-go { animation: none !important; } }

#travel-root.tt-clean-flight [class*="viewport___"], #travel-root.tt-travel-table-hide-plane [class*="viewport___"],
:root:has(#pda-remove-plane) #travel-root [class*="viewport___"] { height: auto; }
`;

  function install() {
    if (Env.caps.style) { try { GM_addStyle(CSS); return; } catch (e) {  } }
    const tag = document.createElement("style");
    tag.textContent = CSS;
    (document.head || document.documentElement).appendChild(tag);
  }

  return { install, CSS };
})();

const Flags = (() => {
  "use strict";

  const rect = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

  function star(cx, cy, r, turn = 0) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = turn + (i * Math.PI) / 5 - Math.PI / 2;
      const d = i % 2 ? r * 0.382 : r;
      pts.push((cx + d * Math.cos(a)).toFixed(2) + "," + (cy + d * Math.sin(a)).toFixed(2));
    }
    return `<polygon points="${pts.join(" ")}" fill="#FFDE00"/>`;
  }

  function unionJack(x, y, w, h) {
    const diag = "M0,0L60,30M60,0L0,30";
    const cross = "M30,0V30M0,15H60";
    return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 60 30" preserveAspectRatio="none">`
      + rect(0, 0, 60, 30, "#012169")
      + `<path d="${diag}" stroke="#fff" stroke-width="6"/>`
      + `<path d="${diag}" stroke="#C8102E" stroke-width="2"/>`
      + `<path d="${cross}" stroke="#fff" stroke-width="10"/>`
      + `<path d="${cross}" stroke="#C8102E" stroke-width="6"/></svg>`;
  }

  const MAPLE = "M15,3.2L16.1,5.4L17.4,4.8L17,8.6L18.9,6.8L19.5,8.1L21.2,7.8L20.6,9.9L21.4,10.4"
    + "L18.2,13L18.6,14.2L15.4,13.8L15.35,17H14.65L14.6,13.8L11.4,14.2L11.8,13L8.6,10.4"
    + "L9.4,9.9L8.8,7.8L10.5,8.1L11.1,6.8L13,8.6L12.6,4.8L13.9,5.4Z";

  const ART = {
    mex: rect(0, 0, 10, 20, "#006847") + rect(10, 0, 10, 20, "#fff") + rect(20, 0, 10, 20, "#CE1126")
      + `<circle cx="15" cy="10" r="2.9" fill="none" stroke="#4E7D2E" stroke-width=".7"/>`
      + `<ellipse cx="15" cy="9.6" rx="1.5" ry="1.9" fill="#8A5A2B"/>`,
    cay: rect(0, 0, 30, 20, "#012169") + unionJack(0, 0, 15, 10)
      + `<ellipse cx="22.5" cy="6" rx="1.5" ry=".8" fill="#3A9B5C"/>`
      + `<path d="M20,7.2H25V11.2Q25,14.4 22.5,15.6Q20,14.4 20,11.2Z" fill="#fff"/>`
      + rect(20, 7.2, 5, 2, "#C8102E")
      + `<path d="M20.4,11.3Q21.45,10.6 22.5,11.3T24.6,11.3M20.6,13Q21.55,12.3 22.5,13T24.4,13" `
      + `fill="none" stroke="#012169" stroke-width=".55"/>`,
    can: rect(0, 0, 30, 20, "#fff") + rect(0, 0, 7.5, 20, "#D52B1E") + rect(22.5, 0, 7.5, 20, "#D52B1E")
      + `<path d="${MAPLE}" fill="#D52B1E"/>`,
    haw: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => rect(0, i * 2.5, 30, 2.5, ["#fff", "#C8102E", "#012169"][i % 3])).join("")
      + unionJack(0, 0, 15, 10),
    uni: unionJack(0, 0, 30, 20),
    arg: rect(0, 0, 30, 20, "#74ACDF") + rect(0, 6.67, 30, 6.66, "#fff")
      + `<circle cx="15" cy="10" r="2.5" fill="none" stroke="#F6B40E" stroke-width="1.1" stroke-dasharray=".55 .43"/>`
      + `<circle cx="15" cy="10" r="1.5" fill="#F6B40E" stroke="#85340A" stroke-width=".25"/>`,
    swi: rect(0, 0, 30, 20, "#DA291C") + rect(13.125, 3.75, 3.75, 12.5, "#fff") + rect(8.75, 8.125, 12.5, 3.75, "#fff"),
    jap: rect(0, 0, 30, 20, "#fff") + `<circle cx="15" cy="10" r="6" fill="#BC002D"/>`,
    chi: rect(0, 0, 30, 20, "#EE1C25") + star(5, 5, 3)
      + star(10, 2, 1, 0.9) + star(12, 4, 1, 1.4) + star(12, 7, 1, 2.1) + star(10, 9, 1, 2.6),
    uae: rect(0, 0, 30, 6.67, "#00732F") + rect(0, 6.67, 30, 6.66, "#fff") + rect(0, 13.33, 30, 6.67, "#000")
      + rect(0, 0, 7.5, 20, "#FF0000"),
    sou: rect(0, 0, 30, 10, "#E03C31") + rect(0, 10, 30, 10, "#001489")
      + `<path d="M0,0L11,10L0,20M11,10H30" fill="none" stroke="#fff" stroke-width="6.67"/>`
      + `<path d="M0,0L11,10L0,20M11,10H30" fill="none" stroke="#007749" stroke-width="4"/>`
      + `<polygon points="0,2.7 8.02,10 0,17.3" fill="#FFB612"/>`
      + `<polygon points="0,4.5 6.05,10 0,15.5" fill="#000"/>`,
  };

  function flag(code) {
    const art = ART[code];
    if (!art) return "";
    return `<svg class="o-flag" viewBox="0 0 30 20" aria-hidden="true" focusable="false">${art}`
      + `<rect x=".25" y=".25" width="29.5" height="19.5" rx="1.5" fill="none" stroke="rgba(0,0,0,.2)" stroke-width=".5"/></svg>`;
  }

  function place(code) {
    const c = Data.COUNTRIES[code];
    return c ? flag(code) + Fmt.esc(c.name) : Fmt.esc(String(code || "").toUpperCase());
  }

  return { flag, place };
})();

const Fmt = (() => {
  "use strict";

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s === null || s === undefined ? "" : String(s);
    return d.innerHTML;
  }

  function clock(ms) {
    if (!ms) return "—";
    const d = new Date(ms);
    if (isNaN(d)) return "—";
    return d.toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit",
      hour12: !Settings.get("clock_24h"),
    });
  }

  function countdown(ms) {
    if (!isFinite(ms)) return "—";
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 600) return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    const m = Math.round(s / 60);
    if (m < 60) return m + "m";
    return Math.floor(m / 60) + "h " + (m % 60) + "m";
  }

  function ago(ms) {
    const s = Math.round(ms / 1000);
    if (!isFinite(s)) return "";
    if (s < 10) return "just now";
    if (s < 90) return s + "s ago";
    const m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    return Math.floor(m / 60) + "h " + (m % 60) + "m ago";
  }

  function duration(ms) {
    if (!isFinite(ms)) return "—";
    const m = Math.round(ms / 60_000);
    if (m < 60) return m + " min";
    const h = Math.floor(m / 60);
    return h + "h" + (m % 60 ? " " + (m % 60) + "m" : "");
  }

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return "—";
    const v = Math.round(n);
    const abs = Math.abs(v);
    if (abs >= 1e9) return "$" + (v / 1e9).toFixed(2).replace(/\.?0+$/, "") + "b";
    if (abs >= 1e6) return "$" + (v / 1e6).toFixed(2).replace(/\.?0+$/, "") + "m";
    if (abs >= 1e4) return "$" + Math.round(v / 1e3) + "k";
    return "$" + v.toLocaleString();
  }

  function price(n) {
    if (n === null || n === undefined || !isFinite(n)) return "—";
    return "$" + Math.round(n).toLocaleString();
  }

  function count(n) {
    return n === null || n === undefined ? "—" : Number(n).toLocaleString();
  }

  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return "—";
    return Math.round(n * 100) + "%";
  }

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : (many || one + "s"));
  }

  function board(departAt) {
    const ms = departAt - Date.now();
    const at = `<span class="o-sub">${esc(clock(departAt))}</span>`;
    if (ms <= 60_000 && ms > -10 * 60_000) return '<span class="go">now</span>' + at;
    if (ms <= 0) return '<span class="muted">gone</span>' + at;
    return `<span class="clock">${esc(clock(departAt))}</span>`
         + `<span class="o-sub" data-live="in" data-to="${departAt}">in ${esc(countdown(ms))}</span>`;
  }

  const STALE_SHELF_MS = 4 * 60_000;

  function stale(seenAt) {
    return !!seenAt && Date.now() - seenAt > STALE_SHELF_MS;
  }

  function restock(at, qty, seenAt, until) {
    if (!at) {
      return qty > 0
        ? '<span class="muted">in stock</span>'
        : '<span class="muted" title="No recorded restock yet.">not seen yet</span>';
    }
    const ms = at - Date.now();
    const range = until && until > at ? esc(clock(at)) + "–" + esc(clock(until)) : esc(clock(at));

    if (ms <= 0 && until && until > Date.now() && !stale(seenAt)) {
      return `<span class="clock">${range}</span>`
           + `<span class="o-sub${qty > 0 ? "" : " warn"}">${qty > 0 ? "in stock" : "due now"}</span>`;
    }
    if (ms <= 0) {
      if (stale(seenAt)) {
        return `<span class="muted" title="Estimated restock passed. Recent shelf data unavailable.">${esc(clock(at))}</span>`
             + '<span class="o-sub">was due</span>';
      }
      return qty > 0
        ? `<span class="muted">${esc(clock(at))}</span>`
          + '<span class="o-sub">estimate expired</span>'
        : '<span class="warn">due now</span>'
          + `<span class="o-sub">${esc(clock(at))}</span>`;
    }

    return `<span class="clock">${range}</span>`
         + `<span class="o-sub" data-live="in" data-to="${at}"`
         + `${until && until > at ? ` data-until="${until}"` : ""}`
         + `${qty > 0 ? ' data-stocked="1"' : ''}`
         + `${seenAt ? ` data-seen="${seenAt}"` : ""}>in ${esc(countdown(ms))}</span>`;
  }

  function tickLive(el) {
    const now = Date.now();
    for (const node of el.querySelectorAll('[data-live="countdown"]')) {
      const to = Number(node.dataset.to);
      if (to) node.textContent = countdown(to - now);
    }
    for (const node of el.querySelectorAll('[data-live="in"]')) {
      const to = Number(node.dataset.to);
      if (!to) continue;
      if (to > now) node.textContent = "in " + countdown(to - now);
      else if (stale(Number(node.dataset.seen))) node.textContent = "was due";
      else if (Number(node.dataset.until) > now) node.textContent = node.dataset.stocked ? "in stock" : "due now";
      else node.textContent = node.dataset.stocked ? "estimate expired" : "due now";
    }
  }

  function hitPct(h) {
    return Math.round((Number(h) || 0) * 100);
  }

  function bestLanding(reason) {
    return `<span class="clock">${esc(clock(Date.parse(reason.best_at)))}</span>`
      + `<span class="o-sub">${esc(hitPct(reason.best_hit))}% confidence · `
      + `<span class="warn">below target</span></span>`;
  }

  return { esc, clock, countdown, ago, duration, money, price, count, pct, hitPct, bestLanding,
           plural, board, restock, tickLive, STALE_SHELF_MS };
})();

const Panel = (() => {
  "use strict";

  const CARET = '<svg class="o-caret" viewBox="0 0 256 256" aria-hidden="true">'
    + '<path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,48,88H208a8,8,0,0,1,5.66,13.66Z"/></svg>';
  const ICON_REFRESH = '<svg class="o-ic" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6a5.98 5.98 0 0 1 4.24 1.76L13 11h7V4l-2.35 2.35z"/></svg>';

  const views = [];
  let root = null;
  let headLine = null;
  let headDot = null;
  let tabsEl = null;
  let bodyEl = null;
  let current = null;
  let secondTimer = null;

  const fetchedAt = {};

  function register(view) { views.push(view); }

  function build() {
    root = document.createElement("div");
    root.id = Page.PANEL_ID;
    root.innerHTML = `
      <div class="o-head" role="button" tabindex="0" aria-expanded="true">
        <span class="o-brand"><span class="o-dot"></span>Torn Oracle: Travel</span>
        <span class="o-head-line"></span>
        <span class="o-head-acts">
          <button type="button" class="o-news-pill" data-act="news" hidden></button>
          <button type="button" class="o-icon" data-act="refresh"
                  title="Refresh data">${ICON_REFRESH}</button>
        </span>
        ${CARET}
      </div>
      <div class="o-body">
        <div class="o-update" hidden>Your Torn Oracle script is out of date. <a
          href="https://greasyfork.org/en/scripts/590310-torn-oracle-travel"
          target="_blank" rel="noopener">Update it from Greasyfork</a>.</div>
        <button type="button" class="o-news" data-act="news" hidden></button>
        <div class="o-tabs" role="tablist"></div>
        <div class="o-panes"></div>
        <div class="o-foot">
          <div class="o-support">Torn Oracle: Travel is free to use. If you find it helpful,
            you can send a donation to <a href="https://www.torn.com/profiles.php?XID=3762157"
            target="_blank" rel="noopener">Ruinbringer [3762157]</a>.</div>
        </div>
      </div>`;

    headLine = root.querySelector(".o-head-line");
    headDot = root.querySelector(".o-dot");
    tabsEl = root.querySelector(".o-tabs");
    bodyEl = root.querySelector(".o-panes");

    const head = root.querySelector(".o-head");
    head.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-act]")) return;
      toggle();
    });
    head.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
    });
    root.querySelector('[data-act="refresh"]').addEventListener("click", (ev) => {
      ev.stopPropagation();
      Tracker.poke();

      fetchData(true);
      renderCurrent();
    });

    for (const btn of root.querySelectorAll('[data-act="news"]')) {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (root.classList.contains("o-collapsed")) toggle();
        show("news");
      });
    }

    for (const view of views) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "o-tab";
      tab.dataset.view = view.id;
      tab.setAttribute("role", "tab");
      tab.innerHTML = `<span class="o-tab-label">${Fmt.esc(view.label)}</span>`
                    + `<span class="o-pip" hidden></span>`;
      tab.addEventListener("click", () => show(view.id));
      tabsEl.appendChild(tab);

      const pane = document.createElement("div");
      pane.className = "o-pane";
      pane.dataset.view = view.id;
      pane.innerHTML = '<div class="o-flash-slot"></div><div class="o-view"></div>';
      bodyEl.appendChild(pane);
    }

    if (Oracle.updateDue()) showUpdate();
    paintNews();
    applyCollapsed(Settings.get("collapsed"));
    applyTheme();
    show(Settings.get("tab") || views[0].id);
    return root;
  }

  function paintNews() {
    if (!root) return;
    const unread = News.unread();
    const pill = root.querySelector(".o-news-pill");
    const banner = root.querySelector(".o-news");
    pill.hidden = banner.hidden = unread.length === 0;
    if (!unread.length) return;
    pill.textContent = unread.length + " new";
    banner.textContent = "New: " + unread[0].title
      + (unread.length > 1 ? " (+" + (unread.length - 1) + " more)" : "");
  }

  function showUpdate() {
    if (root) root.querySelector(".o-update").hidden = false;
  }

  function applyTheme() {
    if (!root) return;
    root.classList.toggle("o-dark", Page.darkMode());
    root.classList.toggle("o-compact", Settings.get("compact") === true);
    root.classList.toggle("o-minimal", Settings.get("minimal") === true);
  }

  const FLASH_MS = 4000;
  const flashes = {};

  function flash(text, tone, viewId) {
    const id = viewId || (current && current.id);
    if (!id) return;
    if (!text) delete flashes[id];
    else flashes[id] = { text, tone: tone || "", until: tone ? 0 : Date.now() + FLASH_MS };
    paintFlash(id);
  }

  function paintFlash(id) {
    const pane = bodyEl && bodyEl.querySelector('.o-pane[data-view="' + id + '"]');
    const slot = pane && pane.querySelector(".o-flash-slot");
    if (!slot) return;
    const f = flashes[id];
    slot.innerHTML = f ? `<div class="o-flash${f.tone ? " is-" + f.tone : ""}" role="status">
        <span>${Fmt.esc(f.text)}</span>
        <button type="button" class="o-icon" data-flash-close aria-label="Dismiss">&times;</button>
      </div>` : "";
    const close = slot.querySelector("[data-flash-close]");
    if (close) close.addEventListener("click", () => flash(null, null, id));
  }

  function expireFlashes() {
    const now = Date.now();
    for (const [id, f] of Object.entries(flashes)) {
      if (f.until && f.until <= now) flash(null, null, id);
    }
  }

  function applyCollapsed(on) {
    if (!root) return;
    root.classList.toggle("o-collapsed", !!on);
    root.querySelector(".o-head").setAttribute("aria-expanded", String(!on));
  }

  function toggle() {
    const next = !root.classList.contains("o-collapsed");
    applyCollapsed(next);
    Settings.set("collapsed", next);
    if (!next) { renderCurrent(); fetchData(false); }
  }

  function show(id) {
    const view = views.find((v) => v.id === id) || views[0];
    current = view;
    Settings.set("tab", view.id);
    for (const tab of tabsEl.querySelectorAll(".o-tab")) {
      tab.classList.toggle("is-on", tab.dataset.view === view.id);
      tab.setAttribute("aria-selected", String(tab.dataset.view === view.id));
    }
    for (const pane of bodyEl.querySelectorAll(".o-pane")) {
      pane.classList.toggle("is-on", pane.dataset.view === view.id);
    }
    renderCurrent();

    fetchData(false);
  }

  function paneFor(id) {
    return bodyEl ? bodyEl.querySelector('.o-pane[data-view="' + id + '"] > .o-view') : null;
  }

  const TEXTY = new Set(["text", "number", "password", "search", "tel", "url", "email"]);

  function typingIn(pane) {
    const el = document.activeElement;
    if (!el || !pane.contains(el)) return false;
    if (el.isContentEditable === true) return true;
    if (el.tagName === "TEXTAREA") return true;
    return el.tagName === "INPUT" && TEXTY.has((el.type || "text").toLowerCase());
  }

  let pendingRender = false;

  function renderCurrent(force) {
    if (!current || !root || root.classList.contains("o-collapsed")) return;
    const pane = paneFor(current.id);
    if (!pane) return;
    if (!force && typingIn(pane)) { pendingRender = true; return; }
    pendingRender = false;
    try { current.render(pane); }
    catch (e) { Env.log.error("render " + current.id + " failed", e); }
  }

  function refresh(id, force) {
    if (!current) return;
    if (id === undefined || id === current.id) renderCurrent(force);
    badges();
  }

  function badges() {
    if (!tabsEl) return;
    for (const view of views) {
      const tab = tabsEl.querySelector('.o-tab[data-view="' + view.id + '"]');
      if (!tab) continue;
      const pip = tab.querySelector(".o-pip");
      const value = view.badge ? view.badge() : null;
      if (value === null || value === undefined || value === 0 || value === "") {
        pip.hidden = true;
      } else {
        pip.hidden = false;
        pip.textContent = String(value);
      }
    }
  }

  function headline() {
    const now = Date.now();
    const s = Trip.get();

    if (!Torn.haveKey()) return { dot: "warn", text: "Add your Torn API key to start." };
    if (!Oracle.haveToken()) {
      return { dot: "warn", text: "Activate Torn Oracle account to view shops." };
    }

    const health = Torn.health();
    if (health.state === "invalid") return { dot: "bad", text: "Torn API key invalid. Update in Settings." };
    if (health.state === "capped") return { dot: "bad", text: "Torn daily API limit reached. Tracking resumes tomorrow." };
    if (health.state === "paused") return { dot: "bad", text: "Torn API key paused." };

    const pos = Trip.position(now);
    if (!pos.known) {
      if (pos.why === "stale") {
        return { dot: "warn",
                 text: "Tracking stale. Last read " + Fmt.ago(pos.for) + "." };
      }
      return { dot: "warn", text: "Reading position from Torn…" };
    }

    const where = describeWhere(pos, s);
    if (!s.active) return { dot: "live", text: where + " · no plan running" };

    const i = Trip.currentIndex();
    if (i < 0) return { dot: "live", text: where + " · plan complete" };

    const leg = s.legs[i];
    const rt = s.runtime[i];

    if (rt.status === "pending") {
      const late = Trip.lateness(now);
      if (late) {
        return { dot: "warn",
                 text: where + " · " + Fmt.duration(late.by) + " past departure" };
      }
      const due = leg.depart - now;
      if (due <= 60_000) {
        return { dot: "live", text: "Board now for " + Data.name(leg.country) };
      }
      return { dot: "live",
               text: where + " · board for " + Data.name(leg.country) + " in " + Fmt.countdown(due) };
    }
    if (rt.status === "enroute") {
      const eta = rt.arrivalAt;

      return { dot: "live",
               text: "Flying to " + Data.name(Trip.legCountry(i))
                     + (eta ? " · lands in " + Fmt.countdown(eta - now) : "") };
    }
    if (rt.status === "abroad") {
      if (rt.ambiguous) return { dot: "warn", text: "Confirm purchase details." };
      if (Trip.unitsBought(rt)) return { dot: "live", text: "Purchase recorded. Fly home." };

      if (rt.flewTo) return { dot: "warn", text: "In " + Data.name(rt.flewTo) + " · off plan" };
      return { dot: "live", text: "Buy " + leg.units + "x " + leg.item_name };
    }
    if (rt.status === "returning") {
      const eta = rt.arrivalAt;
      return { dot: "live", text: "Flying home" + (eta ? " · " + Fmt.countdown(eta - now) : "") };
    }
    return { dot: "live", text: where };
  }

  function describeWhere(pos, s) {
    if (pos.phase === "home") return "In Torn";
    if (pos.phase === "abroad") return "In " + (s.country ? Data.name(s.country) : "a foreign shop");
    if (pos.phase === "outbound") return "In the air";
    if (pos.phase === "inbound") return "Flying home";
    return "Position unknown";
  }

  function paintHead() {
    if (!headLine) return;
    const h = headline();
    headLine.textContent = h.text;
    headDot.className = "o-dot is-" + h.dot;
  }

  function fetchData(force) {
    if (!current || typeof current.refresh !== "function") return;
    if (!root || root.classList.contains("o-collapsed")) return;

    if (root.isConnected === false) return;
    if (!Env.visible()) return;
    if (!force) {
      if (!current.refreshEvery) return;
      if (Date.now() - (fetchedAt[current.id] || 0) < current.refreshEvery) return;
    }
    fetchedAt[current.id] = Date.now();
    try { current.refresh(force); }
    catch (e) { Env.log.warn("refresh " + current.id + " failed", e); }
  }

  function startClock() {
    if (secondTimer) clearInterval(secondTimer);
    secondTimer = setInterval(() => {
      paintHead();
      expireFlashes();
      if (!current || !root || root.classList.contains("o-collapsed")) return;
      const pane = paneFor(current.id);

      if (pendingRender && pane && !typingIn(pane)) renderCurrent();
      if (pane && current.tick) {
        try { current.tick(pane); } catch (e) {  }
      }

      fetchData(false);
    }, 1000);
  }

  function element() { return root; }

  return {
    register, build, show, refresh, badges, paintHead, startClock,
    applyTheme, applyCollapsed, element, paneFor, fetchData, flash,
    headline, showUpdate, paintNews,
  };
})();

const Gate = (() => {
  "use strict";

  function account(what, alsoDiscord) {
    const discord = alsoDiscord
      ? "<p>These arrive on Discord. <b>/register</b> there with your Torn key sets up both.</p>"
      : "";
    return `<div class="o-empty">
      <p><b>Sign in to ${Fmt.esc(what)}.</b></p>
      <p>A free Torn Oracle account is needed. Create one in Settings with your Torn key.</p>
      ${discord}
      <button type="button" class="o-btn is-primary" data-gate="settings">Open Settings</button>
    </div>`;
  }

  function discord(what) {
    return `<div class="o-empty">
      <p><b>${Fmt.esc(what)} arrive on Discord.</b></p>
      <p>Link your account first: run <b>/register</b> on Discord with the same Torn key.</p>
    </div>`;
  }

  function wire(el) {
    const btn = el.querySelector('[data-gate="settings"]');
    if (btn) btn.addEventListener("click", () => Panel.show("settings"));
  }

  return { account, discord, wire };
})();

const ViewToday = (() => {
  "use strict";

  const HOURS = [1, 2, 3, 4, 6, 8, 10, 12, 16];

  let editing = null;
  let draft = null;

  const shops = {};

  let landing = null;

  function shopFor(code) {
    const hit = shops[code];
    return hit && hit.rows ? hit.rows : [];
  }

  function listedRows(i) {
    const shelf = Trip.shelfOptions(i);
    return shelf.length ? shelf : shopFor(Trip.legCountry(i));
  }

  function loadShop(code) {
    const held = shops[code];
    if (!code || !Oracle.haveToken() || (held && !held.failed)) return;
    shops[code] = { loading: true };
    Oracle.shop(code).then((shop) => {
      shops[code] = { rows: (shop.items || [])
        .filter((item) => item.cost > 0)
        .map((item) => ({ itemId: item.item_id, name: item.name, cost: item.cost,
                          value: item.market_value, sell: item.sell_price })) };
    }).catch((err) => {
      shops[code] = { failed: true };
      Env.log.warn("shop read for the buy editor failed", err.message);
    }).then(() => Panel.refresh("today"));
  }

  function loadLanding(code, itemId, arrivalAt) {
    const key = code + "|" + itemId + "|" + Math.floor(arrivalAt / 60_000);
    if (landing && landing.key === key) return landing;
    landing = { key, loading: true };
    Oracle.forecasts(code, { travel: Settings.get("travel_type"), landAt: arrivalAt })
      .then((batch) => {
        const at = (batch.at_landing || {})[String(itemId)];
        landing = at ? { key, hit: at.hit, shelf: at.shelf } : { key, failed: true };
      })
      .catch((err) => {
        landing = { key, failed: true };
        Env.log.warn("landing read failed", err.message);
      })
      .then(() => Panel.refresh("today"));
    return landing;
  }

  function badge() {
    const s = Trip.get();
    if (!s.active) return null;
    const open = s.runtime.filter((rt) => rt.ambiguous).length;
    return open ? "?" : null;
  }

  function render(el) {
    const s = Trip.get();
    const now = Date.now();

    if (!Torn.haveKey()) { el.innerHTML = onboarding(); wire(el); return; }
    if (!Oracle.haveToken()) {
      el.innerHTML = whereBlock(now) + onboarding();
      wire(el);
      return;
    }

    const parts = [];

    if (Trip.racing(now)) parts.push(raceBanner());
    parts.push(whereBlock(now), doBlock(now));

    const offer = Plan.offered();
    if (offer) {
      parts.push(choicesBlock(offer));
    } else if (s.active) {
      parts.push(planTable(now));
      if (editing !== null && editing !== Trip.currentIndex() && editing < s.legs.length) {
        parts.push(editor(editing));
      }
    }
    parts.push(notes());
    parts.push(controls());

    el.innerHTML = parts.join("");
    wire(el);
  }

  function whereBlock(now) {
    const s = Trip.get();
    const pos = Trip.position(now);

    if (!pos.known) {
      const why = pos.why === "stale"
        ? "Last read " + Fmt.ago(pos.for) + "."
        : "Reading your position.";
      return `<div class="o-where is-stale"><b>Position unknown</b><span>${Fmt.esc(why)}</span></div>`;
    }

    let where;
    if (pos.phase === "home") where = "In <b>Torn</b>";
    else if (pos.phase === "abroad") where = "In <b>"
      + Fmt.esc(s.country ? Data.name(s.country) : "a foreign country") + "</b>";
    else if (pos.phase === "outbound") where = "<b>In the air</b>";
    else where = "<b>Flying home</b>";

    return `<div class="o-where">
      <span>${where}</span>
      <span class="o-age" data-live="age">${Fmt.esc(Fmt.ago(Trip.staleFor(now)))}</span>
    </div>`;
  }

  function doBlock(now) {
    const s = Trip.get();
    const i = Trip.currentIndex();

    if (!s.active || i < 0) {
      if (s.active && i < 0) {
        const v = Trip.value();

        const owed = v.unresolved
          ? " " + Fmt.plural(v.unresolved, "run") + " still to record."
          : "";
        return card("", "", "Plan complete", Fmt.plural(v.flown, "run") + " for "
                    + Fmt.money(v.realised) + "." + owed, "", null);
      }
      return "";
    }

    const leg = s.legs[i];
    const rt = s.runtime[i];

    const what = Fmt.esc(leg.units) + " x " + Fmt.esc(leg.item_name);
    const code = Trip.legCountry(i);
    const where = Flags.place(code);

    const offPlan = rt.flewTo !== null && rt.flewTo !== undefined;

    if (rt.ambiguous) {
      return card("?", "check", "What did you buy?", askText(i), "warn", buyActions(i));
    }

    if (rt.status === "pending") {

      if (Plan.offered()) return "";
      const late = Trip.lateness(now);
      if (late) {
        return card(Fmt.duration(late.by), "late", "Still to board",
          "Planned for " + Fmt.clock(leg.depart) + ". Re-plan to use current stock.",
          late.hard ? "bad" : "warn",
          `<div class="o-acts">
             <button type="button" class="o-btn is-primary" data-act="plan">Re-plan from now</button>
           </div>`);
      }
      const due = leg.depart - now;
      const take = "Take " + Fmt.money(leg.units * (leg.unit_cost || 0)) + ".";
      const pick = preselectButton(leg.country);
      if (due <= 60_000) {
        return card("Go", "board now", "Fly to " + where,
          "Buy " + what + ". " + take + (leg.dose ? " Take your drug first." : ""),
          "go", pick);
      }
      return card(Fmt.countdown(due), "until you board", "Fly to " + where,
        "Buy " + what + ". " + take + (leg.dose ? " Waits for your drug cooldown." : ""),
        "", pick, { live: "countdown", to: leg.depart });
    }

    if (rt.status === "enroute") {

      const flight = (Data.flightMinutes(code, Settings.get("travel_type")) || 0) * 60_000;
      const land = rt.arrivalAt || (rt.departedAt + flight);
      const from = rt.departedAt || (land - flight);
      const progress = Math.min(1, Math.max(0, (now - from) / Math.max(1, land - from)));
      const sub = offPlan
        ? "Off plan. Torn Oracle re-plans when you are home."
        : "Then buy " + what + "." + landingText(code, leg.item_id, rt.arrivalAt);
      return card(Fmt.countdown(land - now), "until you land", "Landing in " + where,
        sub, "", null, { live: "countdown", to: land, progress });
    }

    if (rt.status === "abroad") {
      if (Trip.unitsBought(rt)) {
        return card(String(Trip.unitsBought(rt)), "bought", "Fly home",
          caseText(i) + ".", "go", buyActions(i));
      }
      if (offPlan) {
        return card("Buy", "you have landed", "You are in " + where,
          "Not the planned country. Buys are still recorded.", "go", buyActions(i));
      }
      return card("Buy", "you have landed", what + " in " + where,
        Fmt.money(leg.units * (leg.unit_cost || 0)) + " at "
        + Fmt.price(leg.unit_cost) + " each.", "go", buyActions(i));
    }

    if (rt.status === "returning") {
      const flight = (Data.flightMinutes(code, Settings.get("travel_type")) || 0) * 60_000;
      const home = rt.arrivalAt || ((rt.leftAt || now) + flight);
      return card(Fmt.countdown(home - now), "until you're home", "Flying home",
        Trip.unitsBought(rt) ? caseText(i) + " in the case." : "Nothing recorded yet.",
        "", buyActions(i), { live: "countdown", to: home });
    }

    return "";
  }

  function landingText(code, itemId, arrivalAt) {
    if (!arrivalAt || arrivalAt <= Date.now() || !Oracle.haveToken()) return "";
    const got = loadLanding(code, itemId, arrivalAt);
    if (got.loading || got.failed) return "";
    return " " + Fmt.hitPct(got.hit) + "% confidence at landing"
      + (got.shelf ? ", ~" + Fmt.count(got.shelf) + " on the shelf." : ".");
  }

  function preselectButton(code) {
    if (!Page.canPreselect(code)) return null;
    return `<div class="o-acts">
      <button type="button" class="o-btn" data-act="preselect" data-code="${code}">
        Select ${Fmt.esc(Data.name(code))}</button>
    </div>`;
  }

  function caseText(i) {
    const rt = Trip.get().runtime[i];
    const parts = [];
    if (rt.boughtQty) parts.push(rt.boughtQty + " x " + Fmt.esc(Trip.boughtItem(i).name));
    for (const e of Trip.extras(rt)) parts.push(e.units + " x " + Fmt.esc(e.name));
    return parts.join(", ");
  }

  function askText(i) {
    const s = Trip.get();
    const a = s.runtime[i].ambiguous || {};
    const leg = s.legs[i];
    if (a.drop === null || a.drop === undefined) return "Torn Oracle could not see your wallet.";
    if (a.itemName) {
      return "Cash fell " + Fmt.money(a.drop) + ". That is "
           + Fmt.esc(a.itemName) + ", not " + Fmt.esc(leg.item_name) + ".";
    }
    return "Cash fell " + Fmt.money(a.drop) + ". No single item on the shelf matches.";
  }

  function buyActions(i) {
    const s = Trip.get();
    const rt = s.runtime[i];
    const leg = s.legs[i];
    if (editing === i) return editor(i);

    const a = rt.ambiguous;
    const fits = a && a.units > 0 && a.units <= Trip.carryable(i);
    const guessUnits = fits ? a.units : leg.units;
    const guessName = (fits && a.itemName) || leg.item_name;
    const guessItem = fits && a.itemId ? a.itemId : leg.item_id;
    const btn = (units, label, primary) =>
      `<button type="button" class="o-btn${primary ? " is-primary" : ""}"
               data-act="confirm-buy" data-leg="${i}" data-units="${units}"
               data-item="${guessItem}">${Fmt.esc(label)}</button>`;

    const parts = [];
    if (rt.boughtQty === null && !Trip.extras(rt).length) {
      parts.push(btn(guessUnits, "Bought " + guessUnits + " x " + guessName, true));
      parts.push(btn(0, "None", false));
    }
    parts.push(`<button type="button" class="o-btn" data-act="edit-buy" data-leg="${i}">
      ${rt.boughtQty === null ? "Something else" : "Change"}</button>`);
    return `<div class="o-acts">${parts.join("")}</div>`;
  }

  function editor(i) {
    const s = Trip.get();
    const leg = s.legs[i];
    const rt = s.runtime[i];
    const country = Trip.legCountry(i);
    const shelf = Trip.shelfOptions(i);
    const lines = draft || startingLines(i);

    const listed = listedRows(i).slice().sort((a, b) => a.name.localeCompare(b.name));
    const known = [{ itemId: leg.item_id, name: leg.item_name, cost: leg.unit_cost }];
    if (rt.item) known.push({ itemId: rt.item.id, name: rt.item.name, cost: rt.item.cost });
    for (const e of Trip.extras(rt)) known.push({ itemId: e.id, name: e.name, cost: e.cost });
    const choices = [];
    const seen = new Set();
    for (const row of known.concat(listed)) {
      if (row.itemId === null || row.itemId === undefined || seen.has(row.itemId)) continue;
      seen.add(row.itemId);
      choices.push(row);
    }

    const select = (chosen, n) => `<select data-role="buy-item" data-line="${n}">${
      choices.map((c) => `<option value="${c.itemId}"${c.itemId === chosen ? " selected" : ""}>`
        + Fmt.esc(c.name) + (c.cost > 0 ? " · " + Fmt.price(c.cost) : "") + "</option>").join("")
    }</select>`;

    const rows = lines.map((line, n) => `<div class="o-buy-line">
        ${select(line.itemId, n)}
        <input type="number" data-role="buy-units" data-line="${n}" min="0"
               max="${Trip.carryable(i)}" step="1" value="${Fmt.esc(line.units)}"
               aria-label="How many">
        ${n > 0 ? `<button type="button" class="o-icon" data-act="buy-drop" data-line="${n}"
                   aria-label="Remove">&times;</button>` : "<span></span>"}
      </div>`).join("");

    const state = shops[country] || {};
    const thin = shelf.length || state.rows ? ""
      : state.failed
        ? `<div class="o-note is-warn">The shop could not be read. Only the planned item is listed.</div>`
        : `<div class="o-note">Reading the shop…</div>`;

    return `<div class="o-buy">
      <div class="o-buy-head">Bought in ${Fmt.esc(Data.name(country))}</div>
      ${rows}
      <button type="button" class="o-link" data-act="buy-add">Add another item</button>
      ${thin}
      <div class="o-acts">
        <button type="button" class="o-btn is-primary" data-act="buy-save" data-leg="${i}">Save</button>
        <button type="button" class="o-btn" data-act="buy-cancel">Cancel</button>
      </div>
    </div>`;
  }

  function startingLines(i) {
    const s = Trip.get();
    const rt = s.runtime[i];
    const leg = s.legs[i];
    const units = rt.boughtQty === null
      ? ((rt.ambiguous && rt.ambiguous.units) || leg.units) : rt.boughtQty;
    return [{ itemId: Trip.boughtItem(i).id, units }]
      .concat(Trip.extras(rt).map((e) => ({ itemId: e.id, units: e.units })));
  }

  function card(clockText, caption, main, sub, tone, actions, live) {
    const rail = live && live.progress !== undefined
      ? `<div class="o-rail"><i style="width:${Math.round(live.progress * 100)}%"></i></div>`
      : "";
    const liveAttr = live && live.to ? ` data-live="countdown" data-to="${live.to}"` : "";
    return `<div class="o-now${tone ? " is-" + tone : ""}">
      <div class="o-do">
        ${clockText ? `<span class="o-meter">
          <span class="o-clock"${liveAttr}>${Fmt.esc(clockText)}</span>
          <span class="o-cap">${Fmt.esc(caption)}</span>
        </span>` : ""}
        <span class="o-what">
          <span class="o-what-main">${main}</span>
          <span class="o-what-sub">${sub}</span>
        </span>
      </div>
      ${actions || ""}
      ${rail}
    </div>`;
  }

  function planTable(now) {
    const s = Trip.get();
    const rows = s.legs.map((leg, i) => {
      const rt = s.runtime[i];
      const spend = leg.units * (leg.unit_cost || 0);
      const bought = Trip.unitsBought(rt);

      let outcome;
      if (bought > 0) {
        outcome = `<span class="go money">${Fmt.esc(Fmt.money(Trip.marginBought(i)))}</span>`
                + `<span class="o-sub">${bought} bought</span>`;
      } else if (rt.status === "unconfirmed") {
        outcome = `<span class="warn">not recorded</span>`;
      } else if (rt.status === "missed") {
        outcome = `<span class="bad">no buy</span>`;
      } else {
        outcome = `<span class="money">${Fmt.esc(Fmt.money(leg.units * (leg.unit_margin || 0)))}</span>`
                + `<span class="o-sub">expected</span>`;
      }

      const what = bought > 0 ? caseText(i)
        : Fmt.esc(leg.units) + " x " + Fmt.esc(leg.item_name);
      const note = rt.flewTo ? " · not " + Fmt.esc(Data.name(leg.country))
        : bought > 0 && rt.item ? " · planned " + Fmt.esc(rt.item.swappedFrom) : "";
      const conf = (rt.status === "pending" || rt.status === "enroute") && typeof leg.hit === "number"
        ? " · " + Fmt.esc(Fmt.hitPct(leg.hit)) + "% confidence" : "";
      const editable = rt.landedAt !== null;

      const landAt = rt.landedAt || (rt.status === "enroute" && rt.arrivalAt) || leg.land;
      const homeAt = rt.homeAt || (rt.status === "returning" && rt.arrivalAt) || leg.home_again;

      return `<tr class="${rowClass(i, rt, now)}">
        <td class="clock">${Fmt.esc(Fmt.clock(rt.departedAt || leg.depart))}
          <span class="o-sub">${legState(i, rt, now)}</span></td>
        <td>${what}
          <span class="o-sub">${Flags.place(Trip.legCountry(i))}${note}${conf}</span></td>
        <td class="num o-col-mid money">${Fmt.esc(Fmt.money(spend))}
          <span class="o-sub">${Fmt.esc(Fmt.price(leg.unit_cost || 0))} each</span></td>
        <td class="num clock o-col-extra">${Fmt.esc(Fmt.clock(landAt))}
          <span class="o-sub">home ${Fmt.esc(Fmt.clock(homeAt))}</span></td>
        <td class="num">${outcome}${editable
          ? `<button type="button" class="o-link" data-act="edit-buy" data-leg="${i}">${
              rt.boughtQty === null && !bought ? "record" : "change"}</button>`
          : ""}</td>
      </tr>`;
    });

    const v = Trip.value();
    return `<div class="o-scroll"><table>
      <thead><tr>
        <th>Board</th><th>Run</th>
        <th class="num o-col-mid" title="Cash to take">Take</th>
        <th class="num o-col-extra">Land</th>
        <th class="num">Profit</th>
      </tr></thead>
      <tbody>${rows.join("")}</tbody>
      <tfoot><tr><td colspan="5">${Fmt.plural(s.legs.length, "run")} ·
        <b>${Fmt.esc(Fmt.money(v.realised))}</b> made ·
        ${Fmt.esc(Fmt.money(v.expected))} to come</td></tr></tfoot>
    </table></div>`;
  }

  function choicesBlock(offer) {
    const total = (day) => day.reduce((n, leg) => n + leg.units * (leg.unit_margin || 0), 0);
    const days = offer.days.slice().sort((a, b) => total(b) - total(a));
    const cols = days.map((day) => {
      const runs = day.map((leg) => `<li>
          <span class="clock">${Fmt.esc(Fmt.clock(leg.depart))}</span>
          <span>${Fmt.esc(leg.units)} x ${Fmt.esc(leg.item_name)}
            <span class="o-sub">${Flags.place(leg.country)}${typeof leg.hit === "number"
              ? " · " + Fmt.esc(Fmt.hitPct(leg.hit)) + "% confidence" : ""}</span></span>
        </li>`).join("");
      return `<div class="o-choice">
        <div class="o-choice-head">
          <b class="money">${Fmt.esc(Fmt.money(total(day)))}</b>
          <span class="o-sub">${Fmt.esc(Fmt.plural(day.length, "run"))} · home
            ${Fmt.esc(Fmt.clock(day[day.length - 1].home_again))}</span>
        </div>
        <ol class="o-choice-runs">${runs}</ol>
        <button type="button" class="o-btn is-primary" data-act="choose"
          data-day="${offer.days.indexOf(day)}">Follow this plan</button>
      </div>`;
    }).join("");
    return `<div class="o-note">Pick a plan to follow.</div>
      <div class="o-choices">${cols}</div>`;
  }

  function rowClass(i, rt, now) {
    if (rt.status === "done") return "leg-done";
    if (rt.status === "missed") return "leg-missed";
    if (rt.status === "enroute" || rt.status === "abroad" || rt.status === "returning") {
      return "leg-live";
    }
    if (i === Trip.currentIndex() && Trip.lateness(now)) return "leg-late";
    return "";
  }

  function legState(i, rt, now) {
    switch (rt.status) {
      case "done": return "flown";
      case "missed": return "no buy";
      case "unconfirmed": return "flown";
      case "enroute": return "in the air";
      case "abroad": return "at the shop";
      case "returning": return "flying home";
      default: break;
    }
    if (i !== Trip.currentIndex()) return "";
    const late = Trip.lateness(now);
    if (late) return "late by " + Fmt.duration(late.by);
    const due = Trip.get().legs[i].depart - now;
    return due <= 60_000 ? "go now" : "in " + Fmt.countdown(due);
  }

  function notes() {
    const s = Trip.get();
    const status = Plan.status();
    if (status.running) {
      return `<div class="o-note">${Fmt.esc(status.stage || "Planning…")}</div>`;
    }
    if (!s.active) return "";

    const out = [];

    const open = s.runtime.findIndex((rt) => rt.ambiguous);
    if (open >= 0 && open !== Trip.currentIndex()) {
      out.push(`<div class="o-note is-warn">Record what you bought in
        ${Fmt.esc(Data.name(Trip.legCountry(open)))}.
        <button type="button" class="o-link" data-act="edit-buy" data-leg="${open}">Record</button></div>`);
    }

    if (s.planNote && !Trip.started()) {
      out.push(`<div class="o-note">${Fmt.esc(s.planNote)}</div>`);
    }
    const escort = Escort.explain();
    if (Settings.get("escort_on") && !escort.ok) {
      out.push(`<div class="o-note is-warn">${Fmt.esc(escort.text)}</div>`);
    }
    return out.join("");
  }

  function scopeText() {
    const codes = Settings.get("plan_countries");
    if (!codes || !codes.length) return "Every country";
    if (codes.length === 1) return Data.name(codes[0]);
    return codes.length + " countries";
  }

  function hoursPicker() {
    const now = Settings.get("end_hours");
    const list = HOURS.includes(now) ? HOURS : HOURS.concat([now]).sort((a, b) => a - b);
    return `<select class="o-hours" data-role="hours" aria-label="Hours to plan ahead"
      title="Hours to plan ahead">${list.map((h) =>
        `<option value="${h}"${h === now ? " selected" : ""}>${h}h</option>`).join("")}</select>`;
  }

  function sellPicker() {
    const now = Settings.get("sell_to");
    return `<select class="o-hours" data-role="sell" aria-label="Sell to">${
      Settings.BY_NAME.sell_to.choices().map(([v, label]) =>
        `<option value="${v}"${v === now ? " selected" : ""}>Sell to ${Fmt.esc(label.toLowerCase())}</option>`).join("")}</select>`;
  }

  function onboarding() {
    const haveKey = Torn.haveKey();
    const haveToken = Oracle.haveToken();
    const step = (done, title, body) => `<div class="o-row">
      <span class="o-acct-dot${done ? " is-go" : ""}"></span>
      <span class="o-row-text">
        <span class="o-row-label">${Fmt.esc(title)}</span>
        <span class="o-row-help">${body}</span>
      </span>
      <span class="o-state ${done ? "go" : "muted"}">${done ? "Done" : "To do"}</span>
    </div>`;

    return `<div class="o-sect"><div class="o-sect-body">
      ${step(haveKey, "Add your Torn API key",
        "A Limited key. It stays in this browser.")}
      ${step(haveToken, "Create a free Torn Oracle account",
        "Stock, restock times and forecasts come from its server.")}
    </div></div>
    <div class="o-acts">
      <button type="button" class="o-btn is-primary" data-act="settings">
        ${haveKey ? "Create my account" : "Add my key"}</button>
    </div>`;
  }

  function raceBanner() {
    return `<div class="o-banner"><b>You are in a race.</b> Finish or leave it to fly.</div>`;
  }

  function controls() {
    const s = Trip.get();
    const busy = Plan.status().running;
    return `<div class="o-acts">
      <button type="button" class="o-btn is-primary${busy ? " is-busy" : ""}" data-act="plan"
        ${busy ? "disabled" : ""}>
        ${busy ? '<span class="o-spin" aria-hidden="true"></span>Planning' : s.active ? "Re-plan" : "Plan my runs"}</button>
      ${hoursPicker()}
      ${sellPicker()}
      ${s.active ? '<button type="button" class="o-btn" data-act="stop">Stop</button>' : ""}
      <span class="o-grow"></span>
      <button type="button" class="o-btn" data-act="scope">${Fmt.esc(scopeText())}</button>
    </div>`;
  }

  function readLines(el) {
    return [...el.querySelectorAll('[data-role="buy-item"]')].map((sel) => {
      const n = sel.dataset.line;
      const units = el.querySelector('[data-role="buy-units"][data-line="' + n + '"]');
      return { itemId: Number(sel.value), units: units ? units.value : 0 };
    });
  }

  function rowFor(i, itemId) {
    const row = listedRows(i).find((r) => r.itemId === itemId);
    return row ? { id: row.itemId, name: row.name, cost: row.cost, value: row.value, sell: row.sell } : null;
  }

  function wire(el) {
    for (const btn of el.querySelectorAll("[data-act]")) {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        if (act === "plan") { Plan.planDay(); Panel.refresh("today"); }
        else if (act === "choose") { Plan.choose(Number(btn.dataset.day)); Panel.refresh("today"); }
        else if (act === "stop") { Plan.stop(); Panel.refresh("today"); }
        else if (act === "settings") Panel.show("settings");
        else if (act === "scope") ViewSettings.reveal("plan_countries");
        else if (act === "preselect") {
          if (!Page.preselect(btn.dataset.code)) {
            Panel.flash("Torn's destination list is not on this page.", "warn", "today");
          }
        } else if (act === "confirm-buy") {
          Trip.setBuy(Number(btn.dataset.leg), {
            units: Number(btn.dataset.units),
            itemId: btn.dataset.item === undefined ? null : Number(btn.dataset.item),
          });
          closeEditor();
          Panel.refresh("today");
        } else if (act === "edit-buy") {
          editing = Number(btn.dataset.leg);
          draft = null;
          if (!Trip.shelfOptions(editing).length) loadShop(Trip.legCountry(editing));
          Panel.refresh("today");
        } else if (act === "buy-add") {
          const scope = btn.closest(".o-buy");
          draft = readLines(scope).concat([{ itemId: null, units: 0 }]);
          Panel.refresh("today", true);
        } else if (act === "buy-drop") {
          const scope = btn.closest(".o-buy");
          draft = readLines(scope).filter((_, n) => String(n) !== btn.dataset.line);
          Panel.refresh("today", true);
        } else if (act === "buy-cancel") {
          closeEditor();
          Panel.refresh("today");
        } else if (act === "buy-save") {
          const i = Number(btn.dataset.leg);
          const [first, ...rest] = readLines(btn.closest(".o-buy") || el);
          Trip.setBuy(i, {
            units: first ? Number(first.units) : 0,
            itemId: first ? first.itemId : null,
            item: first ? rowFor(i, first.itemId) : null,
            extra: rest.map((line) => ({ itemId: line.itemId, units: Number(line.units),
                                         item: rowFor(i, line.itemId) })),
          });
          closeEditor();
          Panel.refresh("today");
        }
      });
    }

    const scope = el.querySelector(".o-buy");
    if (scope) {
      const keep = () => { draft = readLines(scope); };
      scope.querySelectorAll('[data-role="buy-item"]').forEach((n) => n.addEventListener("change", keep));
      scope.querySelectorAll('[data-role="buy-units"]').forEach((n) => n.addEventListener("input", keep));
    }

    const hours = el.querySelector('[data-role="hours"]');
    if (hours) {
      hours.addEventListener("change", () => {
        Settings.set("end_hours", Number(hours.value));
        if (Trip.get().active) Panel.flash("Re-plan to use " + hours.value + " hours.", "", "today");
      });
    }
    const sell = el.querySelector('[data-role="sell"]');
    if (sell) {
      sell.addEventListener("change", () => {
        Settings.set("sell_to", sell.value);
        if (Trip.get().active) {
          Panel.flash("Re-plan to " + sell.selectedOptions[0].text.toLowerCase() + ".", "", "today");
        }
      });
    }
  }

  function closeEditor() {
    editing = null;
    draft = null;
  }

  function tick(el) {
    const now = Date.now();
    for (const node of el.querySelectorAll('[data-live="countdown"]')) {
      const to = Number(node.dataset.to);
      if (to) node.textContent = Fmt.countdown(to - now);
    }
    const age = el.querySelector('[data-live="age"]');
    if (age) age.textContent = Fmt.ago(Trip.staleFor(now));
  }

  return { id: "today", label: "Plan", render, tick, badge };
})();

const ViewShops = (() => {
  "use strict";

  const ROW_CAP = 14;

  let country = null;

  let flight = null;
  let data = null;
  let loading = false;
  let error = null;
  let forecastError = null;
  let expanded = false;
  let sortKey = "margin";

  let pendingReload = false;

  function follow(code) {
    if (!Data.COUNTRIES[code] || code === currentCountry()) return;
    country = code;
    data = null;
    load(true);
  }

  function landingFor(code) {
    const t = Trip.get();
    const pos = Trip.position();
    if (!pos.known || pos.phase !== "outbound" || t.country !== code) return null;
    const i = Trip.currentIndex();
    const at = (i >= 0 && t.runtime[i].arrivalAt) || t.arrivalAt || null;
    return at && at > Date.now() ? at : null;
  }

  function currentCountry() {
    const t = Trip.get();
    const pos = Trip.position();

    if (pos.known && pos.phase === "outbound" && Data.COUNTRIES[t.country]) {
      const key = t.country + "@" + t.since;
      if (flight !== key) { flight = key; country = t.country; }
    }
    if (country) return country;
    if (pos.phase === "abroad" && Data.COUNTRIES[t.country]) return t.country;
    if (pos.phase === "inbound" && Data.COUNTRIES[t.from]) return t.from;

    if (Settings.get("follow_page")) {
      const dest = Page.selectedDestination();
      if (dest && Data.COUNTRIES[dest]) return dest;
    }
    const codes = Settings.planCountries();
    return codes[0] || "mex";
  }

  async function load(force) {
    if (!Oracle.haveToken()) return;
    const code = currentCountry();
    if (loading) { pendingReload = true; return; }
    const landAt = landingFor(code);
    const aim = Settings.aimAtRestock();
    if (!force && data && data.code === code && data.landAt === landAt && data.aim === aim
        && Date.now() - data.at < 45_000) return;
    loading = true;
    error = null;
    Panel.refresh("shops");
    try {
      const shop = await Oracle.shop(code);
      let forecasts = {};
      let reasons = {};
      let restocks = {};
      let horizonHours = null;
      let atLanding = {};
      forecastError = null;
      try {
        const batch = await Oracle.forecasts(code, { travel: Settings.get("travel_type"), landAt });
        forecasts = batch.forecasts || {};
        reasons = batch.reasons || {};
        restocks = batch.restocks || {};
        horizonHours = batch.horizon_hours;
        atLanding = batch.at_landing || {};
      } catch (err) {

        forecastError = err.message;
        Env.log.warn("forecasts failed", err.code || "");
      }
      data = { code, shop, forecasts, reasons, restocks, horizonHours, atLanding, landAt, aim,
               at: Date.now() };
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
      if (pendingReload) { pendingReload = false; load(true); }
      Panel.refresh("shops");
    }
  }

  function margin(item) {
    return Data.margin(item.market_value, item.sell_price, item.cost, null, item.name);
  }

  function render(el) {
    if (!Oracle.haveToken()) {
      el.innerHTML = Gate.account("see the foreign shops");
      Gate.wire(el);
      return;
    }
    ensureChrome(el);
    const code = currentCountry();
    syncControls(el, code);
    renderBody(el.querySelector(".o-shop-body"), code);
  }

  function ensureChrome(el) {
    if (el.querySelector(".o-shop-head")) return;
    const picker = Data.list().map((c) =>
      `<option value="${c.code}">${Fmt.esc(c.name)}</option>`
    ).join("");
    el.innerHTML = `<div class="o-acts o-shop-head" style="margin-top:0">
      <select data-act="country">${picker}</select>
      <select data-act="sort">
        <option value="margin">Best margin</option>
        <option value="restock">Soonest restock</option>
        <option value="stock">In stock now</option>
        <option value="name">Name</option>
        <option value="category">Category</option>
      </select>
      <button type="button" class="o-btn" data-act="fly" hidden>Fly</button>
    </div>
    <div class="o-shop-body"></div>`;
    wireChrome(el);
  }

  function syncControls(el, code) {
    const pick = el.querySelector('[data-act="country"]');
    if (pick && document.activeElement !== pick && pick.value !== code) pick.value = code;
    const sort = el.querySelector('[data-act="sort"]');
    if (sort && document.activeElement !== sort && sort.value !== sortKey) sort.value = sortKey;
    const fly = el.querySelector('[data-act="fly"]');
    if (fly) fly.hidden = !Page.canPreselect(code);
  }

  function renderBody(body, code) {
    if (!body) return;
    if (loading && (!data || data.code !== code)) {
      body.innerHTML = `<div class="o-empty">Reading the shelf…</div>`;
      return;
    }
    if (error) { body.innerHTML = `<div class="o-note is-warn">${Fmt.esc(error)}</div>`; return; }
    if (!data || data.code !== code) {
      body.innerHTML = `<div class="o-empty">Nothing loaded yet.</div>`;
      load();
      return;
    }
    body.innerHTML = forecastNote() + table() + footer();
    wireBody(body);
  }

  function forecastNote() {
    if (!forecastError) return "";
    return `<div class="o-note is-warn">${Fmt.esc(forecastError)}</div>`;
  }

  function table() {
    const items = data.shop.items.slice();
    const scored = items.map((i) => {
      const f = data.forecasts[String(i.item_id)] || null;
      return { item: i, f, margin: margin(i), restock: restockAt(i) };
    });

    const byName = (a, b) => (a.item.name || "").localeCompare(b.item.name || "");

    const soonest = (x, y) => {
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return x - y;
    };
    const largest = (x, y) => {
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    };

    const typeRank = (row) => {
      const i = Data.ITEM_TYPES.indexOf(row.item.type);
      return i === -1 ? Data.ITEM_TYPES.length : i;
    };
    const grouped = sortKey === "category";

    scored.sort((a, b) => {
      if (sortKey === "name") return byName(a, b);
      if (grouped) {
        return (typeRank(a) - typeRank(b)) || largest(a.margin, b.margin) || byName(a, b);
      }
      if (sortKey === "stock") {
        return ((b.item.quantity || 0) - (a.item.quantity || 0)) || byName(a, b);
      }
      if (sortKey === "restock") return soonest(a.restock, b.restock) || byName(a, b);
      return largest(a.margin, b.margin) || byName(a, b);
    });

    const shown = expanded || grouped ? scored : scored.slice(0, ROW_CAP);
    const seen = seenAt();
    const columns = data.landAt ? 7 : 8;
    let lastType;

    const rows = shown.map(({ item, f, margin: m, restock }) => {
      const head = grouped && item.type !== lastType
        ? `<tr class="o-cat"><td colspan="${columns}">${Fmt.esc(item.type || "No category")}</td></tr>`
        : "";
      lastType = item.type;
      const qty = item.quantity || 0;
      const cap = Settings.get("capacity");
      const ppm = Data.profitPerMinute(m, data.code, Settings.get("travel_type"), cap);

      const land = f
        ? `<span class="clock">${Fmt.esc(Fmt.clock(Date.parse(f.land_at)))}</span>`
          + `<span class="o-sub">${f.shelf === null ? "" :
               Fmt.esc(Fmt.count(f.shelf)) + " on shelf · "}`
          + `${Fmt.esc(Fmt.hitPct(f.hit))}% confidence</span>`
        : noForecast(item.item_id);
      const reason = data.reasons[String(item.item_id)];
      const flightMin = Data.flightMinutes(data.code, Settings.get("travel_type"));
      const fallbackDepart = (flightMin !== null && reason && reason.best_at)
        ? Date.parse(reason.best_at) - (flightMin * 60_000)
        : null;
      const departAt = f && f.depart_at ? Date.parse(f.depart_at) : fallbackDepart;
      const boardTitle = departAt && cap && item.cost ? ` title="Take ${Fmt.esc(Fmt.money(cap * item.cost))}"` : "";
      const mine = data.landAt ? (data.atLanding[String(item.item_id)] || null) : null;

      const yours = mine
        ? `${Fmt.esc(Fmt.hitPct(mine.hit))}%`
          + (mine.shelf ? `<span class="o-sub">${Fmt.esc(Fmt.count(mine.shelf))} on shelf</span>` : "")
        : '<span class="muted">—</span>';
      const board = departAt ? Fmt.board(departAt) : '<span class="muted">—</span>';
      return `${head}<tr>
        <td>${Fmt.esc(item.name)}
          <span class="o-sub">${Fmt.esc(item.type || "—")}</span></td>
        <td class="num">${qty > 0 ? `<span class="go">${Fmt.esc(Fmt.count(qty))}</span>`
                                  : '<span class="muted">0</span>'}
          <span class="o-sub">${Fmt.esc(Fmt.price(item.cost))}</span></td>
        ${data.landAt ? `<td class="num">${yours}</td>` : ""}
        <td class="num o-col-extra">${Fmt.restock(restock, qty, seen, restockUntil(item))}</td>
        <td class="num o-col-mid">${m === null ? '<span class="muted">—</span>'
            : `<span class="${m > 0 ? "go" : "muted"} money">${Fmt.esc(Fmt.price(m))}</span>
               <span class="o-sub">${cap ? Fmt.esc(Fmt.money(m * cap) + " total") : "each"}</span>`}</td>
        <td>${Fmt.esc(Data.channel(item.market_value, item.sell_price, item.name) || "—")}</td>
        <td class="num o-col-extra">${ppm === null ? '<span class="muted">—</span>'
            : `<span class="${ppm > 0 ? "go" : "muted"} money">${Fmt.esc(Fmt.price(ppm))}</span>`}</td>
        ${data.landAt ? ""
          : `<td class="num"${boardTitle}>${board}</td><td class="num">${land}</td>`}
      </tr>`;
    });

    const more = !grouped && scored.length > ROW_CAP
      ? `<div class="o-acts"><button type="button" class="o-btn" data-act="expand">
           ${expanded ? "Show fewer" : "Show all " + scored.length}
         </button></div>`
      : "";

    return `<div class="o-scroll"><table>
      <thead><tr>
        <th>Item</th>
        <th class="num">Stock</th>
        ${data.landAt ? `<th class="num" title="Confidence and shelf when your flight lands">
          Land ${Fmt.esc(Fmt.clock(data.landAt))}</th>` : ""}
        <th class="num o-col-extra" title="When the shelf is expected to restock">Restock</th>
        <th class="num o-col-mid" title="Profit per item">Margin</th>
        <th title="Best place to sell">Sell</th>
        <th class="num o-col-extra" title="Profit per minute of flight time">Profit/min</th>
        ${data.landAt ? ""
          : `<th class="num" title="When to leave Torn">Board</th>
             <th class="num" title="When to land abroad">Land</th>`}
      </tr></thead>
      <tbody>${rows.join("")}</tbody></table></div>${more}`;
  }

  function restockAt(item) {
    const band = data.restocks[String(item.item_id)];
    const src = (band && (band.from || band.p50)) || item.restock_at;
    const at = src ? Date.parse(src) : null;
    return at && !isNaN(at) ? at : null;
  }

  function restockUntil(item) {
    const band = data.restocks[String(item.item_id)];
    const at = band && band.to ? Date.parse(band.to) : null;
    return at && !isNaN(at) ? at : null;
  }

  function noForecast(itemId) {
    const reason = data.reasons[String(itemId)];
    if (!reason) return '<span class="muted">—</span>';
    if (reason.reason === "no_restock_estimate") {
      return '<span class="muted" title="No recorded restock yet.">no restock seen</span>';
    }
    if (reason.reason === "no_depletion") {
      return '<span class="muted" title="No recorded depletion yet.">no depletion seen</span>';
    }
    if (reason.best_at) return Fmt.bestLanding(reason);
    return `<span class="muted" title="No landing in the next ${Fmt.esc(data.horizonHours || 24)} hours finds stock.">—</span>`;
  }

  function seenAt() {
    const at = data.shop.observed_at ? Date.parse(data.shop.observed_at) : NaN;
    return isNaN(at) ? null : at;
  }

  function footer() {
    const seen = seenAt();
    const src = data.shop.source ? " · via " + data.shop.source : "";
    if (seen === null) {
      return `<div class="o-note is-warn">No stock data has been reported for this shop yet.</div>`;
    }
    const age = Date.now() - seen;
    const stale = age > Fmt.STALE_SHELF_MS;
    return `<div class="o-note${stale ? " is-warn" : ""}">Shelf checked
      <b>${Fmt.esc(Fmt.ago(age))}</b>${Fmt.esc(src)}.
      ${stale ? "Some stock may be gone." : ""}</div>`;
  }

  function wireChrome(el) {
    const pick = el.querySelector('[data-act="country"]');
    if (pick) pick.addEventListener("change", () => { country = pick.value; data = null; load(true); });
    const sort = el.querySelector('[data-act="sort"]');
    if (sort) sort.addEventListener("change", () => { sortKey = sort.value; Panel.refresh("shops"); });
    const fly = el.querySelector('[data-act="fly"]');
    if (fly) {
      fly.addEventListener("click", () => {
        if (!Page.preselect(currentCountry())) {
          Panel.flash("Torn's destination list is not on this page.", "warn", "shops");
        }
      });
    }
  }

  function wireBody(body) {
    const expand = body.querySelector('[data-act="expand"]');
    if (expand) expand.addEventListener("click", () => { expanded = !expanded; Panel.refresh("shops"); });
  }

  return {
    id: "shops", label: "Shops", render, tick: Fmt.tickLive, load, follow,
    badge: () => null,
    refresh: (force) => load(force), refreshEvery: 60_000,
  };
})();

const ViewMuseum = (() => {
  "use strict";

  const STORE = "museum_ref";
  const REFERENCE_MS = 24 * 3600_000;
  const COUNTS_MS = 15 * 60_000;
  const IDS_PER_CALL = 50;
  const PAGE = 250;

  const INVENTORY_CATS = new Set(["Collectible", "Clothing", "Other", "Tool", "Melee",
    "Defensive", "Material", "Car", "Primary", "Secondary", "Book", "Special",
    "Supply Pack", "Temporary", "Enhancer", "Artifact", "Flower", "Booster", "Medical",
    "Candy", "Jewelry", "Alcohol", "Plushie", "Drug", "Energy Drink"]);

  const OPEN_STORE = "museum_open";
  const openSets = new Set([].concat(Env.read(OPEN_STORE, []) || []));

  let counts = null;
  let loading = false;
  let error = null;

  const catOf = (item) => INVENTORY_CATS.has(item.type) ? item.type
    : INVENTORY_CATS.has(item.sub_type) ? item.sub_type : null;

  async function reference() {
    const kept = Env.read(STORE, null);
    if (kept && kept.sets && Date.now() - kept.at < REFERENCE_MS) return kept;

    const museum = await Torn.get("torn/museum", { ttl: 0 });
    const sets = (museum.museum || []).map((s) => ({
      name: s.name, points: s.points, items: (s.items || []).map(Number),
    }));
    if (!sets.length) throw new Error("Torn sent no museum sets. Try again later.");
    const ids = [...new Set(sets.flatMap((s) => s.items))];
    const items = {};
    for (let n = 0; n < ids.length; n += IDS_PER_CALL) {
      const chunk = ids.slice(n, n + IDS_PER_CALL);
      const payload = await Torn.get("torn/" + chunk.join(",") + "/items", { ttl: 0 });
      for (const it of payload.items || []) {
        items[it.id] = {
          name: it.name,
          type: it.type,
          sub_type: it.sub_type || null,

          shops: ((it.value && it.value.shops) || [])
            .filter((s) => s.country !== "Torn" || (s.buy_price !== null && s.buy_price !== undefined))
            .map((s) => ({ country: s.country, shop: s.shop })),
        };
      }
    }
    const ref = { at: Date.now(), sets, items };
    Env.write(STORE, ref);
    return ref;
  }

  async function inventory(cat) {
    const have = {};
    let asOf = null;
    for (let offset = 0; ; offset += PAGE) {
      const payload = await Torn.get("user/inventory", { params: { cat, limit: PAGE, offset }, ttl: 0 });
      const inv = payload.inventory || {};
      const list = inv.items || [];
      if (inv.timestamp) asOf = inv.timestamp * 1000;
      for (const it of list) {
        if (it.faction_owned) continue;
        have[it.id] = (have[it.id] || 0) + (Number(it.amount) || 0);
      }
      const next = payload._metadata && payload._metadata.links && payload._metadata.links.next;
      if (list.length < PAGE || !next) break;
    }
    return { have, asOf };
  }

  async function displayCase() {
    const payload = await Torn.get("user", { params: { selections: "display" }, ttl: 0 });
    if (!payload || payload.display === undefined) throw new Error("No display case in Torn's answer.");
    const raw = payload.display || [];
    const have = {};
    for (const e of Array.isArray(raw) ? raw : Object.values(raw)) {
      const id = Number(e.ID ?? e.id);
      const n = Number(e.quantity ?? e.amount);
      if (id && n) have[id] = (have[id] || 0) + n;
    }
    return have;
  }

  async function load() {
    if (loading || !Torn.haveKey()) return;
    loading = true;
    error = null;
    Panel.refresh("museum");
    try {
      const ref = await reference();
      const sets = ref.sets.filter((set) => flown(set, ref));
      const ids = new Set(sets.flatMap((set) => set.items));
      const cats = [...new Set([...ids].map((id) => catOf(ref.items[id])).filter(Boolean))];
      const [shown, ...reads] = await Promise.allSettled([displayCase(), ...cats.map(inventory)]);
      const failed = reads.find((r) => r.status === "rejected");
      if (failed) throw failed.reason;

      const have = {};
      let asOf = null;
      for (const r of reads) {
        for (const [id, n] of Object.entries(r.value.have)) have[id] = (have[id] || 0) + n;
        if (r.value.asOf && (asOf === null || r.value.asOf < asOf)) asOf = r.value.asOf;
      }
      if (shown.status === "fulfilled") {
        for (const [id, n] of Object.entries(shown.value)) have[id] = (have[id] || 0) + n;
      } else {
        Env.log.warn("display case read failed", shown.reason && shown.reason.message);
      }
      counts = { ref, sets, have, asOf, displayRead: shown.status === "fulfilled" };
    } catch (err) {
      error = err.message || String(err);
    } finally {
      loading = false;
      Panel.refresh("museum");
    }
  }

  function flown(set, ref) {
    const shops = set.items.map((id) => (ref.items[id] && ref.items[id].shops) || []);
    return shops.every((list) => list.length) && shops.some((list) => list.some((s) => s.country !== "Torn"));
  }

  function where(item) {
    return item.shops.map((s) => {
      const code = Data.CODE_BY_NAME[String(s.country || "").toLowerCase()];
      return code
        ? `<button type="button" class="o-link" data-shops="${code}">${Flags.place(code)}</button>`
        : Fmt.esc(s.shop || s.country || "");
    }).join(", ");
  }

  function tally(set, ref, have) {
    const rows = set.items.map((id) => {
      const item = ref.items[id] || {};
      return { id, item, n: catOf(item) ? (have[id] || 0) : null };
    });
    const known = rows.every((r) => r.n !== null);
    return {
      set, rows,
      ready: known ? Math.min(...rows.map((r) => r.n)) : null,
      missing: rows.filter((r) => r.n === 0).length,
    };
  }

  function setFold(t) {
    const { set, ready, missing } = t;
    const rows = t.rows.slice().sort((a, b) => (a.n ?? -1) - (b.n ?? -1)
      || String(a.item.name || "").localeCompare(String(b.item.name || "")));

    const state = ready === null ? '<span class="muted">Count unknown</span>'
      : ready > 0 ? `<span class="go">${Fmt.esc(Fmt.plural(ready, "set"))} ready · ${
        Fmt.esc(Fmt.count(ready * set.points))} points</span>`
        : `<span class="muted">${Fmt.esc(Fmt.plural(missing, "item"))} missing</span>`;
    const body = rows.map((r) => {
      const short = r.n === null || r.n === ready;
      return `<tr${short ? "" : ' class="o-spare"'}>
        <td>${Fmt.esc(r.item.name || "Item " + r.id)}</td>
        <td>${where(r.item)}</td>
        <td class="num">${r.n === null ? '<span class="muted">?</span>'
          : short ? `<span class="warn">${Fmt.esc(Fmt.count(r.n))}</span>` : Fmt.esc(Fmt.count(r.n))}</td>
      </tr>`;
    }).join("");

    return `<details class="o-sect o-mset" data-set="${Fmt.esc(set.name)}"${
      openSets.has(set.name) ? " open" : ""}>
      <summary><span class="o-sect-text">
          <span class="o-sect-title">${Fmt.esc(set.name)}</span>
          <span class="o-sect-hint">${Fmt.esc(Fmt.count(set.points))} points per set</span></span>
        <span class="o-mset-state">${state}</span></summary>
      <div class="o-sect-body"><table class="o-set">
        <colgroup><col><col class="o-set-where"><col class="o-set-n"></colgroup>
        <tbody>${body}</tbody></table></div>
    </details>`;
  }

  function render(el) {
    if (!Torn.haveKey()) {
      el.innerHTML = `<div class="o-empty">
        <p><b>Add your Torn API key to see your museum sets.</b></p>
        <button type="button" class="o-btn is-primary" data-gate="settings">Add API key</button>
      </div>`;
      Gate.wire(el);
      return;
    }
    if (!counts) {
      el.innerHTML = error ? `<div class="o-note is-warn">${Fmt.esc(error)}</div>`
        : `<div class="o-empty">Reading your museum sets…</div>`;
      return;
    }

    const notes = [];
    if (error) notes.push(`<div class="o-note is-warn">${Fmt.esc(error)}</div>`);
    if (!counts.displayRead) {
      notes.push('<div class="o-note is-warn">Display case not read. Counts are inventory only.</div>');
    }
    if (counts.asOf) {
      notes.push(`<div class="o-note">Torn updates these counts once an hour. Last update ${
        Fmt.esc(Fmt.clock(counts.asOf))}.</div>`);
    }
    if (!counts.sets.length) {
      el.innerHTML = '<div class="o-empty">No museum set can be bought by flying.</div>' + notes.join("");
      return;
    }

    const tallies = counts.sets.map((s) => tally(s, counts.ref, counts.have))
      .sort((a, b) => (b.ready || 0) - (a.ready || 0) || a.missing - b.missing);
    const sets = tallies.reduce((n, t) => n + (t.ready || 0), 0);
    const points = tallies.reduce((n, t) => n + (t.ready || 0) * t.set.points, 0);
    const allOpen = tallies.every((t) => openSets.has(t.set.name));
    const head = `<div class="o-mhead">
      <span>${sets ? `<b class="go">${Fmt.esc(Fmt.plural(sets, "set"))} ready</b> · ${
        Fmt.esc(Fmt.count(points))} points` : '<span class="muted">No set ready yet</span>'}</span>
      <button type="button" class="o-link" data-folds="${allOpen ? "close" : "open"}">${
        allOpen ? "Collapse all" : "Expand all"}</button>
    </div>`;
    el.innerHTML = head + `<div class="o-sets">${tallies.map(setFold).join("")}</div>` + notes.join("");
    wire(el);
  }

  function remember() {
    Env.write(OPEN_STORE, [...openSets]);
  }

  function wire(el) {
    for (const fold of el.querySelectorAll("details[data-set]")) {
      fold.addEventListener("toggle", () => {
        if (fold.open) openSets.add(fold.dataset.set); else openSets.delete(fold.dataset.set);
        remember();
      });
    }
    const all = el.querySelector("[data-folds]");
    if (all) {
      all.addEventListener("click", () => {
        openSets.clear();
        if (all.dataset.folds === "open") counts.sets.forEach((set) => openSets.add(set.name));
        remember();
        Panel.refresh("museum");
      });
    }
    for (const btn of el.querySelectorAll("[data-shops]")) {
      btn.addEventListener("click", () => {
        ViewShops.follow(btn.dataset.shops);
        Panel.show("shops");
      });
    }
  }

  return {
    id: "museum", label: "Museum", render, tick: () => { }, badge: () => null,
    refresh: () => load(), refreshEvery: COUNTS_MS,
  };
})();

const ViewWatches = (() => {
  "use strict";

  let rows = null;
  let loading = false;
  let error = null;
  let adding = false;

  const form = { country: null, itemId: "", onRestock: true, onSoldout: false };

  let shelf = { code: null, items: null, error: null, loading: false };

  function resetForm() {
    form.country = Settings.planCountries()[0] || "mex";
    form.itemId = "";
    form.onRestock = true;
    form.onSoldout = false;
    shelf = { code: null, items: null, error: null, loading: false };
  }

  async function load(force) {
    if (!Oracle.haveToken()) { rows = null; return; }
    if (loading) return;
    if (!force && rows && Date.now() - (rows.at || 0) < 45_000) return;
    loading = true;
    error = null;
    try {

      await Account.load();
      let list;
      try {

        list = (await Oracle.board({ travel: Settings.get("travel_type") })).watches || [];
      } catch (err) {
        if (err.code !== "premium_required") throw err;
        list = await Oracle.watches();
      }
      rows = { list, at: Date.now() };
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
      Panel.refresh("watches");
    }
  }

  function badge() {
    return rows && rows.list.length ? rows.list.length : null;
  }

  function render(el) {
    if (!Oracle.haveToken()) {

      el.innerHTML = Gate.account("get restock alerts", true);
      Gate.wire(el);
      return;
    }

    if (loading && !rows) { el.innerHTML = `<div class="o-empty">Loading watches…</div>`; return; }
    if (!rows && !error) { el.innerHTML = `<div class="o-empty">No data loaded.</div>`; load(); return; }

    if (Account.knownWithoutDiscord()) {
      el.innerHTML = Gate.discord("Restock alerts")
        + (rows && rows.list.length ? existing() : "");
      wire(el);
      return;
    }

    if (error) { el.innerHTML = `<div class="o-note is-warn">${Fmt.esc(error)}</div>` + adder(); wire(el); return; }

    if (!rows.list.length) {
      el.innerHTML = `<div class="o-empty">Watch an item to get a Discord alert
        when it restocks.</div>` + adder();
      wire(el);
      return;
    }

    el.innerHTML = existing() + adder();
    wire(el);
  }

  function ordered(list) {
    const travel = Settings.get("travel_type");
    const rate = (w) => Data.profitPerMinute(
      Data.margin(w.market_value, w.sell_price, w.cost, null, w.name), w.country, travel, 1);
    return list.map((w) => ({ w, r: rate(w) }))
      .sort((a, b) => (a.r === null) - (b.r === null) || (b.r || 0) - (a.r || 0)
        || (a.w.name || "").localeCompare(b.w.name || ""))
      .map((x) => x.w);
  }

  function existing() {
    const body = ordered(rows.list).map((w) => {

      const band = w.restock || {};
      const due = Date.parse(band.from || band.p50 || w.predicted_restock_at) || null;
      const until = Date.parse(band.to) || null;

      const seen = w.observed_at ? Date.parse(w.observed_at) : null;
      const f = w.forecast;
      const reason = w.reason;
      const flightMin = Data.flightMinutes(w.country, Settings.get("travel_type"));
      const fallbackDepart = (flightMin !== null && reason && reason.best_at)
        ? Date.parse(reason.best_at) - flightMin * 60_000
        : null;
      const departAt = f && f.depart_at ? Date.parse(f.depart_at) : fallbackDepart;
      const cap = Settings.get("capacity");
      const ppm = Data.profitPerMinute(Data.margin(w.market_value, w.sell_price, w.cost, null, w.name),
        w.country, Settings.get("travel_type"), cap);
      const boardTitle = departAt && cap && w.cost ? ` title="Take ${Fmt.esc(Fmt.money(cap * w.cost))}"` : "";
      const board = departAt ? Fmt.board(departAt) : '<span class="muted">—</span>';
      let land;
      if (f && f.land_at) {
        land = `<span class="clock">${Fmt.esc(Fmt.clock(Date.parse(f.land_at)))}</span>`
          + `<span class="o-sub">${f.shelf === null
               ? Fmt.esc(Fmt.hitPct(f.hit)) + "% confidence"
               : Fmt.esc(Fmt.count(f.shelf)) + " on shelf · " + Fmt.esc(Fmt.hitPct(f.hit)) + "% confidence"}</span>`;
      } else if (reason && reason.best_at) {
        land = Fmt.bestLanding(reason);
      } else if (reason && reason.reason === "no_restock_estimate") {
        land = '<span class="muted" title="No recorded restock yet.">no restock seen</span>';
      } else if (reason && reason.reason === "no_depletion") {
        land = '<span class="muted" title="No recorded depletion yet.">no depletion seen</span>';
      } else {
        land = '<span class="muted">—</span>';
      }
      return `<tr>
        <td>${Fmt.esc(w.name)}
          <span class="o-sub">${Flags.place(w.country)}</span></td>
        <td class="num">${(w.quantity || 0) > 0
            ? `<span class="go">${Fmt.esc(Fmt.count(w.quantity))}</span>`
            : '<span class="muted">0</span>'}
          <span class="o-sub">${Fmt.esc(Fmt.price(w.cost))}</span></td>
        <td class="num">${Fmt.restock(due, w.quantity || 0, seen, until)}</td>
        <td class="num o-col-extra">${ppm === null ? '<span class="muted">—</span>'
            : `<span class="${ppm > 0 ? "go" : "muted"} money">${Fmt.esc(Fmt.price(ppm))}</span>`}</td>
        <td class="num"${boardTitle}>${board}</td>
        <td class="num">${land}</td>
        <td class="num"><button type="button" class="o-icon" data-act="remove"
              data-id="${w.id}" title="Stop watching">&times;</button></td>
      </tr>`;
    });

    return `<div class="o-scroll"><table>
      <thead><tr><th>Item</th><th class="num">Stock</th>
        <th class="num" title="When the shelf is expected to restock">Restock</th>
        <th class="num o-col-extra" title="Profit per minute of flight time">Profit/min</th>
        <th class="num" title="When to leave Torn">Board</th>
        <th class="num"
            title="When to land abroad">Land</th>
        <th></th></tr></thead>
      <tbody>${body.join("")}</tbody></table></div>`;
  }

  function adder() {
    if (!adding) {
      return `<div class="o-acts">
        <button type="button" class="o-btn is-primary" data-act="add">Watch an item</button>
      </div>`;
    }
    const countries = Data.list().map((c) =>
      `<option value="${c.code}"${c.code === form.country ? " selected" : ""}
        >${Fmt.esc(c.name)}</option>`).join("");
    return `<div class="o-group" style="margin-top:10px">
      <h4>New watch</h4>
      <div class="o-field">
        <span class="o-field-label">Country</span>
        <select data-field="country">${countries}</select>
      </div>
      <div class="o-field">
        <span class="o-field-label">Item</span>
        <select data-field="item">${itemOptions()}</select>
      </div>
      <div class="o-field">
        <span class="o-field-label">Tell me when</span>
        <span>
          <label><input type="checkbox" data-field="on_restock"${form.onRestock ? " checked" : ""}> it restocks</label>
          <label style="margin-left:8px"><input type="checkbox" data-field="on_soldout"${form.onSoldout ? " checked" : ""}> it sells out</label>
        </span>
      </div>
      <div class="o-acts">
        <button type="button" class="o-btn is-primary" data-act="save">Add</button>
        <button type="button" class="o-btn" data-act="cancel">Cancel</button>
      </div>
    </div>`;
  }

  function itemOptions() {
    if (shelf.loading) return `<option value="">Reading the shelf…</option>`;
    if (shelf.error) return `<option value="">Could not read the shelf</option>`;
    if (!shelf.items || !shelf.items.length) return `<option value="">Nothing on this shelf</option>`;
    return shelf.items.map((i) =>
      `<option value="${i.item_id}"${String(i.item_id) === String(form.itemId) ? " selected" : ""}
        >${Fmt.esc(i.name)}</option>`).join("");
  }

  async function loadShelf() {

    if (shelf.code === form.country) return;
    shelf = { code: form.country, items: null, error: null, loading: true };
    const want = form.country;
    Panel.refresh("watches");
    try {
      const shop = await Oracle.shop(want);
      const items = shop.items.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      if (shelf.code !== want) return;
      shelf = { code: want, items, error: null, loading: false };

      if (!form.itemId && items.length) form.itemId = items[0].item_id;
    } catch (err) {
      if (shelf.code !== want) return;
      shelf = { code: want, items: null, error: err.message, loading: false };
    }
    Panel.refresh("watches");
  }

  function wire(el) {
    for (const btn of el.querySelectorAll("[data-act]")) {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        if (act === "add") { adding = true; resetForm(); Panel.refresh("watches"); }
        else if (act === "cancel") { adding = false; Panel.refresh("watches"); }
        else if (act === "remove") {
          try { await Oracle.removeWatch(btn.dataset.id); load(true); }
          catch (err) { error = err.message; Panel.refresh("watches"); }
        } else if (act === "save") {
          if (!form.itemId) return;
          try {
            const res = await Oracle.addWatch({
              country: form.country,
              item_id: Number(form.itemId),
              travel_type: Settings.get("travel_type"),
              on_restock: form.onRestock,
              on_soldout: form.onSoldout,
            });

            if (res && res.delivery === "none") Account.forget();
            adding = false;
            load(true);
          } catch (err) {
            error = err.message;
            Panel.refresh("watches");
          }
        }
      });
    }

    const country = el.querySelector('[data-field="country"]');
    if (country) {
      country.addEventListener("change", () => {
        form.country = country.value;
        form.itemId = "";
        loadShelf();
      });
      loadShelf();
    }
    const item = el.querySelector('[data-field="item"]');
    if (item) item.addEventListener("change", () => { form.itemId = item.value; });
    for (const name of ["on_restock", "on_soldout"]) {
      const box = el.querySelector('[data-field="' + name + '"]');
      if (box) {
        box.addEventListener("change", () => {
          if (name === "on_restock") form.onRestock = box.checked;
          else form.onSoldout = box.checked;
        });
      }
    }
  }

  return {
    id: "watches", label: "Watches", render, tick: Fmt.tickLive, load, badge,
    refresh: (force) => load(force), refreshEvery: 120_000,
  };
})();

const ViewItems = (() => {
  "use strict";

  const LISTINGS = 5;

  let query = "";
  let result = null;
  let loading = false;
  let error = null;
  let catalogue = null;

  async function ensureCatalogue() {
    if (catalogue) return catalogue;
    const payload = await Torn.items();
    const items = payload.items || payload;
    catalogue = [];
    if (Array.isArray(items)) {
      for (const it of items) catalogue.push({ id: it.id, name: it.name, item: it });
    } else {
      for (const [id, it] of Object.entries(items || {})) {
        catalogue.push({ id: Number(id), name: it.name, item: it });
      }
    }
    return catalogue;
  }

  function findEntry(list, q) {
    const id = Number(q);
    if (isFinite(id) && id > 0) return list.find((e) => e.id === id) || null;
    const low = q.toLowerCase();
    const rank = (name) => {
      const n = (name || "").toLowerCase();
      if (n === low) return 0;
      if (n.startsWith(low)) return 1;
      if (n.includes(low)) return 2;
      return 3;
    };
    let best = null;
    let bestRank = 3;
    for (const entry of list) {
      const r = rank(entry.name);
      if (r === 3) continue;
      if (r < bestRank || (r === bestRank && best && entry.id < best.id)) {
        best = entry;
        bestRank = r;
      }
    }
    return best;
  }

  async function run() {
    const q = query.trim();
    if (!q) return;
    loading = true;
    error = null;
    result = null;

    Panel.refresh("items", true);
    try {
      const list = await ensureCatalogue();
      const entry = findEntry(list, q);
      if (!entry) throw new Error("Item not found.");

      const [mkt, stock] = await Promise.allSettled([
        Torn.itemMarket(entry.id, LISTINGS),
        Oracle.haveToken() ? Oracle.itemStock(entry.id) : Promise.resolve(null),
      ]);
      result = {
        entry,
        market: mkt.status === "fulfilled" ? mkt.value : null,
        stock: stock.status === "fulfilled" ? stock.value : null,
        stockError: stock.status === "rejected" ? stock.reason.message : null,
      };
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
      Panel.refresh("items", true);
    }
  }

  function stamp(iso) {
    if (!iso) return null;
    const ms = Date.parse(iso);
    return isNaN(ms) ? null : ms;
  }

  function render(el) {
    if (!Torn.haveKey()) {
      el.innerHTML = `<div class="o-empty">
        <p style="margin:0 0 8px"><b>Add your Torn API key to look up items.</b></p>
        <p style="margin:0 0 12px;font-size:11px">Item names, market values, and listings are read directly from Torn with your key.</p>
        <button type="button" class="o-btn is-primary" data-gate="settings">Add API key</button>
      </div>`;
      Gate.wire(el);
      return;
    }

    const head = `<div class="o-acts" style="margin-top:0">
      <input type="text" data-act="query" class="o-grow" placeholder="Item name or id"
             value="${Fmt.esc(query)}">
      <button type="button" class="o-btn is-primary" data-act="go">Search</button>
    </div>`;

    let body = "";
    if (loading) body = `<div class="o-empty">Searching…</div>`;
    else if (error) body = `<div class="o-note is-warn">${Fmt.esc(error)}</div>`;
    else if (result) body = itemCard(result) + shelves(result) + listings(result);
    else body = `<div class="o-empty">Search for an item to see market prices and foreign stock.</div>`;

    el.innerHTML = head + body;
    wire(el);
  }

  function itemCard(r) {
    const it = r.entry.item || {};
    return `<div class="o-group">
      <h4>${Fmt.esc(it.name || r.entry.name)}</h4>
      <div class="o-field"><span class="o-field-label">Type</span>
        <span>${Fmt.esc(it.type || "—")}</span></div>
      <div class="o-field"><span class="o-field-label">Market value</span>
        <span class="money">${Fmt.esc(Fmt.price(it.value && it.value.market_price))}</span></div>
      <div class="o-field"><span class="o-field-label">Circulation</span>
        <span>${Fmt.esc(Fmt.count(it.circulation))}</span></div>
    </div>`;
  }

  function shelves(r) {
    if (!Oracle.haveToken()) {
      return `<div class="o-group"><h4>Foreign shops</h4>
        <div class="o-note">Sign in with a free account in Settings to see foreign shops.</div></div>`;
    }
    if (r.stockError) {
      return `<div class="o-group"><h4>Foreign shops</h4>
        <div class="o-note is-warn">${Fmt.esc(r.stockError)}</div></div>`;
    }
    const list = (r.stock && r.stock.shelves) || [];
    if (!list.length) {
      return `<div class="o-group"><h4>Foreign shops</h4>
        <div class="o-note">No foreign shop carries this item.</div></div>`;
    }

    const value = (r.entry.item && r.entry.item.value) || {};
    const travel = Settings.get("travel_type");
    const capacity = Settings.get("capacity");

    const scored = list.map((s) => {
      const perItem = Data.margin(value.market_price, value.sell_price, s.cost, null, (r.entry.item || {}).name || r.entry.name);
      return { s, ppm: Data.profitPerMinute(perItem, s.country, travel, capacity) };
    });

    scored.sort((a, b) => {
      if (a.ppm === null && b.ppm === null) return (a.s.country || "").localeCompare(b.s.country || "");
      if (a.ppm === null) return 1;
      if (b.ppm === null) return -1;
      if (a.ppm !== b.ppm) return b.ppm - a.ppm;
      return (a.s.country || "").localeCompare(b.s.country || "");
    });

    const rows = scored.map(({ s, ppm }) => {
      const qty = s.quantity || 0;

      const restock = Fmt.restock(stamp(s.restock_at), qty,
                                  stamp(s.observed_at));
      const flight = Data.flightMinutes(s.country, travel);
      return `<tr>
        <td>${Flags.place(s.country)}
          <span class="o-sub">${flight ? Fmt.esc(flight + " min each way") : ""}</span></td>
        <td class="num">${qty > 0
            ? `<span class="go">${Fmt.esc(Fmt.count(qty))}</span>`
            : '<span class="muted">0</span>'}</td>
        <td class="num o-col-mid money">${Fmt.esc(Fmt.price(s.cost))}</td>
        <td class="num">${ppm === null ? '<span class="muted">—</span>'
            : `<span class="${ppm > 0 ? "go" : "muted"} money">${Fmt.esc(Fmt.price(ppm))}</span>`}</td>
        <td class="num">${restock}</td>
      </tr>`;
    });

    const seen = list.reduce((oldest, s) => {
      const at = stamp(s.observed_at);
      return at && (oldest === null || at < oldest) ? at : oldest;
    }, null);

    return `<div class="o-group"><h4>Foreign shops</h4>
      <div class="o-scroll"><table>
        <thead><tr><th>Country</th><th class="num">Stock</th>
          <th class="num o-col-mid">Price</th>
          <th class="num" title="Round trip profit per minute of flight">Profit/min</th>
          <th class="num" title="Expected restock time">Restock</th></tr></thead>
        <tbody>${rows.join("")}</tbody></table></div>
      ${seen ? `<div class="o-note">Oldest reading:
        <b>${Fmt.esc(Fmt.ago(Date.now() - seen))}</b>.</div>` : ""}
    </div>`;
  }

  function listings(r) {
    const market = ((r.market && (r.market.itemmarket || r.market)) || {}).listings || [];
    const list = Array.isArray(market) ? market.slice(0, LISTINGS) : [];
    const rows = list.length
      ? list.map((l, n) => `<div class="o-field">
          <span class="o-field-label">${n === 0 ? "Item market" : ""}</span>
          <span class="money">${Fmt.esc(Fmt.price(l.price))}
            <span class="o-sub" style="display:inline">x${Fmt.esc(l.amount || l.quantity || 1)}</span></span>
        </div>`).join("")
      : `<div class="o-field"><span class="o-field-label">Item market</span>
          <span class="muted">No listings</span></div>`;

    return `<div class="o-group"><h4>Cheapest in Torn</h4>${rows}</div>`;
  }

  function wire(el) {
    const q = el.querySelector('[data-act="query"]');
    if (q) {
      q.addEventListener("input", () => { query = q.value; });
      q.addEventListener("keydown", (ev) => { if (ev.key === "Enter") run(); });
    }
    const go = el.querySelector('[data-act="go"]');
    if (go) go.addEventListener("click", run);
  }

  function tick(el) {
    Fmt.tickLive(el);
  }

  return {
    id: "items", label: "Items", render, tick, badge: () => null,
    refresh: (force) => { if (force && query.trim()) run(); },
  };
})();

const ViewSettings = (() => {
  "use strict";

  const SECTIONS = {
    account: ["Account", "Torn key, Torn Oracle account, Discord"],
    trips: ["Trips", "Travel method, suitcase, hours, drug cooldown"],
    buying: ["What to buy", "Countries, categories, price and profit"],
    forecast: ["Forecast", "How sure a landing must be"],
    alerts: ["Alerts", "Browser and Discord"],
    display: ["Display", "Minimal view, spacing, clock"],
    share: ["Share settings", "Copy your plan settings or paste someone else's"],
  };

  let openSections = null;

  let editingKey = false;
  let editingToken = false;
  let busy = false;
  let evictOldest = false;
  let tokens = null;
  let tokensOpen = false;
  let tokenBusy = false;
  let catalogue = null;
  let catalogueBusy = false;
  let catalogueError = null;
  const openPicks = new Set();
  let shareText = "";

  const tell = (text, tone) => Panel.flash(text, tone, "settings");

  function initSections() {
    if (openSections === null) {
      openSections = new Set(Torn.haveKey() && Oracle.haveToken() ? [] : ["account"]);
    }
  }

  function render(el) {
    initSections();
    el.innerHTML = Settings.groups().map(groupBlock).join("") + shareBlock() + diagnostics();
    wire(el);
    if (openSections.has("buying") && catalogue === null && !catalogueError) loadCatalogue();
  }

  function groupBlock(group) {
    const [title, hint] = SECTIONS[group] || [group, ""];
    if (group === "account") return section(group, title, hint, accountRows());
    const rows = Settings.SCHEMA
      .filter((r) => r.group === group && !r.hidden && (!r.showIf || r.showIf()))
      .map(field)
      .join("");
    const extra = group === "alerts" ? escortLine() : "";
    return rows ? section(group, title, hint, rows + extra) : "";
  }

  function section(id, title, hint, body) {
    const open = openSections.has(id) ? " open" : "";
    return `<details class="o-sect" data-sect="${id}"${open}>
      <summary><span class="o-sect-text">
        <span class="o-sect-title">${Fmt.esc(title)}</span>
        <span class="o-sect-hint">${Fmt.esc(hint)}</span></span></summary>
      <div class="o-sect-body">${body}</div>
    </details>`;
  }

  function row(label, help, ctl, cls, name) {
    return `<div class="o-row${cls ? " " + cls : ""}"${name ? ` data-row="${name}"` : ""}>
      <span class="o-row-text">
        <span class="o-row-label">${label}</span>
        ${help ? `<span class="o-row-help">${help}</span>` : ""}
      </span>
      ${ctl ? `<span class="o-row-ctl">${ctl}</span>` : ""}
    </div>`;
  }

  function field(r) {
    const cls = r.kind === "codes" || r.kind === "types" || r.kind === "picks" ? "is-stack"
      : r.kind === "choice" ? "is-wrap" : "";
    return row(Fmt.esc(r.label), r.help ? Fmt.esc(r.help) : "", control(r), cls, r.name);
  }

  function control(r) {
    const v = Settings.get(r.name);
    switch (r.kind) {
      case "bool":
        return `<label class="o-switch"><input type="checkbox" role="switch"
          data-set="${r.name}" aria-label="${Fmt.esc(r.label)}"${v ? " checked" : ""}><i></i></label>`;
      case "int":
      case "number": {
        if (r.unit === "$") {
          return `<span class="o-unit">$<input type="text" inputmode="numeric" class="o-money"
            data-set="${r.name}" value="${Fmt.esc(Number(v).toLocaleString("en-US"))}"
            aria-label="${Fmt.esc(r.label)}"></span>`;
        }
        const input = `<input type="number" data-set="${r.name}" value="${Fmt.esc(v)}"
          aria-label="${Fmt.esc(r.label)}"
          ${r.min !== undefined ? `min="${r.min}"` : ""}
          ${r.max !== undefined ? `max="${r.max}"` : ""}
          ${r.step ? `step="${r.step}"` : ""}>`;
        const pre = r.unit === "$" ? "$" : "";
        const post = r.unit && r.unit !== "$" ? r.unit : "";
        return `<span class="o-unit">${pre}${input}${post}</span>`;
      }
      case "choice":
        return `<select data-set="${r.name}" aria-label="${Fmt.esc(r.label)}">${r.choices().map(([val, lab]) =>
          `<option value="${Fmt.esc(val)}"${val === v ? " selected" : ""}>${Fmt.esc(lab)}</option>`
        ).join("")}</select>`;
      case "codes":
        return `<span class="o-chips">${Data.list().map((c) =>
          `<button type="button" class="o-chip${v.includes(c.code) ? " is-on" : ""}"
                   data-toggle="${r.name}" data-value="${c.code}">${Flags.place(c.code)}</button>`
        ).join("")}</span>`;
      case "types":
        return `<span class="o-chips">${Data.ITEM_TYPES.map((t) =>
          `<button type="button" class="o-chip${v.includes(t) ? " is-on" : ""}"
                   data-toggle="${r.name}" data-value="${Fmt.esc(t)}">${Fmt.esc(t)}</button>`
        ).join("")}</span>`;
      case "picks":
        return picker(v);
      default:
        return `<input type="text" data-set="${r.name}" value="${Fmt.esc(v)}">`;
    }
  }

  function parseMoney(text) {
    const m = String(text).replace(/[\s,$]/g, "").match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
    if (!m) return NaN;
    const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || "").toLowerCase()] || 1;
    return Math.round(Number(m[1]) * mult);
  }

  async function loadCatalogue() {
    if (catalogueBusy || !Torn.haveKey()) return;
    catalogueBusy = true;
    catalogueError = null;
    try {
      const payload = await Torn.items();
      const list = Array.isArray(payload.items) ? payload.items : Object.values(payload.items || {});
      const out = {};
      for (const it of list) {
        const shops = (it.value && it.value.shops) || [];
        if (!it.type || !shops.some((sh) => sh.country && sh.country !== "Torn")) continue;
        (out[it.type] = out[it.type] || []).push({ id: Number(it.id), name: it.name });
      }
      for (const items of Object.values(out)) items.sort((a, b) => a.name.localeCompare(b.name));
      catalogue = out;
    } catch (err) {
      catalogueError = err.message || String(err);
    } finally {
      catalogueBusy = false;
      Panel.refresh("settings");
    }
  }

  function picker(picks) {
    if (!Torn.haveKey()) return '<span class="o-note">Add your Torn API key to pick items.</span>';
    if (catalogueError) {
      return `<span class="o-note is-warn">${Fmt.esc(catalogueError)}
        <button type="button" class="o-link" data-act="picks-retry">Try again</button></span>`;
    }
    if (!catalogue) return '<span class="o-note">Loading items…</span>';
    const chosen = Settings.get("item_types");
    const types = Object.keys(catalogue)
      .filter((t) => !chosen.length || chosen.includes(t))
      .sort();
    if (!types.length) return '<span class="o-note">No items sold abroad in these categories.</span>';
    return `<span class="o-picks">${types.map((type) => {
      const items = catalogue[type];
      const on = picks[type] || [];
      const state = on.length ? `${on.length} of ${items.length} picked` : "All items";
      return `<details class="o-pick" data-pick="${Fmt.esc(type)}"${openPicks.has(type) ? " open" : ""}>
        <summary><span>${Fmt.esc(type)}</span>
          <span class="o-pick-state${on.length ? " is-on" : ""}">${state}</span></summary>
        <span class="o-chips">${items.map((it) =>
          `<button type="button" class="o-chip${on.includes(it.id) ? " is-on" : ""}"
                   data-pick-type="${Fmt.esc(type)}" data-pick-id="${it.id}">${Fmt.esc(it.name)}</button>`
        ).join("")}</span>
        ${on.length ? `<button type="button" class="o-link" data-pick-clear="${Fmt.esc(type)}">Plan all ${
          Fmt.esc(type)} items</button>` : ""}
      </details>`;
    }).join("")}</span>`;
  }

  function setPicks(type, ids) {
    const picks = Object.assign({}, Settings.get("plan_items"));
    if (ids.length) picks[type] = ids; else delete picks[type];
    Settings.set("plan_items", picks);
    afterChange("plan_items");
  }

  function shareBlock() {
    return section("share", ...SECTIONS.share, `
      <div class="o-row is-stack">
        <span class="o-row-text">
          <span class="o-row-help">Trips, what to buy and forecast settings. Your key, account and
            alerts are not included.</span>
        </span>
        <textarea class="o-share" data-share rows="6" spellcheck="false"
          placeholder="Paste settings here to import them"
          aria-label="Shared settings">${Fmt.esc(shareText)}</textarea>
        <span class="o-acts" style="margin:0">
          <button type="button" class="o-btn" data-act="share-export">Copy my settings</button>
          <button type="button" class="o-btn" data-act="share-import">Import</button>
        </span>
      </div>`);
  }

  const dot = (tone) => `<span class="o-acct-dot${tone ? " is-" + tone : ""}"></span>`;
  const noDot = '<span class="o-acct-dot is-none"></span>';

  function accountRows() {
    const haveKey = Torn.haveKey();
    const haveToken = Oracle.haveToken();
    const acct = Account.state();
    const out = [];

    if (!haveKey || editingKey) {
      out.push(`<div class="o-row is-stack">
        <span class="o-row-text">
          <span class="o-row-label">${dot()} Torn API key</span>
          <span class="o-row-help o-keep">A Limited key is enough. It stays in this browser and
            is sent only to Torn. Creating an account sends it to Torn Oracle once to
            check it. Torn Oracle does not store it.</span>
        </span>
        <span class="o-keyform">
          <input type="password" data-secret="torn_key" placeholder="Paste your key"
                 autocomplete="off" spellcheck="false" aria-label="Torn API key">
          <button type="button" class="o-btn is-primary" data-act="save-key">Save</button>
          ${haveKey ? '<button type="button" class="o-btn" data-act="cancel-key">Cancel</button>' : ""}
        </span>
      </div>`);
    } else {
      out.push(row(dot("go") + " Torn API key", "Saved in this browser.",
        `<button type="button" class="o-link" data-act="edit-key">Change</button>
         <button type="button" class="o-link" data-act="remove-key">Remove</button>`));
    }

    if (haveToken) {
      out.push(row(dot("go") + " Torn Oracle account",
        acct.tornName ? "Signed in as <b>" + Fmt.esc(acct.tornName) + "</b>." : "Signed in.",
        `<button type="button" class="o-link" data-act="sign-out">Sign out</button>`));
    } else if (editingToken) {
      out.push(`<div class="o-row is-stack">
        <span class="o-row-text">
          <span class="o-row-label">${dot()} Torn Oracle token</span>
          <span class="o-row-help">From <b>/token new</b> on Discord.</span>
        </span>
        <span class="o-keyform">
          <input type="password" data-secret="oracle_token" placeholder="Paste your token"
                 autocomplete="off" spellcheck="false" aria-label="Torn Oracle token">
          <button type="button" class="o-btn is-primary" data-act="save-token">Save</button>
          <button type="button" class="o-btn" data-act="cancel-token">Cancel</button>
        </span>
      </div>`);
    } else {
      const create = haveKey
        ? `<button type="button" class="o-btn is-primary" data-act="signup" ${busy ? "disabled" : ""}>
             ${evictOldest ? "Replace oldest sign-in" : "Create free account"}</button>`
        : '<span class="o-state muted">Add your key first</span>';
      out.push(row(dot() + " Torn Oracle account",
        "Needed for shops, forecasts and plans. "
        + '<button type="button" class="o-link" data-act="edit-token">I have a token</button>',
        create, "is-wrap"));
    }

    if (haveToken && acct.known) {
      out.push(acct.discordLinked
        ? row(dot("go") + " Discord", "Linked. Alerts and your plan can reach you there.", "")
        : row(dot("warn") + " Discord",
          "Not linked. Run <b>/register</b> on Discord with your Torn key.", ""));
    }

    if (haveToken) {
      const sync = SettingsSync.state();
      out.push(sync.lastError
        ? row(dot("warn") + " Settings", Fmt.esc(sync.lastError),
          '<span class="o-state warn">Not synced</span>')
        : sync.pulledAt
          ? row(dot("go") + " Settings", "Shared with Discord /settings.",
            '<span class="o-state muted">Synced</span>')
          : row(dot() + " Settings", "", '<span class="o-state muted">Checking</span>'));
      out.push(`<button type="button" class="o-row o-disclose" data-act="tokens-toggle"
        aria-expanded="${tokensOpen}"><span class="o-row-text">
          <span class="o-row-label">${noDot} Tokens</span></span></button>`);
      if (tokensOpen) out.push(tokensBody());
    }
    return out.join("");
  }

  function tokensBody() {
    if (tokens === null) return `<div class="o-subrows"><div class="o-note">Loading…</div></div>`;
    const currentId = Settings.get("oracle_token_id");
    const rows = tokens.list.map((t) => {
      const mine = currentId && t.id === currentId;
      const when = "Added " + new Date(t.created_at).toLocaleDateString()
        + (t.last_used_at ? " · used " + Fmt.ago(Date.now() - Date.parse(t.last_used_at))
                          : " · never used");
      return row(Fmt.esc(t.label || "token") + (mine ? " · this browser" : ""), Fmt.esc(when),
        mine ? '<span class="o-state muted">In use</span>'
             : `<button type="button" class="o-link" data-act="token-del" data-id="${t.id}"
                  ${tokenBusy ? "disabled" : ""}>Delete</button>`);
    }).join("");
    const full = tokens.list.length >= tokens.max;
    return `<div class="o-subrows">${rows}
      <div class="o-acts">
        <button type="button" class="o-btn" data-act="token-new"
          ${tokenBusy || full ? "disabled" : ""}>New token for this browser</button>
        ${full ? `<span class="o-note">Limit of ${tokens.max} reached.</span>` : ""}
      </div>
    </div>`;
  }

  async function loadTokens() {
    try {
      tokens = await Oracle.tokensList();
    } catch (err) {
      tokens = { list: [], max: 5 };
      tell(err.message, "warn");
    }
    Panel.refresh("settings");
  }

  function escortLine() {
    if (!Settings.get("escort_on")) return "";
    const e = Escort.explain();
    return `<div class="o-note${e.ok ? "" : " is-warn"}" style="margin:0 0 10px">${Fmt.esc(e.text)}</div>`;
  }

  function diagnostics() {
    const t = Torn.health();
    const o = Oracle.health();
    const tr = Tracker.health();
    const acct = Account.state();
    const pos = Trip.position();
    const recent = Env.log.entries().slice(-12).reverse().map((e) =>
      `<div class="o-sub" style="margin:0">${Fmt.esc(Fmt.clock(e.at))} · ${Fmt.esc(e.message)}</div>`
    ).join("");
    const kv = (k, v, cls) => `<div class="o-field"><span class="o-field-label">${k}</span>
      <span class="${cls || ""}">${Fmt.esc(v)}</span></div>`;

    return section("diagnostics", "Help", "Diagnostics for a bug report", `
      ${kv("Torn key", t.haveKey ? t.state : "not set",
           t.state === "ok" ? "go" : t.state === "unknown" ? "muted" : "bad")}
      ${kv("Torn requests", t.budgetLeft + " / " + t.budget + " per minute", "o-mono")}
      ${kv("Torn Oracle server", o.consecutiveFailures
        ? o.consecutiveFailures + " recent failures" : "reachable",
           o.consecutiveFailures ? "warn" : "go")}
      ${kv("Account", !acct.haveToken ? "no token" : !acct.known ? "not read yet"
        : acct.discordLinked ? "linked to Discord" : "no Discord link")}
      ${kv("Forecasts", !acct.known ? "unknown" : acct.premium ? "available" : "unavailable")}
      ${kv("Position", pos.known ? pos.phase : "unknown (" + pos.why + ")")}
      ${kv("Reading Torn every", Math.round(tr.cadence / 1000) + "s", "o-mono")}
      ${kv("Host", (Env.isPDA ? "TornPDA" : "browser") + (Env.caps.notify ? "" : " · no notifications"))}
      <div style="margin-top:6px">${recent}</div>
      <div class="o-acts" style="margin-bottom:10px">
        <button type="button" class="o-btn" data-act="copy-diag">Copy diagnostics</button>
        <button type="button" class="o-btn" data-act="reset">Reset everything</button>
      </div>`);
  }

  function wire(el) {

    for (const input of el.querySelectorAll("input.o-money")) {
      input.addEventListener("input", () => {
        const raw = input.value;
        if (!/^[\d,]*$/.test(raw)) return;
        const digits = raw.replace(/,/g, "");
        const before = raw.slice(0, input.selectionStart).replace(/,/g, "").length;
        const shown = digits ? Number(digits).toLocaleString("en-US") : "";
        if (shown === raw) return;
        input.value = shown;
        let at = 0;
        for (let seen = 0; at < shown.length && seen < before; at++) if (shown[at] !== ",") seen++;
        input.setSelectionRange(at, at);
      });
    }

    for (const input of el.querySelectorAll("[data-set]")) {
      const name = input.dataset.set;
      const r = Settings.BY_NAME[name];
      input.addEventListener("change", () => {
        const value = r.kind === "bool" ? input.checked
          : r.unit === "$" ? parseMoney(input.value)
            : (r.kind === "int" || r.kind === "number") ? Number(input.value)
              : input.value;
        if (!Settings.set(name, value)) {
          tell(r.label + ": that value is out of range.", "warn");
          Panel.refresh("settings");
          return;
        }
        afterChange(name);
      });
    }

    for (const chip of el.querySelectorAll("[data-toggle]")) {
      chip.addEventListener("click", () => {
        const name = chip.dataset.toggle;
        const list = Settings.get(name).slice();
        const at = list.indexOf(chip.dataset.value);
        if (at >= 0) list.splice(at, 1); else list.push(chip.dataset.value);
        Settings.set(name, list);
        afterChange(name);
      });
    }

    for (const chip of el.querySelectorAll("[data-pick-id]")) {
      chip.addEventListener("click", () => {
        const type = chip.dataset.pickType;
        const id = Number(chip.dataset.pickId);
        const ids = (Settings.get("plan_items")[type] || []).slice();
        const at = ids.indexOf(id);
        if (at >= 0) ids.splice(at, 1); else ids.push(id);
        setPicks(type, ids);
      });
    }

    for (const btn of el.querySelectorAll("[data-pick-clear]")) {
      btn.addEventListener("click", () => setPicks(btn.dataset.pickClear, []));
    }

    for (const fold of el.querySelectorAll("details[data-pick]")) {
      fold.addEventListener("toggle", () => {
        if (fold.open) openPicks.add(fold.dataset.pick);
        else openPicks.delete(fold.dataset.pick);
      });
    }

    const share = el.querySelector("[data-share]");
    if (share) share.addEventListener("input", () => { shareText = share.value; });

    for (const sect of el.querySelectorAll("details[data-sect]")) {
      sect.addEventListener("toggle", () => {
        if (sect.open) openSections.add(sect.dataset.sect);
        else openSections.delete(sect.dataset.sect);
        if (sect.open && sect.dataset.sect === "buying" && catalogue === null && !catalogueError) loadCatalogue();
      });
    }

    for (const btn of el.querySelectorAll("[data-act]")) {
      btn.addEventListener("click", () => act(el, btn.dataset.act, btn));
    }

    for (const input of el.querySelectorAll("[data-secret]")) {
      input.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        act(el, input.dataset.secret === "torn_key" ? "save-key" : "save-token", input);
      });
    }
  }

  async function act(el, action, btn) {
    switch (action) {
      case "edit-key": editingKey = true; Panel.refresh("settings"); break;
      case "cancel-key": editingKey = false; Panel.refresh("settings"); break;
      case "edit-token": editingToken = true; Panel.refresh("settings"); break;
      case "cancel-token": editingToken = false; Panel.refresh("settings"); break;
      case "remove-key":
        Settings.set("torn_key", "");
        Torn.forget();
        evictOldest = false;
        tell("Key removed.");
        Panel.refresh("settings");
        break;
      case "save-key": {
        const value = (el.querySelector('[data-secret="torn_key"]').value || "").trim();
        if (!value) return;

        tell("Checking the key with Torn…");
        const res = await Torn.verify(value);
        if (!res.ok) { tell(res.message, "warn"); return; }
        Settings.set("torn_key", value);
        Torn.forget();
        evictOldest = false;
        editingKey = false;
        tell("Key saved for " + (res.name || "your account") + ".");
        Tracker.poke();
        Panel.refresh("settings", true);
        break;
      }
      case "save-token": {
        const raw = (el.querySelector('[data-secret="oracle_token"]').value || "").trim();
        if (!raw) return;

        const value = (raw.match(/orc_[A-Za-z0-9_-]{20,}/) || [])[0];
        if (!value) {
          tell(/^[A-Za-z0-9]{16}$/.test(raw)
            ? "That is a Torn API key. Paste your Torn Oracle token here."
            : "That is not a Torn Oracle token. Tokens start with orc_.");
          return;
        }
        Settings.set("oracle_token", value);
        Settings.set("oracle_token_id", 0);
        editingToken = false;
        tell("Signed in.");
        Panel.refresh("settings", true);
        break;
      }
      case "sign-out":
        if (!window.confirm("Sign out of Torn Oracle in this browser?")) return;

        await Escort.clear();
        Settings.set("oracle_token", "");
        Settings.set("oracle_token_id", 0);
        tokens = null;
        tokensOpen = false;
        tell("Signed out.");
        Panel.refresh("settings");
        break;
      case "signup": {
        busy = true;
        tell(evictOldest ? "Replacing your oldest sign-in…" : "Creating your account…");
        Panel.refresh("settings");
        try {
          const res = await Oracle.signup(Settings.get("torn_key"), evictOldest);
          evictOldest = false;

          Settings.set("oracle_token", res.token);
          if (res.token_id) Settings.set("oracle_token_id", res.token_id);
          tell("Account ready. Shops, forecasts and plans work now.");
        } catch (err) {
          if (err.code === "too_many_tokens") {
            evictOldest = true;
            tell("This account has the most sign-ins allowed. Press again to replace the oldest.", "warn");
          } else {
            evictOldest = false;
            tell(err.message, "warn");
          }
        } finally {
          busy = false;
          Panel.refresh("settings");
        }
        break;
      }
      case "picks-retry":
        catalogue = null;
        catalogueError = null;
        loadCatalogue();
        Panel.refresh("settings");
        break;
      case "share-export": {
        shareText = Settings.exportShared();
        Panel.refresh("settings");
        try {
          await navigator.clipboard.writeText(shareText);
          tell("Settings copied.");
        } catch (e) {
          tell("Settings are in the box. Copy them from there.");
        }
        break;
      }
      case "share-import": {
        const text = (el.querySelector("[data-share]").value || "").trim();
        if (!text) { tell("Paste settings into the box first.", "warn"); return; }
        const res = Settings.importShared(text);
        if (!res) { tell("These are not Torn Oracle settings.", "warn"); return; }
        shareText = "";
        Panel.applyTheme();
        Panel.refresh("settings");
        Panel.badges();
        const msg = "Imported " + Fmt.plural(res.applied, "setting") + "."
          + (res.skipped ? " Skipped " + Fmt.plural(res.skipped, "value") + " that did not fit." : "")
          + (Trip.get().active ? " Re-plan to use them." : "");
        tell(msg, res.skipped ? "warn" : undefined);
        break;
      }
      case "tokens-toggle":
        tokensOpen = !tokensOpen;
        if (tokensOpen && tokens === null) loadTokens();
        Panel.refresh("settings");
        break;
      case "token-new": {
        tokenBusy = true;
        Panel.refresh("settings");
        try {

          const oldId = Settings.get("oracle_token_id");
          const res = await Oracle.tokenCreate("browser");
          Settings.set("oracle_token", res.token);
          Settings.set("oracle_token_id", res.id);
          if (oldId && oldId !== res.id) {
            try { await Oracle.tokenDelete(oldId); }
            catch (e) { Env.log.warn("replacing old token: revoke failed", e.message); }
          }
          tell("New token in use.");
          await loadTokens();
        } catch (err) {
          tokensOpen = true;
          if (tokens === null) await loadTokens();
          tell(err.message, "warn");
        } finally {
          tokenBusy = false;
          Panel.refresh("settings");
        }
        break;
      }
      case "token-del": {
        if (!window.confirm("Delete this token? Anything signed in with it stops working.")) return;
        tokenBusy = true;
        Panel.refresh("settings");
        try {
          await Oracle.tokenDelete(Number(btn.dataset.id));
          tell("Token deleted.");
          await loadTokens();
        } catch (err) {
          tell(err.message, "warn");
        } finally {
          tokenBusy = false;
          Panel.refresh("settings");
        }
        break;
      }
      case "copy-diag": {
        const blob = JSON.stringify({
          settings: Settings.exportSafe(),
          torn: Torn.health(),
          oracle: Oracle.health(),
          sync: SettingsSync.state(),
          tracker: Tracker.health(),
          trip: {
            phase: Trip.get().phase, legs: Trip.get().legs.length,
            runtime: Trip.get().runtime,
          },
          journal: Trip.journal().slice(-40),
          log: Env.log.entries().slice(-60),
        }, null, 2);
        try {
          await navigator.clipboard.writeText(blob);
          tell("Copied. Paste it into a bug report.");
        } catch (e) {
          tell("The clipboard is not available. The report is in the console.", "warn");

          console.log(blob);
        }
        break;
      }
      case "reset":
        if (!window.confirm("Remove every setting, your key and your token from this browser?")) return;

        await Escort.clear();
        Trip.stop("Settings reset.");
        Alerts.reset();
        for (const r of Settings.SCHEMA) Settings.set(r.name, r.def);
        tell("Everything cleared.");
        Panel.refresh("settings");
        break;
      default:
        break;
    }
  }

  const STRUCTURAL = ["capacity", "haircut_pct", "sell_to", "travel_type", "end_hours", "min_margin",
                      "max_cost", "plan_countries", "item_types", "plan_items", "landing_target",
                      "landing_floor", "drug_priority", "max_drug_wait"];

  function afterChange(name) {
    Panel.applyTheme();
    if (STRUCTURAL.includes(name) && Trip.get().active) tell("Re-plan to use the new value.");
    Panel.refresh("settings");
    Panel.badges();
  }

  function reveal(name) {
    const r = Settings.BY_NAME[name];
    initSections();
    if (r) openSections.add(r.group);
    Panel.show("settings");
    const at = Panel.paneFor("settings")?.querySelector(`[data-row="${name}"]`);
    if (!at) return;
    at.scrollIntoView({ block: "center" });
    at.classList.add("is-found");
  }

  return { id: "settings", label: "Settings", render, reveal, tick: () => { }, badge: () => null };
})();

const ViewExports = (() => {
  "use strict";

  const ROW_CAP = 14;

  let data = null;
  let loading = false;
  let error = null;
  let expanded = false;

  async function load(force) {
    if (!Oracle.haveToken() || loading) return;
    if (!force && data && Date.now() - data.at < 45_000) return;
    loading = true;
    error = null;
    Panel.refresh("exports");
    try {
      const payload = await Oracle.exports();
      data = { rows: payload.exports || [], at: Date.now() };
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
      Panel.refresh("exports");
    }
  }

  function render(el) {
    if (!Oracle.haveToken()) {
      el.innerHTML = Gate.account("see what foreign shops pay");
      Gate.wire(el);
      return;
    }
    if (loading && !data) { el.innerHTML = `<div class="o-empty">Reading the shops…</div>`; return; }
    if (error) { el.innerHTML = `<div class="o-note is-warn">${Fmt.esc(error)}</div>`; return; }
    if (!data) { el.innerHTML = `<div class="o-empty">Nothing loaded yet.</div>`; load(); return; }
    if (!data.rows.length) {
      el.innerHTML = `<div class="o-empty">No foreign shop pays more than Torn's market value right now.</div>`;
      return;
    }
    const cap = Settings.get("capacity");
    const shown = expanded ? data.rows : data.rows.slice(0, ROW_CAP);
    const rows = shown.map((r) => `<tr>
        <td>${Fmt.esc(r.name)}<span class="o-sub">${Flags.place(r.country)}</span></td>
        <td class="num">${Fmt.esc(Fmt.price(r.pays))}<span class="o-sub">Torn ${Fmt.esc(Fmt.price(r.market_value))}</span></td>
        <td class="num"><span class="go">+${Fmt.esc(Fmt.price(r.margin))}</span>
          <span class="o-sub">${Fmt.esc(Fmt.money(r.margin * cap))} for ${Fmt.esc(Fmt.count(cap))}</span></td>
        <td class="num">${Fmt.esc(Fmt.count(r.quantity))}</td>
      </tr>`).join("");
    const more = data.rows.length > ROW_CAP
      ? `<button type="button" class="o-btn" data-act="expand">${expanded ? "Fewer" : "All " + data.rows.length}</button>`
      : "";
    el.innerHTML = `<div class="o-scroll"><table>
        <thead><tr><th>Item</th><th class="num">Shop pays</th><th class="num">Profit</th><th class="num">On shelf</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="o-acts">${more}</div>
      <div class="o-note">Buy in Torn and sell to the shop abroad. A Black Market pays its
        current price. Other shops pay 75% of theirs.</div>`;
    const expand = el.querySelector('[data-act="expand"]');
    if (expand) expand.addEventListener("click", () => { expanded = !expanded; Panel.refresh("exports"); });
  }

  return {
    id: "exports", label: "Exports", render, load,
    badge: () => null,
    refresh: (force) => load(force), refreshEvery: 60_000,
  };
})();

const Assist = (() => {
  "use strict";

  const BAR_ID = "oracle-assist";
  const VISIT_KEY = "assist_visit";

  const SETTLE_MS = 1500;

  let bar = null;
  let busy = false;
  let settle = null;
  let message = null;
  let observed = null;
  let windows = { code: null, at: 0, bands: {} };
  let wasReady = false;
  let alerted = false;
  let observer = null;
  let pending = null;
  const loadedAt = Date.now();

  function rfc() {
    const m = /(?:^|;\s*)rfc_v=([^;]+)/.exec(document.cookie || "");
    return m ? m[1] : "";
  }

  function plain(html) {
    try {
      const body = new DOMParser().parseFromString(String(html), "text/html").body;
      for (const el of body.querySelectorAll(".counter-wrap[data-time]")) {
        el.textContent = Fmt.duration(Number(el.dataset.time) * 1000);
      }
      for (const el of body.querySelectorAll("br, p, div, li")) el.after(" ");
      return body.textContent.replace(/\s+/g, " ").trim();
    } catch (e) {
      return String(html);
    }
  }

  function textOf(data) {
    if (!data || typeof data !== "object") return "";
    const raw = data.message || data.text
      || (data.error && (data.error.message || (typeof data.error === "string" ? data.error : "")))
      || "";
    return raw ? plain(raw) : "";
  }

  async function travelData(step, { method = "GET", query = "", body, form } = {}) {
    const url = "/page.php?sid=travelData&step=" + step + query + "&rfcv=" + rfc();
    let payload;
    if (form) {
      payload = new FormData();
      for (const [k, v] of Object.entries(form)) payload.set(k, v);
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
    }
    try {
      const res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" },
        body: payload,
      });
      let data = null;
      try { data = await res.json(); } catch (e) {  }
      const ok = res.ok && !!data && data.success !== false && !data.error;
      return { ok, data, message: textOf(data) || (ok ? "" : "Torn did not accept that.") };
    } catch (err) {
      return { ok: false, data: null, message: "Could not reach Torn." };
    }
  }

  function slotsOf(data) {
    const slots = (data && (data.slots || (data.inventory && data.inventory.slots))) || [];
    return Array.isArray(slots) ? slots : [];
  }

  let slots = null;
  let slotsLoading = null;

  function readSlots() {
    if (!slotsLoading) {
      slotsLoading = travelData("inventory").then((inv) => {
        slotsLoading = null;
        const list = slotsOf(inv.data);
        slots = inv.ok || list.length ? list : null;
        return inv;
      });
    }
    return slotsLoading;
  }

  async function useItem(ref) {
    const holds = (s) => s && s.item && Number(s.item.ID) === ref.id;
    const inv = Page.travelInventory();
    const onPage = inv ? inv.items.filter((n) => n === ref.name).length : Infinity;
    if (!slots || onPage < slots.filter(holds).length) {
      const read = await readSlots();
      if (!slots) return read;
    }
    const i = slots.findIndex(holds);
    if (i < 0) return { ok: false, message: "No " + ref.name + " in your travel inventory." };
    const [slot] = slots.splice(i, 1);
    const res = await travelData("useItem", { method: "POST", body: { slotID: slot.ID } });
    if (!res.ok) slots = null;
    return res;
  }

  async function packItem(ref) {
    const found = await travelData("searchItem", { method: "POST", form: { q: ref.name } });
    const list = found.data && Array.isArray(found.data.list) ? found.data.list : [];
    const named = list.filter((e) => e && e.name === ref.name && !e.disabled);
    const hit = named.find((e) => !e.faction) || named[0];
    if (!hit) return { ok: false, message: "No " + ref.name + " in your inventory." };
    const body = { itemID: hit.id };
    if (hit.armouryID) body.armouryID = hit.armouryID;
    if (hit.faction) body.factionItem = "1";
    return travelData("addSlotItem", { method: "POST", body });
  }

  const ACTIONS = {
    pack: (d) => packItem(d.ref),
    use: (d) => useItem(d.ref),
    buy: (d) => travelData("buy", { query: "&itemID=" + d.ref.id + "&amount=" + d.amount }),
    fly: () => travelData("travelHome", { method: "POST" }),
  };

  const WINDOWS_EVERY_MS = 5 * 60_000;

  function countryCode() {
    const code = Trip.get().country;
    if (code) return code;
    const name = String(document.body.dataset.country || "").replace(/-/g, " ").toLowerCase();
    return Data.CODE_BY_NAME[name] || null;
  }

  async function loadWindows() {
    const code = countryCode();
    if (!code || !Oracle.haveToken()) return;
    if (windows.code === code && Date.now() - windows.at < WINDOWS_EVERY_MS) return;
    windows = { code, at: Date.now(), bands: windows.code === code ? windows.bands : {} };
    try {
      const batch = await Oracle.forecasts(code, { travel: Settings.get("travel_type") });
      windows.bands = batch.restocks || {};
      paint();
    } catch (err) {
      Env.log.warn("assist restock windows failed", err.message);
    }
  }

  function windowNote(track) {
    for (const ref of track) {
      const band = windows.bands[String(ref.id)];
      const from = band && Date.parse(band.from || band.p50);
      const to = band && Date.parse(band.to || band.p50);
      if (!from || isNaN(from)) continue;
      if (to && Date.now() > to) return ref.name + " restock overdue.";
      return ref.name + " restock " + Fmt.clock(from) + (to > from ? "–" + Fmt.clock(to) : "") + ".";
    }
    return "";
  }

  function visit() {
    const v = Env.read(VISIT_KEY, null);
    return v && typeof v === "object" ? v : {};
  }

  function markVisit(patch) {
    Env.write(VISIT_KEY, Object.assign(visit(), patch));
  }

  function inHospital() {
    if (visit().medOut) return false;
    if (observed && observed.at > loadedAt) return observed.state === "Hospital";
    return Page.hospitalLayout();
  }

  function tracked() {
    const picked = Settings.get("assist_track");
    if (picked.length) return picked;
    const leg = Trip.get().active ? Trip.currentLeg() : null;
    return leg && leg.item_id ? [{ id: leg.item_id, name: leg.item_name }] : [];
  }

  function facts() {
    const mode = Page.mode();
    const inv = Page.travelInventory();
    const v = visit();
    return {
      mode,
      kit: Settings.get("assist_kit"),
      track: tracked(),
      carried: inv ? inv.items : null,
      room: inv ? inv.slots - inv.packed : null,
      hospital: inHospital(),
      outbound: Trip.get().phase === "outbound",
      rows: mode === "abroad" ? Page.shopRows() : [],
      wallet: mode === "abroad" ? Page.shopWallet() : null,
      bought: v.bought === true,
      medOut: v.medOut === true,
      hospUsed: v.hospUsed === true,
    };
  }

  function decide(f) {
    const count = (ref) => (ref && f.carried ? f.carried.filter((n) => n === ref.name).length : 0);
    const kit = f.kit || { hosp: null, med: null, meds: 0, extras: [] };

    if (f.mode === "agency") {
      const need = [];
      if (kit.hosp) need.push({ ref: kit.hosp, n: 1 });
      if (kit.med && kit.meds > 0) need.push({ ref: kit.med, n: kit.meds });
      for (const e of kit.extras || []) need.push({ ref: { id: e.id, name: e.name }, n: e.n });
      if (!need.length || !f.carried) return null;
      for (const { ref, n } of need) {
        const have = count(ref);
        if (have < n) {
          if (f.room !== null && f.room <= 0) {
            return { label: "Your bag is full", note: "No room for " + ref.name + "." };
          }
          return { act: "pack", ref, label: "Pack " + ref.name + " (" + (have + 1) + " of " + n + ")" };
        }
      }
      return { label: "Trip kit packed", note: "Ready to fly." };
    }

    if (f.mode === "flight") {
      if (!kit.hosp || !f.outbound) return null;
      if (f.hospUsed) return { label: "Self-hosp used", note: "You land in hospital." };
      if (f.carried && !count(kit.hosp)) return null;
      return { act: "use", ref: kit.hosp, label: "Self-hosp",
               note: "You can self-hosp close to landing, or wait till after you land." };
    }

    if (f.mode !== "abroad" || !f.wallet) return null;

    const free = Math.max(0, f.wallet.capacity - f.wallet.taken);
    const meds = kit.med ? count(kit.med) : 0;
    const hospLeft = kit.hosp ? count(kit.hosp) : 0;
    const shelves = f.track
      .map((ref) => ({ ref, row: f.rows.find((r) => r.id === ref.id) }))
      .filter((x) => x.row);
    const stock = shelves.reduce((sum, x) => sum + x.row.stock, 0);
    const names = f.track.map((r) => r.name).join(", ");

    const want = f.hospital && meds ? free + 1 : free;
    const ready = want > 0 && shelves.length > 0 && stock >= want;
    const watching = names ? "Watching " + names : "Pick items to watch on the Assist tab";

    const buy = () => {
      for (const x of shelves) {
        if (x.row.stock <= 0 || !x.row.price) continue;
        const amount = Math.min(x.row.stock, free, Math.floor(f.wallet.money / x.row.price));
        if (amount > 0) return { act: "buy", ref: x.ref, amount, ready, label: "Buy " + amount + " " + x.ref.name };
      }
      return null;
    };

    if (f.hospital) {
      if (!ready) return { label: watching, note: want + " slots to fill.", ready, watch: true };
      if (meds > 0) {
        return { act: "use", ref: kit.med, ready,
                 label: "Med out (" + meds + " left)", note: "Restocked: " + stock + " in stock." };
      }

      const step = buy();
      if (step) return Object.assign(step, { note: "Torn takes it when your hospital time ends." });
      return { label: "Restocked", note: "Buy when your hospital time ends.", ready };
    }

    if (free === 0 && f.medOut && !f.bought) return { label: "Your bag is full", ready };

    if (free === 0 && !(hospLeft && meds)) {
      return { act: "fly", label: "Fly home", note: "Your bag is full.", ready };
    }

    const step = buy();
    if (step) return step;
    if (hospLeft) {
      return { act: "use", ref: kit.hosp, ready,
               label: "Self-hosp", note: "Waits in hospital, safe from muggers." };
    }
    if (f.bought) return { act: "fly", label: "Fly home", note: free + " slots still free.", ready };
    return { label: watching, note: free + " slots to fill.", ready, watch: true };
  }

  function pageKey() {
    const inv = Page.travelInventory();
    const w = Page.shopWallet();
    return JSON.stringify([inv && inv.items, w, document.body.dataset.layout]);
  }

  function settling() {
    if (!settle) return false;
    if (Date.now() > settle.until || pageKey() !== settle.key) { settle = null; return false; }
    return true;
  }

  async function press() {
    if (busy || settling()) return;
    const step = decide(facts());
    if (!step || !step.act) return;
    busy = true;
    paint();
    let res;
    try { res = await ACTIONS[step.act](step); }
    finally { busy = false; }
    const kit = Settings.get("assist_kit");
    const med = step.act === "use" && !!kit.med && step.ref.id === kit.med.id;
    if (res.ok) {
      if (step.act === "buy") markVisit({ bought: true });
      if (step.act === "use" && Page.mode() === "flight") markVisit({ hospUsed: true });

      if (step.act === "use") markVisit({ medOut: med });
      settle = { until: Date.now() + SETTLE_MS, key: pageKey() };
      setTimeout(paint, SETTLE_MS + 50);
      try { window.dispatchEvent(new Event("focus")); } catch (e) {  }
      if (step.act === "use") Tracker.poke();
    } else if (step.act === "buy" && visit().medOut && kit.med
               && (facts().carried || []).includes(kit.med.name)) {

      markVisit({ medOut: false });
    }
    message = res.message ? { text: res.message, tone: res.ok ? "" : "warn" } : null;
    Env.log.event("assist " + step.act + (res.ok ? " ok" : " refused") + ": " + (res.message || ""));
    paint();
  }

  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      [0, 0.25].forEach((at) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.value = 0.15;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + at);
        osc.stop(ctx.currentTime + at + 0.15);
      });
      setTimeout(() => ctx.close(), 1000);
    } catch (e) {  }
  }

  function noticeReady(step) {
    const ready = !!(step && step.ready);
    if (ready && !wasReady && !alerted) {
      alerted = true;
      if (Settings.get("alerts_on")) {
        Env.toast("Restocked", step.label + ". " + (step.note || ""));
        beep();
      }
      Env.log.event("assist: restock seen");
    }
    if (!ready) alerted = false;
    wasReady = ready;
  }

  function focused() {
    try { return Env.visible() && document.hasFocus(); } catch (e) { return Env.visible(); }
  }

  function build() {
    bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.innerHTML = `
      <div class="oa-line"><span class="oa-brand">Torn Oracle</span><span class="oa-note"></span></div>
      <button type="button" class="oa-go"></button>
      <div class="oa-msg" role="status"></div>`;
    bar.querySelector(".oa-go").addEventListener("click", (ev) => {
      if (!ev.isTrusted) return;
      press();
    });
    return bar;
  }

  function paint() {
    if (!bar) return;
    const mode = Page.mode();

    const v = visit();
    if (mode === "agency" && Object.keys(v).length) Env.write(VISIT_KEY, {});
    if (mode === "flight" && (v.bought || v.medOut)) markVisit({ bought: false, medOut: false });
    if (mode === "abroad" && v.hospUsed) markVisit({ hospUsed: false });
    if (mode === "abroad" && !focused()) {
      if (!drawn) bar.hidden = true;
      return;
    }
    const f = facts();
    const step = decide(f);
    const kit = f.kit || {};
    if ((mode === "flight" || mode === "abroad") && (kit.hosp || kit.med) && !slots && !slotsLoading
        && focused()) {
      readSlots();
    }
    if (mode === "abroad") {
      noticeReady(step);
      loadWindows();
      if (step && step.watch) {
        const note = windowNote(f.track);
        if (note) step.note = note + " " + step.note;
      }
    }
    draw(step);
  }

  let drawn = "";
  function draw(step) {
    const view = step ? {
      dark: Page.darkMode(),
      ready: !!step.ready && !!step.act,
      label: busy ? "Working…" : step.label,
      disabled: busy || !step.act || settling(),
      note: step.note || "",
      msg: message ? message.text : "",
      tone: message && message.tone ? " is-" + message.tone : "",
    } : null;
    const key = JSON.stringify(view);
    if (key === drawn) return;
    drawn = key;
    if (!view) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.classList.toggle("o-dark", view.dark);
    bar.classList.toggle("is-ready", view.ready);
    const btn = bar.querySelector(".oa-go");
    btn.textContent = view.label;
    btn.disabled = view.disabled;
    bar.querySelector(".oa-note").textContent = view.note;
    const msg = bar.querySelector(".oa-msg");
    msg.textContent = view.msg;
    msg.className = "oa-msg" + view.tone;
  }

  function schedule() {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = null; paint(); });
  }

  function watchShop() {
    if (observer) return;
    const root = document.querySelector("#travel-root");
    if (!root) return;
    observer = new MutationObserver(() => { if (focused()) schedule(); });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }

  function mount() {
    const first = !bar;
    if (first) build();

    if (first && Page.mode() === "abroad" && Page.hospitalLayout() && visit().medOut) {
      markVisit({ medOut: false });
    }
    if (Page.mode() === "other") {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
      return;
    }
    Page.placeBar(bar);
    watchShop();
    if (first || !drawn) paint();
  }

  function onObservation(obs) {
    if (!obs || !obs.state) return;
    observed = { at: obs.at || Date.now(), state: obs.state };
    paint();
  }

  window.addEventListener("focus", () => schedule());
  document.addEventListener("visibilitychange", () => schedule());

  let typeByName = null;

  async function itemTypes() {
    if (!typeByName) {
      const payload = await Torn.items();
      const list = Array.isArray(payload.items) ? payload.items : Object.values(payload.items || {});
      typeByName = new Map(list.map((it) => [it.name, Data.itemType(it.type)]));
    }
    return typeByName;
  }

  async function keptPacked(items) {
    const kit = Settings.get("assist_kit");
    const extras = new Set(kit.extras.map((e) => e.name));
    const used = new Set([kit.hosp, kit.med].filter(Boolean).map((r) => r.name));
    let kept = items.filter((name) => extras.has(name)).length;
    const others = items.filter((name) => !extras.has(name) && !used.has(name));
    if (!others.length) return kept;
    let types;
    try { types = await itemTypes(); } catch (e) { return null; }
    for (const name of others) {
      const type = types.get(name);
      if (type === "Weapon" || type === "Armor") kept += 1;
    }
    return kept;
  }

  return { mount, paint, decide, onObservation, keptPacked, tracked };
})();

const ViewAssist = (() => {
  "use strict";

  let catalogue = null;
  let loading = false;
  let error = null;

  const tell = (text, tone) => Panel.flash(text, tone, "assist");

  async function loadCatalogue() {
    if (loading || catalogue || !Torn.haveKey()) return;
    loading = true;
    error = null;
    try {
      const payload = await Torn.items();
      const list = Array.isArray(payload.items) ? payload.items : Object.values(payload.items || {});
      catalogue = list.map((it) => ({
        id: Number(it.id),
        name: it.name,
        abroad: ((it.value && it.value.shops) || []).some((sh) => sh.country && sh.country !== "Torn"),
      })).filter((it) => it.id > 0 && it.name)
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      error = err.message || String(err);
    } finally {
      loading = false;
      Panel.refresh("assist");
    }
  }

  function find(name, abroadOnly) {
    const low = name.trim().toLowerCase();
    return (catalogue || []).find((it) => it.name.toLowerCase() === low
                                          && (!abroadOnly || it.abroad)) || null;
  }

  function options(id, abroadOnly) {
    const items = (catalogue || []).filter((it) => !abroadOnly || it.abroad);
    return `<datalist id="${id}">${items.map((it) =>
      `<option value="${Fmt.esc(it.name)}"></option>`).join("")}</datalist>`;
  }

  function itemInput(slot, ref, list) {
    return `<input type="text" data-kit="${slot}" list="${list}" autocomplete="off"
      placeholder="Item name" value="${ref ? Fmt.esc(ref.name) : ""}">`;
  }

  function render(el) {
    if (!Torn.haveKey()) {
      el.innerHTML = `<div class="o-empty"><p>Add your Torn API key in Settings to pick items.</p></div>`;
      return;
    }
    if (!catalogue && !error) loadCatalogue();
    const kit = Settings.get("assist_kit");
    const picked = Settings.get("assist_track");
    const track = Assist.tracked();
    const items = error
      ? `<p class="o-note is-warn">${Fmt.esc(error)}
           <button type="button" class="o-link" data-act="retry">Try again</button></p>`
      : !catalogue ? '<p class="o-note">Loading items…</p>' : "";

    el.innerHTML = `
      <p class="o-note" style="margin:0 0 12px">This tab makes flying as safe and quick as possible.
        Once you set it up, a button appears at the top of the travel page. Click it to self-hosp
        when you land, watch the shop for a restock, buy your items and fly home, all from one button.</p>
      ${items}
      <div class="o-group"><h4>Trip kit</h4>
        <div class="o-field"><span class="o-field-label">Self-hosp item</span>
          ${itemInput("hosp", kit.hosp, "oracle-all-items")}</div>
        <div class="o-field"><span class="o-field-label">Med-out item</span>
          ${itemInput("med", kit.med, "oracle-all-items")}</div>
        <div class="o-field"><span class="o-field-label">Med-out items to pack</span>
          <input type="number" data-kit="meds" min="0" max="${Settings.MAX_MEDS}" step="1"
                 value="${kit.meds}"></div>
      </div>
      <div class="o-group"><h4>Other items to pack</h4>
        ${kit.extras.length ? `<div class="o-chips">${kit.extras.map((e) => `
          <span class="o-chip is-on">${Fmt.esc(e.name)} × ${e.n}
            <button type="button" class="o-link" data-unpack="${e.id}" aria-label="Remove">×</button>
          </span>`).join("")}</div>` : ""}
        <p class="o-note">Extra items may reduce how many items you can buy abroad.</p>
        ${kit.extras.length < Settings.MAX_EXTRAS ? `<div class="o-keyform">
          <input type="text" data-extra list="oracle-all-items" autocomplete="off"
                 placeholder="Add an item to pack">
          <input type="number" data-extra-n min="1" max="${Settings.MAX_EXTRA_COUNT}" step="1"
                 value="1" aria-label="How many" style="width:4.5em">
          <button type="button" class="o-btn" data-act="pack">Add</button></div>` : ""}
      </div>
      <div class="o-group"><h4>Tracked items</h4>
        ${track.length ? `<div class="o-chips">${track.map((ref, i) => `
          <span class="o-chip is-on">${i + 1}. ${Fmt.esc(ref.name)}${picked.length ? `
            ${i > 0 ? `<button type="button" class="o-link" data-up="${ref.id}" aria-label="Move up">↑</button>` : ""}
            <button type="button" class="o-link" data-drop="${ref.id}" aria-label="Remove">×</button>` : ""}
          </span>`).join("")}</div>` : ""}
        <p class="o-note">${picked.length
          ? "The first item in stock is bought first."
          : track.length ? "This is your plan's item. Add items to track others."
                         : "Add the items you fly for."}</p>
        ${picked.length < Settings.MAX_TRACKED ? `<div class="o-keyform">
          <input type="text" data-track list="oracle-abroad-items" autocomplete="off"
                 placeholder="Add an item sold abroad">
          <button type="button" class="o-btn" data-act="track">Add</button></div>` : ""}
      </div>
      ${catalogue ? options("oracle-all-items", false) + options("oracle-abroad-items", true) : ""}`;
    wire(el);
  }

  function setKit(patch) {
    const next = Object.assign({}, Settings.get("assist_kit"), patch);
    const ids = [next.hosp, next.med].filter(Boolean).map((r) => r.id)
      .concat(next.extras.map((e) => e.id));
    if (new Set(ids).size !== ids.length) {
      tell("Each item can be in the kit once.", "warn");
      Panel.refresh("assist", true);
      return;
    }
    Settings.set("assist_kit", next);
    Assist.paint();
    Panel.refresh("assist", true);
  }

  function addTracked(el) {
    const input = el.querySelector("[data-track]");
    const name = input ? input.value : "";
    if (!name.trim()) return;
    const hit = find(name, true);
    if (!hit) { tell("No item sold abroad is named " + name.trim() + ".", "warn"); return; }
    if (Settings.get("assist_track").some((r) => r.id === hit.id)) {
      tell(hit.name + " is already tracked.", "warn");
      return;
    }
    Settings.set("assist_track", [...Settings.get("assist_track"), { id: hit.id, name: hit.name }]);
    Assist.paint();
    Panel.refresh("assist", true);
  }

  function addExtra(el) {
    const input = el.querySelector("[data-extra]");
    const name = input ? input.value : "";
    if (!name.trim()) return;
    const hit = find(name, false);
    if (!hit) { tell("No item is named " + name.trim() + ".", "warn"); return; }
    const n = Math.round(Number(el.querySelector("[data-extra-n]").value));
    if (!(n >= 1 && n <= Settings.MAX_EXTRA_COUNT)) {
      tell("Pack between 1 and " + Settings.MAX_EXTRA_COUNT + ".", "warn");
      return;
    }
    const extras = Settings.get("assist_kit").extras;
    setKit({ extras: [...extras, { id: hit.id, name: hit.name, n }] });
  }

  function wire(el) {
    for (const input of el.querySelectorAll('input[data-kit="hosp"], input[data-kit="med"]')) {
      input.addEventListener("change", () => {
        const slot = input.dataset.kit;
        if (!input.value.trim()) { setKit({ [slot]: null }); return; }
        const hit = find(input.value, false);
        if (!hit) { tell("No item is named " + input.value.trim() + ".", "warn"); return; }
        setKit({ [slot]: { id: hit.id, name: hit.name } });
      });
    }
    const meds = el.querySelector('input[data-kit="meds"]');
    if (meds) meds.addEventListener("change", () => setKit({ meds: Number(meds.value) || 0 }));
    const track = el.querySelector("[data-track]");
    if (track) {
      track.addEventListener("keydown", (ev) => { if (ev.key === "Enter") addTracked(el); });
    }
    const extra = el.querySelector("[data-extra]");
    if (extra) {
      extra.addEventListener("keydown", (ev) => { if (ev.key === "Enter") addExtra(el); });
    }
    for (const btn of el.querySelectorAll("[data-unpack]")) {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.unpack);
        setKit({ extras: Settings.get("assist_kit").extras.filter((e) => e.id !== id) });
      });
    }
    for (const btn of el.querySelectorAll("[data-act]")) {
      btn.addEventListener("click", () => {
        if (btn.dataset.act === "track") addTracked(el);
        if (btn.dataset.act === "pack") addExtra(el);
        if (btn.dataset.act === "retry") { error = null; loadCatalogue(); }
      });
    }
    for (const btn of el.querySelectorAll("[data-drop]")) {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.drop);
        Settings.set("assist_track", Settings.get("assist_track").filter((r) => r.id !== id));
        Assist.paint();
        Panel.refresh("assist", true);
      });
    }
    for (const btn of el.querySelectorAll("[data-up]")) {
      btn.addEventListener("click", () => {
        const list = Settings.get("assist_track").slice();
        const i = list.findIndex((r) => r.id === Number(btn.dataset.up));
        if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
        Settings.set("assist_track", list);
        Assist.paint();
        Panel.refresh("assist", true);
      });
    }
  }

  return { id: "assist", label: "Assist", render };
})();

const News = (() => {
  "use strict";

  const LIST_KEY = "news";
  const SEEN_KEY = "news_seen";
  const EVERY_MS = 15 * 60_000;

  let lastFetch = 0;

  function list() {
    const v = Env.read(LIST_KEY, []);
    return Array.isArray(v) ? v : [];
  }

  function seen() {
    const v = Env.read(SEEN_KEY, []);
    return Array.isArray(v) ? v : [];
  }

  function unread() {
    const ids = seen();
    return list().filter((n) => !ids.includes(n.id));
  }

  function markRead() {
    const ids = list().map((n) => n.id);
    if (ids.every((id) => seen().includes(id))) return;
    Env.write(SEEN_KEY, ids);
    Bus.emit("news");
  }

  async function fetchNow() {
    lastFetch = Date.now();
    try {
      const notices = await Oracle.announcements();
      if (!Array.isArray(notices)) return;
      const before = JSON.stringify(list());
      Env.write(LIST_KEY, notices);
      if (JSON.stringify(notices) !== before) Bus.emit("news");
    } catch (err) {
      Env.log.warn("announcements read failed", err.message);
    }
  }

  function start() {
    fetchNow();
    setInterval(() => {
      if (Env.visible() && Date.now() - lastFetch >= EVERY_MS) fetchNow();
    }, 60_000);
  }

  return { list, unread, markRead, start };
})();

const ViewNews = (() => {
  "use strict";

  const freshNow = new Set();
  const opened = new Set();

  const isLong = (text) => String(text).length > 280 || String(text).split("\n").length > 4;

  function inline(text) {
    return Fmt.esc(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/https?:\/\/[^\s<"']+/g,
        (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`)
      .replace(/\n/g, "<br>");
  }

  function body(text) {
    let html = "", steps = "";
    const STEP = /^\s*\d+[.)]\s+([\s\S]*)$/;
    for (const para of String(text).split(/\n{2,}/)) {

      const lines = para.split("\n");
      const parts = lines.length > 1 && lines.every((l) => STEP.test(l)) ? lines : [para];
      const step = STEP.exec(parts[0]);
      if (step) {
        for (const part of parts) steps += `<li>${inline(STEP.exec(part)[1])}</li>`;
        continue;
      }
      if (steps) { html += `<ol>${steps}</ol>`; steps = ""; }
      html += `<p>${inline(para)}</p>`;
    }
    return html + (steps ? `<ol>${steps}</ol>` : "");
  }

  function render(el) {
    for (const n of News.unread()) freshNow.add(n.id);
    const notices = News.list();
    el.innerHTML = notices.length ? notices.map((n) => `
      <article class="o-notice">
        <h4>${Fmt.esc(n.title)}${freshNow.has(n.id) ? ' <span class="o-new">New</span>' : ""}</h4>
        <div class="o-notice-when">${Fmt.esc(new Date(n.created_at).toLocaleDateString())}</div>
        <div class="o-notice-body${isLong(n.body) && !opened.has(n.id) ? " is-clamped" : ""}">${body(n.body)}</div>
        ${isLong(n.body) ? `<button type="button" class="o-link" data-more="${Fmt.esc(String(n.id))}">${
          opened.has(n.id) ? "Show less" : "Read more"}</button>` : ""}
      </article>`).join("")
      : '<div class="o-empty"><p>No announcements.</p></div>';
    for (const btn of el.querySelectorAll("[data-more]")) {
      btn.addEventListener("click", () => {
        const n = notices.find((x) => String(x.id) === btn.dataset.more);
        if (!n) return;
        if (opened.has(n.id)) opened.delete(n.id); else opened.add(n.id);
        Panel.refresh("news", true);
      });
    }
    News.markRead();
  }

  return { id: "news", label: "News", render, badge: () => News.unread().length };
})();

// Fork : alerte d'export. Prix le plus bas à Torn (item market et bazaars) comparé au prix de rachat
// en direct d'une boutique étrangère ; bandeau sur toutes les pages, notification et bip au-dessus de la marge choisie.
const ExportWatch = (() => {
  "use strict";

  const WATCHES = "fork_export_watch";
  const SHARED = "fork_export_state";
  const POLL_MS = 60_000;
  const BAR_ID = "oracle-fork-export";

  let shopItems = {};

  const list = () => Env.read(WATCHES, []);
  const shared = () => Env.read(SHARED, { at: 0, rows: {}, notified: {}, dismissed: {} });
  const keyOf = (w) => w.id + "|" + w.code;

  function units() {
    const kit = Settings.get("assist_kit") || {};
    const packed = (kit.hosp ? 1 : 0) + (kit.med ? kit.meds || 0 : 0)
      + (kit.extras || []).reduce((s, e) => s + (e.n || 0), 0);
    return Math.max(0, (Settings.get("capacity") || 0) - packed);
  }

  function bazaar(id) {
    return new Promise((resolve) => Env.net({
      method: "GET", url: "https://weav3r.dev/api/marketplace/" + id, timeout: 20_000,
      onload: (res) => {
        try {
          const l = (JSON.parse(res.responseText).listings || [])[0];
          resolve(l ? { price: l.price, qty: l.quantity, where: "Bazaar" } : null);
        } catch (e) { resolve(null); }
      },
      onerror: () => resolve(null),
      ontimeout: () => resolve(null),
    }));
  }

  async function row(w, shops) {
    shops[w.code] = shops[w.code] || Oracle.shop(w.code);
    const [shop, im, bz, meta] = await Promise.all([
      shops[w.code],
      Torn.get("market/" + w.id + "/itemmarket", { params: { limit: 1 } }),
      bazaar(w.id),
      Torn.get("torn/" + w.id + "/items", { ttl: 3_600_000 }),
    ]);
    const it = (shop.items || []).find((i) => Number(i.item_id) === w.id);
    if (!it) return { error: w.name + " is not sold in " + Data.name(w.code) + "." };
    // Un Black Market rachète à son prix du moment, les autres boutiques à 75 % (note de l'onglet Exports)
    const sold = ((((meta.items || [])[0] || {}).value || {}).shops || [])
      .find((s) => s.country === Data.name(w.code));
    const pays = Math.round(it.cost * (sold && /black market/i.test(sold.shop) ? 1 : 0.75));
    const l = (((im || {}).itemmarket || {}).listings || [])[0];
    const offers = [l && { price: l.price, qty: l.amount, where: "Item market" }, bz].filter(Boolean);
    if (!offers.length) return { error: "No " + w.name + " for sale in Torn." };
    const best = offers.reduce((a, b) => (b.price < a.price ? b : a));
    return Object.assign(best, { pays, margin: pays - best.price });
  }

  async function poll(force) {
    const watches = list();
    const s = shared();
    if (!watches.length || !Torn.haveKey() || !Oracle.haveToken()) return paint();
    // Un seul onglet interroge les API par minute ; les autres lisent le résultat partagé
    if (!force && Date.now() - s.at < POLL_MS - 5_000) return paint();
    s.at = Date.now();
    Env.write(SHARED, s);
    const shops = {};
    const rows = {};
    for (const w of watches) {
      try { rows[keyOf(w)] = await row(w, shops); }
      catch (err) { rows[keyOf(w)] = { error: err.message }; }
    }
    Env.write(SHARED, Object.assign(shared(), { at: Date.now(), rows }));
    paint();
  }

  function hits() {
    const rows = shared().rows;
    return list().filter((w) => { const r = rows[keyOf(w)]; return r && !r.error && r.margin >= w.min; });
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25, 0.5].forEach((at) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 988;
        gain.gain.value = 0.2;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + at);
        osc.stop(ctx.currentTime + at + 0.15);
      });
      setTimeout(() => ctx.close(), 1500);
    } catch (e) {  }
  }

  function line(w, r, n) {
    return `${w.name}: ${Fmt.price(r.price)} (${r.where}, ${Fmt.count(r.qty)} for sale), `
      + `${Data.name(w.code)} pays ${Fmt.price(r.pays)}. +${Fmt.price(r.margin)} each, `
      + `${Fmt.money(r.margin * Math.min(n, r.qty))} for ${Fmt.count(Math.min(n, r.qty))}`;
  }

  function paint() {
    const s = shared();
    const n = units();
    const live = hits().filter((w) => s.dismissed[keyOf(w)] !== s.rows[keyOf(w)].price);
    let changed = false;
    for (const w of live) {
      const r = s.rows[keyOf(w)];
      if (s.notified[keyOf(w)] === r.price) continue;
      s.notified[keyOf(w)] = r.price;
      changed = true;
      Env.toast("Export deal", line(w, r, n));
      beep();
    }
    for (const k of Object.keys(s.notified)) {
      if (!live.some((w) => keyOf(w) === k)) { delete s.notified[k]; changed = true; }
    }
    if (changed) Env.write(SHARED, s);

    let bar = document.getElementById(BAR_ID);
    if (!live.length) { if (bar) bar.remove(); }
    else {
      if (!bar) {
        bar = document.createElement("div");
        bar.id = BAR_ID;
        bar.style.cssText = "position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483647;"
          + "max-width:min(96vw,720px);padding:8px 36px 8px 12px;background:#b71c1c;color:#fff;"
          + "font:bold 13px/1.4 Arial,sans-serif;border-radius:0 0 6px 6px;box-shadow:0 2px 8px #0008";
        bar.addEventListener("click", (ev) => {
          if (!ev.target.matches("[data-close]")) return;
          const now = shared();
          for (const w of hits()) now.dismissed[keyOf(w)] = now.rows[keyOf(w)].price;
          Env.write(SHARED, now);
          paint();
        });
        document.body.appendChild(bar);
      }
      bar.innerHTML = live.map((w) => `<div>${Fmt.esc(line(w, s.rows[keyOf(w)], n))}</div>`).join("")
        + '<button type="button" data-close title="Hide until the price changes" style="position:absolute;'
        + 'top:4px;right:6px;background:none;border:0;color:#fff;font-size:18px;cursor:pointer">&times;</button>';
    }
    Panel.refresh("exportwatch");
  }

  function start() {
    poll();
    setInterval(poll, POLL_MS);
    // Les autres onglets publient leurs relevés toutes les minutes : repeindre souvent suffit
    setInterval(paint, 10_000);
  }

  async function loadShop(code) {
    if (shopItems[code]) return;
    shopItems[code] = [];
    try {
      const shop = await Oracle.shop(code);
      shopItems[code] = (shop.items || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } catch (e) { delete shopItems[code]; }
    Panel.refresh("exportwatch");
  }

  const form = { code: "can" };

  function render(el) {
    if (!Torn.haveKey() || !Oracle.haveToken()) {
      el.innerHTML = '<div class="o-empty">Needs your Torn key and a Torn Oracle account.</div>';
      return;
    }
    loadShop(form.code);
    const rows = shared().rows;
    const kit = Settings.get("capacity") - units();
    const lines = list().map((w) => {
      const r = rows[keyOf(w)];
      const cells = !r ? '<td colspan="3" class="muted">Waiting…</td>'
        : r.error ? `<td colspan="3" class="muted">${Fmt.esc(r.error)}</td>`
        : `<td class="num">${Fmt.esc(Fmt.price(r.price))}<span class="o-sub">${Fmt.esc(r.where)}</span></td>
           <td class="num">${Fmt.esc(Fmt.price(r.pays))}</td>
           <td class="num"><span class="${r.margin >= w.min ? "go" : "muted"}">${r.margin >= 0 ? "+" : ""}${
             Fmt.esc(Fmt.price(r.margin))}</span><span class="o-sub">${Fmt.esc(Fmt.money(r.margin * units()))}</span></td>`;
      return `<tr><td>${Fmt.esc(w.name)}<span class="o-sub">${Fmt.esc(Data.name(w.code))}</span></td>${cells}
        <td class="num">${Fmt.esc(Fmt.price(w.min))}</td>
        <td><button type="button" class="o-link" data-del="${Fmt.esc(keyOf(w))}" title="Stop watching">&times;</button></td></tr>`;
    }).join("");
    const items = shopItems[form.code] || [];
    el.innerHTML = `
      ${lines ? `<div class="o-scroll"><table><thead><tr><th>Item</th><th class="num">Torn now</th>
        <th class="num">Shop pays</th><th class="num">Margin</th><th class="num">Alert at</th><th></th></tr></thead>
        <tbody>${lines}</tbody></table></div>` : '<div class="o-empty">No export watch yet.</div>'}
      <div class="o-note">Torn now: cheapest of the item market and bazaars (weav3r.dev). Margin total for
        ${Fmt.count(units())} items: suitcase ${Fmt.count(Settings.get("capacity"))} minus ${Fmt.count(kit)} in the trip kit.
        Checked every minute while a Torn page is open.</div>
      <div class="o-group"><h4>New export watch</h4>
        <div class="o-field"><span class="o-field-label">Country</span>
          <select data-ew="code">${Data.list().map((c) => `<option value="${c.code}"${
            c.code === form.code ? " selected" : ""}>${Fmt.esc(c.name)}</option>`).join("")}</select></div>
        <div class="o-field"><span class="o-field-label">Item</span>
          <select data-ew="id">${items.map((i) => `<option value="${i.item_id}">${Fmt.esc(i.name)}</option>`).join("")}</select></div>
        <div class="o-field"><span class="o-field-label">Alert from margin (each)</span>
          <input type="number" data-ew="min" min="0" step="100" placeholder="5000"></div>
        <button type="button" class="o-btn" data-ew-add>Add</button>
      </div>`;
    el.querySelector('[data-ew="code"]').addEventListener("change", (ev) => {
      form.code = ev.target.value;
      Panel.refresh("exportwatch", true);
    });
    el.querySelector("[data-ew-add]").addEventListener("click", () => {
      const sel = el.querySelector('[data-ew="id"]');
      const min = Number(el.querySelector('[data-ew="min"]').value);
      if (!sel.value || !(min >= 0)) return;
      const w = { id: Number(sel.value), name: sel.selectedOptions[0].textContent, code: form.code, min };
      Env.write(WATCHES, list().filter((x) => keyOf(x) !== keyOf(w)).concat(w));
      poll(true);
    });
    for (const b of el.querySelectorAll("[data-del]")) {
      b.addEventListener("click", () => {
        Env.write(WATCHES, list().filter((x) => keyOf(x) !== b.dataset.del));
        paint();
      });
    }
  }

  return {
    start,
    view: { id: "exportwatch", label: "Export watch", render, badge: () => hits().length || null,
            refresh: () => poll(), refreshEvery: POLL_MS },
  };
})();

Env.ready().then(function boot() {
  "use strict";

  Settings.load();
  ExportWatch.start();
  if (!/sid=travel/.test(location.href)) return;
  Trip.load();
  Alerts.load();
  Style.install();

  Panel.register(ViewToday);
  Panel.register(ViewShops);
  Panel.register(ViewExports);
  Panel.register(ExportWatch.view);
  Panel.register(ViewItems);
  Panel.register(ViewWatches);
  Panel.register(ViewMuseum);
  Panel.register(ViewAssist);
  Panel.register(ViewNews);
  Panel.register(ViewSettings);

  const panel = Panel.build();
  let mode = Page.mode();

  function placePanel() {
    Assist.mount();
    if (mode === "other") {
      if (panel.parentNode) panel.parentNode.removeChild(panel);
      return;
    }
    Page.place(panel, mode);
  }

  function applyMode(next) {
    if (next === mode) return;
    mode = next;
    placePanel();
    Panel.refresh();
  }

  placePanel();
  Panel.startClock();
  Panel.paintHead();
  Panel.badges();

  let readForm = () => {};
  Page.watch((next) => { applyMode(next); placePanel(); readForm(); });
  Page.followLink();

  new MutationObserver(() => { Panel.applyTheme(); Assist.paint(); })
    .observe(document.body, { attributes: true, attributeFilter: ["class"] });

  window.addEventListener("hashchange", Page.followLink);

  let inventoryReads = 0;
  readForm = Page.onFormChange((name, value) => {
    if (!Settings.get("follow_page")) return;
    if (name === "travelType") {
      Settings.set("travel_type", value);
      Panel.refresh();
    }
    if (name === "inventory") {

      const read = ++inventoryReads;
      Assist.keptPacked(value.items).then((kept) => {
        if (kept === null || read !== inventoryReads) return;
        const free = Math.max(1, value.slots - kept);
        if (Settings.get("capacity") !== free) { Settings.set("capacity", free); Panel.refresh(); }
      });
    }
    if (name === "destination") {

      ViewShops.follow(value);
      Panel.refresh("shops");
    }
  });

  Tracker.onEvents((result) => {

    try { Alerts.onTracked(result); } catch (e) { Env.log.error("alerts failed", e); }
    Assist.onObservation(result.observation);

    Escort.sync();
    PlanSync.changed();

    for (const ev of result.events || []) {
      if (ev.kind === "home") {
        Plan.replanTail("a run finished");
      } else if (ev.kind === "departed" && ev.offPlan) {

        Env.log.info("Off-plan flight noted. Re-plan happens when you are home.");
      }
    }

    Panel.applyTheme();
    Panel.paintHead();
    Panel.refresh();
  });

  Bus.on("plan:start", () => Panel.flash(null, null, "today"));
  Bus.on("plan:stage", () => Panel.refresh("today"));

  Bus.on("plan:done", (res) => {
    PlanSync.changed();
    Panel.flash(res && res.ok === false ? res.message : null, "warn", "today");
    Panel.paintHead(); Panel.refresh(); Panel.badges();
  });

  Bus.on("plan:synced", (kind) => {
    if (kind === "new") Alerts.forgetOtherPlans();
    else if (kind === "reshaped") Alerts.forgetFrom(Trip.get().preserved);
    else if (kind === "stopped") Alerts.reset();
    Escort.sync();
    Panel.paintHead(); Panel.refresh(); Panel.badges();
  });
  Bus.on("escort", () => Panel.refresh("settings"));
  Bus.on("sync", () => Panel.refresh("settings"));
  Bus.on("oracle:update", () => Panel.showUpdate());
  Bus.on("news", () => { Panel.paintNews(); Panel.refresh("news"); });

  Bus.on("alert", () => { Panel.paintHead(); Panel.refresh("today"); });

  Settings.onChange((name) => {
    SettingsSync.changed(name);

    if (name === "oracle_token") Escort.forget();

    if (name === "escort_on" || name === "post_plan" || name === "oracle_token") {
      Escort.sync({ pressed: true });
    }
    if (name === "torn_key") Tracker.poke();
    if (name === "compact" || name === "clock_24h" || name === "minimal") Panel.applyTheme();

    if (name === "oracle_token") {
      Account.forget();
      Account.load(true);
      SettingsSync.forget();
      SettingsSync.pull(true);
      PlanSync.forget();
      PlanSync.pull();
    }
    if (name === "torn_key" || name === "oracle_token") Panel.paintHead();
  });

  Bus.on("account", () => { Panel.refresh(); Panel.badges(); });

  Bus.on("settings:remote", (names) => {
    if (names.includes("escort_on") || names.includes("post_plan")) Escort.sync({ pressed: true });
    Panel.applyTheme();
    Panel.refresh();
    Assist.paint();
  });

  if (Oracle.haveToken()) {
    Account.load();
    SettingsSync.pull(true);
    PlanSync.pull();
  }
  setInterval(() => { if (Env.visible()) SettingsSync.pull(false); }, 60_000);
  setInterval(() => { if (Env.visible()) PlanSync.pull(); }, 120_000);

  Tracker.start();
  News.start();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      Tracker.poke();
      SettingsSync.returned();
      PlanSync.pull();
      Panel.applyTheme();
      Panel.refresh();

      Panel.fetchData(false);
    }
  });
  Env.log.info("Torn Oracle v2 ready on " + mode + (Env.isPDA ? " (TornPDA)" : ""));
});

})();
