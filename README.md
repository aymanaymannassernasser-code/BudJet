# BudJet ✈️

*A flight-deck instrument panel for money that lives in two currencies at once.*

Built for tracking a USD salary against EGP spending — every transaction keeps its original amount, currency, and the exchange rate you actually got, so nothing gets silently re-priced later.

## Run it locally

No build step, no dependencies. Just serve the folder:

```bash
cd budjet
python3 -m http.server 8000
# open http://localhost:8000
```

Or drag the folder into any static host (see below).

## Install it as an app (PWA)

1. Host the folder somewhere over **HTTPS** (required for service workers) — see hosting options below.
2. Open the site on your phone in Chrome (Android) or Safari (iOS).
3. Android/Chrome: tap the menu → **Add to Home screen**.
   iOS/Safari: tap Share → **Add to Home Screen**.
4. It now opens full-screen, works offline, and keeps its own icon.

## Free hosting options (pick one)

- **Cloudflare Pages** — drag-and-drop the folder at pages.cloudflare.com, done in ~1 minute.
- **GitHub Pages** — push this folder to a repo, enable Pages in repo settings.
- **Netlify Drop** — drag the folder onto app.netlify.com/drop.

All three give you free HTTPS automatically, which is required for install-to-home-screen and offline mode to work.

## How your data is stored

Everything lives in **IndexedDB inside your browser** — nothing is sent to a server, there's no login. That means:

- ✅ Fully private, fully offline-capable.
- ⚠️ Data is tied to *this browser on this device*. Clearing browser data/site data wipes it.
- 💾 Use **Settings → Backup → Export backup (.json)** regularly, especially before switching phones, clearing browser storage, or reinstalling. Import it back on the new device/browser to restore everything exactly as it was.

## First things to do after installing

1. **Settings → Exchange rate**: enter today's actual rate (bank/Instapay/street — whatever you actually get).
2. **Settings → Salary**: enter the monthly USD salary and which day your "month" starts on (useful if salary lands mid-month).
3. **Settings → Accounts**: rename the default accounts (USD Bank, EGP Bank, EGP Cash, USD Cash) or add your real ones, with optional starting balances.
4. **Settings → Categories**: the 17 defaults cover most of daily life in Egypt — add/edit/archive freely. Archiving (not deleting) keeps old charts accurate.
5. Tap **+** to log your first entry.

## Feature map

| Where | What it does |
|---|---|
| **Dashboard** | USD/EGP balance gauges, live exchange-rate dial, this month's category breakdown, "cost of living in USD" (% of salary your EGP spending consumes), recent entries |
| **Log** | Full searchable/filterable transaction history |
| **Budgets** | Monthly EGP budget per category with progress bars; recurring bills with due-date tracking |
| **Goals** | Named savings goals with progress bars, plus a 6-month savings-rate trend |
| **Settings** | Exchange rate, salary, accounts, categories, JSON backup/restore, CSV export, full data reset |

## Notes on the currency logic

- Every **expense/income** stores the rate used, snapshotted at entry time — editing today's rate never rewrites yesterday's history.
- Every **transfer/conversion** between a USD and EGP account computes its own effective rate from the two amounts you enter, and that becomes the app's new "current heading" rate automatically (since it's the most real data point you have).
- **Net worth** and the dashboard gauges are always computed live from the transaction log, never cached — so there's no drift between "balance shown" and "history."
