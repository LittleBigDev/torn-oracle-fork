# Torn Oracle: Travel - fork Workaround

*[Version française](#version-francaise)*

Fork of **Torn Oracle: Travel** (author: Ruinbringer, license GPL-3.0-only, [Greasy Fork](https://greasyfork.org/en/scripts/590310-torn-oracle-travel)): wherever Torn Oracle shows a profit (plans, plan purchases, Shops, Watches, Museum), each item is sold through its best channel.

- Wardogs traders: market value × the category rate (98, 95 or 90 %)
- item market: 85 % of market value
- city: the shop's buyback price

The Shops tab has a **Sell** column showing that channel (Traders, Item market, or the name of the shop that buys it back). The "Sell to" and "Sell under market" settings no longer have any effect.

## Export alert

**Export watch** tab: one item, one country, a minimum margin per unit. Every minute, while a Torn page is open, the fork compares the lowest price in Torn (item market and bazaars, the latter through weav3r.dev) with the current buyback price of the foreign shop (a Black Market buys back at its own price, other shops at 75 %). Above the margin: a banner at the top of any Torn page, a notification and a beep. The total margin is based on your suitcase size minus the trip kit (self-hosp item, med-out items, other items). Code: `export_watch.js`, injected into the fork at build time.

## Items to sell on arrival

**Assist** tab, **Packed items to sell** list: items from "Other items to pack" to sell as soon as you land, before you self-hosp. While one of them is still in your suitcase, the button stays hidden during the flight, then offers "Sell <item>" once you land, one item after another in list order. Once everything is sold, the button goes back to its normal behavior (self-hosp, restock, buy, fly home).

## Tracked items set at take-off

When a flight to another country starts, the **Tracked items** list of the **Assist** tab is replaced by the destination's profitable items, best margin first (10 at most). On a planned flight with a self-hosp item set on the Assist tab, the list is simply emptied: Assist then waits for the plan's item. The **Auto track** button under the list does the same at any time (country of the current flight, else the destination selected on the page, else the plan's). A warning appears under the button when your cash can't buy a full bag of a tracked item.

## Presets

**Settings** tab, **Presets** section: save your trip, buying, forecast and Assist settings (kit, tracked items, items to sell) under a name, then load them in one click. Your key, account, alerts, display and suitcase size are not included. With the active preset's name in the box, the button saves your changes to it; another name saves a new preset ("Replace" if that name already exists). "(modified)" shows when your settings no longer match the active preset. Presets are stored in this browser only.

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

Onglet **Export watch** : un objet, un pays, une marge minimale par unité. Toutes les minutes, tant qu'une page de Torn est ouverte, le fork compare le prix le plus bas à Torn (item market et bazaars, ces derniers via weav3r.dev) au prix de rachat du moment de la boutique étrangère (un Black Market rachète à son prix, les autres boutiques à 75 %). Au-dessus de la marge : bandeau en haut de n'importe quelle page de Torn, notification et bip. La marge totale porte sur la taille de valise moins le trip kit (objet de self-hosp, objets de med-out, autres objets). Code : `export_watch.js`, injecté dans le fork à la génération.

### Objets à vendre à l'arrivée

Onglet **Assist**, liste **Packed items to sell** : des objets d'« Other items to pack » à vendre dès l'arrivée, avant le self-hosp. Tant qu'il en reste un dans la valise, le bouton ne s'affiche pas pendant le vol, puis propose « Sell <objet> » à l'arrivée, un objet après l'autre dans l'ordre de la liste. Une fois tout vendu, le bouton reprend son comportement normal (self-hosp, restock, achat, retour).

### Tracked items réglés au décollage

Au départ d'un vol vers l'étranger, la liste **Tracked items** de l'onglet **Assist** est remplacée par les objets rentables de la destination, meilleure marge d'abord (10 au maximum). Sur un vol du plan avec un objet de self-hosp réglé dans Assist, la liste est simplement vidée : Assist attend alors l'objet du plan. Le bouton **Auto track**, sous le titre de la liste, fait la même chose à tout moment (pays du vol en cours, sinon destination choisie sur la page, sinon celle du plan). Un avertissement s'affiche sous le bouton si ton argent en main ne permet pas d'acheter une valise pleine d'un objet suivi.

### Presets

Onglet **Settings**, section **Presets** : sauvegarde sous un nom les réglages de voyage, d'achat, de prévision et d'Assist (kit, objets suivis, objets à vendre), rechargés ensuite en un clic. Clé, compte, alertes, affichage et taille de valise n'en font pas partie. Avec le nom du preset actif dans le champ, le bouton enregistre ses modifications ; un autre nom crée un nouveau preset (« Replace » si ce nom existe déjà). « (modified) » s'affiche quand les réglages ne correspondent plus au preset actif. Les presets restent dans ce navigateur.

### Installation

Avec Violentmonkey ou Tampermonkey, ouvrir [torn-oracle-fork.user.js](https://raw.githubusercontent.com/LittleBigDev/torn-oracle-fork/main/torn-oracle-fork.user.js) et confirmer. Les mises à jour arrivent ensuite automatiquement.

Le fork a son propre stockage, distinct de l'original : à la première installation, refaire les réglages (clé API, compte Oracle, capacité, pays…).

### Licence

GPL-3.0-only, comme l'original (`LICENSE`).
