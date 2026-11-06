// Fork : presets. Réglages de voyage, d'achat, de prévision et d'Assist sauvés sous un nom, rechargés en un clic.
// Section « Presets » de l'onglet Settings ; stockage local du fork (et stockage durable de Torn PDA).
const Presets = (() => {
  "use strict";

  const KEY = "fork_presets";
  const GROUPS = ["trips", "buying", "forecast", "assist"];
  // Lus par le script dans l'agence de voyage : un preset ne doit pas les figer
  const SKIP = ["capacity", "extra_slots", "extra_type"];
  const NAME_MAX = 40;
  const ARM_MS = 4000;

  let draft = null;   // nom en cours de saisie (null : nom du preset actif)
  let picked = null;  // preset choisi dans « My presets »
  let armed = null;   // preset dont la suppression attend confirmation
  let armTimer = null;

  const rows = () => Settings.SCHEMA.filter((r) => GROUPS.includes(r.group) && !SKIP.includes(r.name));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Fmt.esc n'échappe pas les guillemets : indispensable dans un attribut HTML
  const attr = (v) => Fmt.esc(v).replace(/"/g, "&quot;");

  function state() {
    const live = Env.read(KEY, null);
    const kept = Env.durable(KEY);
    const s = (kept && kept.at > ((live && live.at) || 0)) ? kept : live;
    return s && s.presets ? s : { at: 0, presets: {}, active: null };
  }

  function store(s) {
    s.at = Date.now();
    Env.write(KEY, s);
    Env.keep(KEY, s);
  }

  function snapshot() {
    const out = {};
    for (const r of rows()) out[r.name] = JSON.parse(JSON.stringify(Settings.get(r.name)));
    return out;
  }

  // Un réglage absent du preset (ajouté depuis) ne compte pas comme une modification
  function modified(p) {
    return rows().some((r) => Object.prototype.hasOwnProperty.call(p, r.name) && !same(p[r.name], Settings.get(r.name)));
  }

  function mode(name, s) {
    if (!name) return { act: "new", label: "Save as new", off: true };
    if (name === s.active) {
      const changed = modified(s.presets[name] || {});
      return { act: "update", label: changed ? "Save changes" : "No changes", off: !changed };
    }
    if (s.presets[name]) return { act: "replace", label: "Replace", off: false };
    return { act: "new", label: "Save as new", off: false };
  }

  function block(section) {
    const s = state();
    const names = Object.keys(s.presets).sort((a, b) => a.localeCompare(b));
    if (s.active && !s.presets[s.active]) s.active = null;
    if (!names.includes(picked)) picked = s.active || names[0] || null;
    const name = draft === null ? (s.active || "") : draft;
    const m = mode(name.trim(), s);
    const active = s.active
      ? `<div class="o-row"><span class="o-row-text"><span class="o-row-label">Active: ${Fmt.esc(s.active)}${
          modified(s.presets[s.active]) ? " (modified)" : ""}</span></span></div>`
      : "";
    const list = names.length
      ? `<span class="o-row-ctl">
          <select data-preset-pick aria-label="My presets">${names.map((n) =>
            `<option value="${attr(n)}"${n === picked ? " selected" : ""}>${Fmt.esc(n)}</option>`).join("")}</select>
          <button type="button" class="o-btn" data-preset="load">Load</button>
          <button type="button" class="o-btn" data-preset="delete">${armed === picked ? "Confirm delete" : "Delete"}</button>
        </span>`
      : `<span class="o-row-help">No presets yet.</span>`;
    return section("presets", "Presets", "Save your plan, buying, forecast and Assist settings under a name", `
      ${active}
      <div class="o-row"><span class="o-row-text"><span class="o-row-label">Save preset</span></span>
        <span class="o-row-ctl">
          <input type="text" data-preset-name maxlength="${NAME_MAX}" value="${attr(name)}"
            placeholder="Preset name" aria-label="Preset name">
          <button type="button" class="o-btn" data-preset="save"${m.off ? " disabled" : ""}>${m.label}</button>
        </span></div>
      <div class="o-row"><span class="o-row-text"><span class="o-row-label">My presets</span></span>${list}</div>`);
  }

  function wire(el, tell) {
    const input = el.querySelector("[data-preset-name]");
    const save = el.querySelector('[data-preset="save"]');
    if (input && save) {
      input.addEventListener("input", () => {
        draft = input.value;
        const m = mode(draft.trim(), state());
        save.textContent = m.label;
        save.disabled = m.off;
      });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !save.disabled) save.click(); });
    }
    const pick = el.querySelector("[data-preset-pick]");
    if (pick) pick.addEventListener("change", () => { picked = pick.value; disarm(); Panel.refresh("settings"); });
    for (const btn of el.querySelectorAll("[data-preset]")) {
      btn.addEventListener("click", () => act(btn.dataset.preset, input, tell));
    }
  }

  function disarm() {
    clearTimeout(armTimer);
    armed = null;
  }

  function act(what, input, tell) {
    const s = state();
    if (what === "save") {
      const name = (input.value || "").trim().slice(0, NAME_MAX);
      const m = mode(name, s);
      if (m.off) return;
      s.presets[name] = snapshot();
      s.active = name;
      store(s);
      draft = null;
      picked = name;
      tell(m.act === "update" ? `Saved changes to "${name}".`
        : m.act === "replace" ? `Replaced "${name}".` : `Saved "${name}".`);
    } else if (what === "load") {
      const p = s.presets[picked];
      if (!p) return;
      let applied = 0;
      for (const r of rows()) {
        if (Object.prototype.hasOwnProperty.call(p, r.name) && !same(p[r.name], Settings.get(r.name))
            && Settings.set(r.name, p[r.name])) applied += 1;
      }
      s.active = picked;
      store(s);
      draft = null;
      Panel.applyTheme();
      Panel.badges();
      tell(`Loaded "${picked}": ${Fmt.plural(applied, "setting")} changed.`
        + (applied && Trip.get().active ? " Re-plan to use them." : ""));
    } else if (what === "delete") {
      if (armed !== picked) {
        armed = picked;
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { armed = null; Panel.refresh("settings"); }, ARM_MS);
      } else {
        disarm();
        delete s.presets[picked];
        if (s.active === picked) { s.active = null; draft = null; }
        store(s);
        tell(`Deleted "${picked}".`);
        picked = null;
      }
    }
    Panel.refresh("settings");
  }

  return { block, wire };
})();

