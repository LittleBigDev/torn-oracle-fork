# Torn Oracle: Travel - fork Workaround

*[Version française](#version-francaise)*

Fork of **Torn Oracle: Travel** (author: Ruinbringer, license GPL-3.0-only, [Greasy Fork](https://greasyfork.org/en/scripts/590310-torn-oracle-travel)): wherever Torn Oracle shows a profit (plans, plan purchases, Shops, Watches, Museum), each item is sold through its best channel.

- Wardogs traders: market value × the category rate (98, 95 or 90 %)
- item market: 85 % of market value
- city: the shop's buyback price

The Shops tab has a **Sell** column showing that channel (Traders, Item market, or the name of the shop that buys it back). The "Sell to" and "Sell under market" settings no longer have any effect.

## Export alert

**Export watch** tab: one item, one country, a minimum margin per unit. Every minute, while a Torn page is open, the fork compares the lowest price in Torn (item market and bazaars, the latter through weav3r.dev) with the current buyback price of the foreign shop (a Black Market buys back at its own price, other shops at 75 %). Above the margin: a banner at the top of any Torn page, a notification and a beep. The total margin is based on your suitcase size minus the trip kit (self-hosp item, med-out items, other items). The **Notif.** column turns the banner, notification and beep on or off for each watch; the box in its header checks or unchecks them all (checked only when every watch is). The **Auto add** button, above the table, watches the export advised for the plan's next run (Plan tab, "Take N x item"), with a $5,000 margin. Click a value in the **Alert at** column to change it: Enter or the ✓ button saves it, the watch keeps its place in the table. Code: `export_watch.js`, injected into the fork at build time.

## Assist and travel agency

**Assist** tab: when the self-hosp or a med-out item can't be packed because none is left in your inventory, the error message links to that item on the item market.

Travel agency, **Open bazaar** button left of TRAVEL: shown only when you own a bazaar that has items in it but is closed (read from Torn's bazaar page). One click opens it, with the same single request as Torn's own button. Code: `bazaar_open.js`, injected into the fork at build time.

**Assist** tab, **Fill** button: when an item still to pack needs at least as many units as you have free slots, the button becomes "Fill <item> (N slots)" and fills every free slot in one click, with the same single request as Torn's own FILL button.

## Tracked items set at take-off

When a flight to another country starts, the **Tracked items** list of the **Assist** tab is replaced by the destination's profitable items, best margin first (10 at most). On a planned flight with a self-hosp item set on the Assist tab, the list is simply emptied: Assist then waits for the plan's item. The **Auto track** button under the list does the same at any time (country of the current flight, else the destination selected on the page, else the plan's). A warning appears under the button when your cash can't buy a full bag of a tracked item.

## Presets

Torn Oracle has its own presets since 2.6.9 (**Settings** tab, **Presets** section). The fork's former presets are copied into them once, on the first start, if you have no native preset yet.

## Installation

With Violentmonkey or Tampermonkey, open [torn-oracle-fork.user.js](https://raw.githubusercontent.com/LittleBigDev/torn-oracle-fork/main/torn-oracle-fork.user.js) and confirm. Updates then arrive automatically.

The fork has its own storage, separate from the original: on first install, set everything up again (API key, Oracle account, capacity, countries...).

## License

GPL-3.0-only, like the original (`LICENSE`).

---

<a id="version-francaise"></a>

## Version française

Fork de **Torn Oracle: Travel** (auteur : Ruinbringer, licence GPL-3.0-only, [Greasy Fork](https://greasyfork.org/en/scripts/590310-torn-oracle-travel)) : partout où Torn Oracle affiche un profit (plans, achats du plan, Shops, Watches, Museum), la vente se fait au meilleur canal de chaque objet.

- traders Wardogs : market value × taux de la catégorie (98, 95 ou 90 %)
- item market : 85 % du market value
- ville : prix de rachat de la boutique

L'onglet Shops a une colonne **Sell** qui indique ce canal (Traders, Item market ou le nom de la boutique qui rachète). Les réglages « Sell to » et « Sell under market » n'ont plus d'effet.

### Alerte d'export

Onglet **Export watch** : un objet, un pays, une marge minimale par unité. Toutes les minutes, tant qu'une page de Torn est ouverte, le fork compare le prix le plus bas à Torn (item market et bazaars, ces derniers via weav3r.dev) au prix de rachat du moment de la boutique étrangère (un Black Market rachète à son prix, les autres boutiques à 75 %). Au-dessus de la marge : bandeau en haut de n'importe quelle page de Torn, notification et bip. La marge totale porte sur la taille de valise moins le trip kit (objet de self-hosp, objets de med-out, autres objets). La colonne **Notif.** active ou coupe le bandeau, la notification et le bip pour chaque surveillance ; la case de son en-tête les coche ou décoche toutes (cochée seulement quand toutes le sont). Le bouton **Auto add**, au-dessus du tableau, surveille l'export conseillé pour la prochaine étape du plan (onglet Plan, « Take N x objet »), avec une marge de 5 000 $. Un clic sur une valeur de la colonne **Alert at** permet de la modifier : Entrée ou le bouton ✓ l'enregistre, la ligne garde sa place dans le tableau. Code : `export_watch.js`, injecté dans le fork à la génération.

### Assist et agence de voyage

Onglet **Assist** : quand l'objet de self-hosp ou de med-out ne peut pas être rangé dans la valise faute d'en avoir dans l'inventaire, le message d'erreur donne le lien vers cet objet sur l'item market.

Agence de voyage, bouton **Open bazaar** à gauche de TRAVEL : affiché seulement si tu as un bazaar avec des objets et qu'il est fermé (lu sur la page du bazaar de Torn). Un clic l'ouvre, avec la même requête unique que le bouton de Torn. Code : `bazaar_open.js`, injecté dans le fork à la génération.

Onglet **Assist**, bouton **Fill** : quand il reste à ranger au moins autant d'unités d'un objet que de places libres, le bouton devient « Fill <objet> (N slots) » et remplit toutes les places en un clic, avec la même requête unique que le bouton FILL de Torn.

### Tracked items réglés au décollage

Au départ d'un vol vers l'étranger, la liste **Tracked items** de l'onglet **Assist** est remplacée par les objets rentables de la destination, meilleure marge d'abord (10 au maximum). Sur un vol du plan avec un objet de self-hosp réglé dans Assist, la liste est simplement vidée : Assist attend alors l'objet du plan. Le bouton **Auto track**, sous le titre de la liste, fait la même chose à tout moment (pays du vol en cours, sinon destination choisie sur la page, sinon celle du plan). Un avertissement s'affiche sous le bouton si ton argent en main ne permet pas d'acheter une valise pleine d'un objet suivi.

### Presets

Torn Oracle a ses propres presets depuis la 2.6.9 (onglet **Settings**, section **Presets**). Les anciens presets du fork y sont recopiés une fois, au premier lancement, s'il n'y a encore aucun preset natif.

### Installation

Avec Violentmonkey ou Tampermonkey, ouvrir [torn-oracle-fork.user.js](https://raw.githubusercontent.com/LittleBigDev/torn-oracle-fork/main/torn-oracle-fork.user.js) et confirmer. Les mises à jour arrivent ensuite automatiquement.

Le fork a son propre stockage, distinct de l'original : à la première installation, refaire les réglages (clé API, compte Oracle, capacité, pays…).

### Licence

GPL-3.0-only, comme l'original (`LICENSE`).
