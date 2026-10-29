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

  // « Suitcase size » suit les places libres de l'agence quand la valise est déjà chargée :
  // on garde le plus grand vu, c'est-à-dire la valise vide
  function suitcase() {
    const size = Math.max(Env.read("fork_suitcase", 0), Settings.get("capacity") || 0);
    if (size !== Env.read("fork_suitcase", 0)) Env.write("fork_suitcase", size);
    return size;
  }

  function units() {
    const kit = Settings.get("assist_kit") || {};
    const packed = (kit.hosp ? 1 : 0) + (kit.med ? kit.meds || 0 : 0)
      + (kit.extras || []).reduce((s, e) => s + (e.n || 0), 0);
    return Math.max(0, suitcase() - packed);
  }

  function bazaar(id) {
    return new Promise((resolve) => Env.net({
      method: "GET", url: "https://weav3r.dev/api/marketplace/" + id, timeout: 20_000,
      onload: (res) => {
        try {
          const l = (JSON.parse(res.responseText).listings || [])[0];
          // tt-item-id : TornTools surligne l'objet dans le bazaar
          resolve(l ? { price: l.price, qty: l.quantity, where: "Bazaar",
                        url: "https://www.torn.com/bazaar.php?userId=" + l.player_id + "&tt-item-id=" + id } : null);
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
    const offers = [l && { price: l.price, qty: l.amount, where: "Item market",
                           url: "https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=" + w.id },
                    bz].filter(Boolean);
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
    return `${w.name}: ${Fmt.price(r.price)} (${r.where}, ${Fmt.count(r.qty)} for sale). `
      + `+${Fmt.price(r.margin)} each in ${Data.name(w.code)}.`;
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
      Env.toast("Export deal", line(w, r, n), () => { location.href = r.url; });
      beep();
    }
    for (const k of Object.keys(s.notified)) {
      if (!live.some((w) => keyOf(w) === k)) { delete s.notified[k]; changed = true; }
    }
    if (changed) Env.write(SHARED, s);

    // Une seule offre dans le bandeau : celle qui rapporte le plus sur un voyage
    const total = ([, r]) => r.margin * Math.min(n, r.qty);
    const shown = live.map((w) => [w, s.rows[keyOf(w)]])
      .sort((a, b) => total(b) - total(a)).slice(0, 1);
    let bar = document.getElementById(BAR_ID);
    if (!shown.length) { if (bar) bar.remove(); }
    else {
      if (!bar) {
        style();
        bar = document.createElement("div");
        bar.id = BAR_ID;
        bar.addEventListener("click", (ev) => {
          if (!ev.target.matches("[data-close]")) return;
          const now = shared();
          for (const w of hits()) now.dismissed[keyOf(w)] = now.rows[keyOf(w)].price;
          Env.write(SHARED, now);
          paint();
        });
      }
      // Sous le bouton d'Oracle en voyage (empilé quand on défile), sinon en tête du contenu ;
      // replacé si Torn redessine la page
      const assist = document.getElementById("oracle-assist");
      const root = document.getElementById("travel-root");
      const wrap = document.querySelector(".content-wrapper");
      if (assist && assist.parentNode && assist.isConnected) {
        if (assist.nextSibling !== bar) assist.parentNode.insertBefore(bar, assist.nextSibling);
      } else if (root && root.parentNode) {
        if (bar.nextSibling !== root) root.parentNode.insertBefore(bar, root);
      } else if (wrap) {
        if (wrap.firstChild !== bar) wrap.insertBefore(bar, wrap.firstChild);
      } else if (!bar.isConnected) document.body.prepend(bar);
      bar.style.top = assist && assist.isConnected ? assist.offsetHeight + 4 + "px" : "0";
      bar.classList.toggle("o-dark", Page.darkMode());
      const [w, r] = shown[0];
      bar.innerHTML = `<div class="oa-line"><span class="oa-brand">Torn Oracle</span>
          <span class="oa-note">Export deal</span>
          <button type="button" class="oa-x" data-close title="Hide until the price changes">&times;</button></div>
        <a class="oa-go" href="${Fmt.esc(r.url)}">${Fmt.esc(line(w, r, n))}</a>`;
    }
    Panel.refresh("exportwatch");
  }

  // Repris du bouton d'Oracle (#oracle-assist), dont le style n'est chargé que sur la page de voyage
  function style() {
    if (document.getElementById(BAR_ID + "-css")) return;
    const css = document.createElement("style");
    css.id = BAR_ID + "-css";
    css.textContent = `
#${BAR_ID} { --oa-bg: #fff; --oa-line: #dde3e9; --oa-dim: #4a5763; --oa-accent: #0d9488;
  position: sticky; top: 0; z-index: 50; box-sizing: border-box; width: 100%; margin: 0 0 8px;
  padding: 8px 10px; border: 1px solid var(--oa-line); border-radius: 10px; background: var(--oa-bg);
  color: #10161c; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
#${BAR_ID}.o-dark { --oa-bg: #171d24; --oa-line: #2c3742; --oa-dim: #b3c0cd; --oa-accent: #2dd4bf; color: #e7edf3; }
#${BAR_ID} .oa-line { display: flex; gap: 8px; align-items: baseline; margin-bottom: 6px; }
#${BAR_ID} .oa-brand { font-weight: 700; font-size: 11px; color: var(--oa-accent); }
#${BAR_ID} .oa-note { font-size: 12px; color: var(--oa-dim); flex: 1; }
#${BAR_ID} .oa-x { background: none; border: 0; color: var(--oa-dim); font-size: 18px; line-height: 1; cursor: pointer; }
#${BAR_ID} a.oa-go { display: flex; align-items: center; justify-content: center; box-sizing: border-box;
  width: 100%; min-height: 44px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--oa-accent);
  background: var(--oa-accent); color: #fff; font-size: 15px; font-weight: 700; text-align: center;
  text-decoration: none; }`;
    document.head.appendChild(css);
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
    const kit = suitcase() - units();
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
        ${Fmt.count(units())} items: suitcase ${Fmt.count(suitcase())} minus ${Fmt.count(kit)} in the trip kit.
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

