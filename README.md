# Torn Oracle: Travel - fork Workaround

Fork de **Torn Oracle: Travel** (auteur : Ruinbringer, licence GPL-3.0-only, [Greasy Fork](https://greasyfork.org/en/scripts/590310-torn-oracle-travel)) : partout où Torn Oracle affiche un profit (plans, achats du plan, Shops, Watches, Museum), la vente se fait au meilleur canal de chaque objet.

- traders Wardogs : market value × taux de la catégorie (98, 95 ou 90 %)
- item market : 85 % du market value
- ville : prix de rachat de la boutique

L'onglet Shops a une colonne **Sell** qui indique ce canal (Traders, Item market ou le nom de la boutique qui rachète). Les réglages « Sell to » et « Sell under market » n'ont plus d'effet.

## Installation

Avec Violentmonkey ou Tampermonkey, ouvrir [torn-oracle-fork.user.js](https://raw.githubusercontent.com/LittleBigDev/torn-oracle-fork/main/torn-oracle-fork.user.js) et confirmer. Les mises à jour arrivent ensuite automatiquement.

Le fork a son propre stockage, distinct de l'original : à la première installation, refaire les réglages (clé API, compte Oracle, capacité, pays…).

## Licence

GPL-3.0-only, comme l'original (`LICENSE`).
