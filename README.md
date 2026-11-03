# Torn Oracle: Travel - fork Workaround

Fork of **Torn Oracle: Travel** (author: Ruinbringer, license GPL-3.0-only, [Greasy Fork](https://greasyfork.org/en/scripts/590310-torn-oracle-travel)): wherever Torn Oracle shows a profit (plans, plan purchases, Shops, Watches, Museum), each item is sold through its best channel.

- Wardogs traders: market value × the category rate (98, 95 or 90 %)
- item market: 85 % of market value
- city: the shop's buyback price

The Shops tab has a **Sell** column showing that channel (Traders, Item market, or the name of the shop that buys it back). The "Sell to" and "Sell under market" settings no longer have any effect.

## Export alert

**Export watch** tab: one item, one country, a minimum margin per unit. Every minute, while a Torn page is open, the fork compares the lowest price in Torn (item market and bazaars, the latter through weav3r.dev) with the current buyback price of the foreign shop (a Black Market buys back at its own price, other shops at 75 %). Above the margin: a banner at the top of any Torn page, a notification and a beep. The total margin is based on your suitcase size minus the trip kit (self-hosp item, med-out items, other items). Code: `export_watch.js`, injected into the fork at build time.

## Items to sell on arrival

**Assist** tab, **Packed items to sell** list: items from "Other items to pack" to sell as soon as you land, before you self-hosp. While one of them is still in your suitcase, the button stays hidden during the flight, then offers "Sell <item>" once you land, one item after another in list order. Once everything is sold, the button goes back to its normal behavior (self-hosp, restock, buy, fly home).

## Installation

With Violentmonkey or Tampermonkey, open [torn-oracle-fork.user.js](https://raw.githubusercontent.com/LittleBigDev/torn-oracle-fork/main/torn-oracle-fork.user.js) and confirm. Updates then arrive automatically.

The fork has its own storage, separate from the original: on first install, set everything up again (API key, Oracle account, capacity, countries...).

## License

GPL-3.0-only, like the original (`LICENSE`).
