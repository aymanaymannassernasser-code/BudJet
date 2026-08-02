/**
 * BudJet data layer — IndexedDB wrapper.
 * Everything lives offline-first in the browser. No server, no account required.
 *
 * Design decisions (the "caveats" from the brief):
 *  - Every transaction stores its ORIGINAL amount+currency AND the exchange rate
 *    used at that moment. We never re-derive historical values from today's rate.
 *  - Transfers (currency conversions) are their own transaction type so they never
 *    get double-counted as income or expense.
 *  - Categories are archived, not deleted, so historical charts stay accurate even
 *    after a category is retired.
 *  - Balances are always computed live from the transaction log — never cached —
 *    so there is no drift between "balance" and "history."
 */

const DB_NAME = 'budjet';
const DB_VERSION = 1;
const STORES = ['accounts', 'categories', 'transactions', 'goals', 'recurring', 'settings'];

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('accounts')) db.createObjectStore('accounts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('transactions')) {
        const ts = db.createObjectStore('transactions', { keyPath: 'id' });
        ts.createIndex('date', 'date');
        ts.createIndex('categoryId', 'categoryId');
        ts.createIndex('accountId', 'accountId');
      }
      if (!db.objectStoreNames.contains('goals')) db.createObjectStore('goals', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('recurring')) db.createObjectStore('recurring', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const Store = {
  async all(storeName) {
    const store = await tx(storeName);
    return reqToPromise(store.getAll());
  },
  async get(storeName, id) {
    const store = await tx(storeName);
    return reqToPromise(store.get(id));
  },
  async put(storeName, obj) {
    if (!obj.id) obj.id = uid();
    const store = await tx(storeName, 'readwrite');
    await reqToPromise(store.put(obj));
    return obj;
  },
  async remove(storeName, id) {
    const store = await tx(storeName, 'readwrite');
    return reqToPromise(store.delete(id));
  },
  async clearAll() {
    for (const s of STORES) {
      const store = await tx(s, 'readwrite');
      await reqToPromise(store.clear());
    }
  }
};

// ---------- Defaults / seed data ----------

const DEFAULT_CATEGORIES = [
  { name: 'Housing & Rent', icon: '🏠', color: '#C9A24B' },
  { name: 'Utilities', icon: '💡', color: '#E0B84B' },
  { name: 'Groceries', icon: '🛒', color: '#3FAE7A' },
  { name: 'Eating Out', icon: '🍽️', color: '#C9622D' },
  { name: 'Transportation', icon: '🚗', color: '#4C8BF5' },
  { name: 'Health & Pharmacy', icon: '💊', color: '#D65B5B' },
  { name: 'Subscriptions', icon: '📱', color: '#8A6FD1' },
  { name: 'Family Support', icon: '🤝', color: '#C9A24B' },
  { name: 'Debt & Installments', icon: '💳', color: '#D65B5B' },
  { name: 'Education', icon: '📚', color: '#4C8BF5' },
  { name: 'Clothing', icon: '👕', color: '#3FAE7A' },
  { name: 'Entertainment', icon: '🎬', color: '#8A6FD1' },
  { name: 'Phone & Data', icon: '📶', color: '#E0B84B' },
  { name: 'Savings & Investment', icon: '📈', color: '#3FAE7A' },
  { name: 'Gifts & Donations', icon: '🎁', color: '#C9622D' },
  { name: 'Insurance', icon: '🛡️', color: '#4C8BF5' },
  { name: 'Miscellaneous', icon: '✳️', color: '#9AA5B8' }
];

const DEFAULT_ACCOUNTS = [
  { name: 'USD Bank', currency: 'USD', type: 'bank' },
  { name: 'EGP Bank', currency: 'EGP', type: 'bank' },
  { name: 'EGP Cash', currency: 'EGP', type: 'cash' },
  { name: 'USD Cash', currency: 'USD', type: 'cash' }
];

async function ensureSeeded() {
  const settings = await Store.get('settings', 'app');
  if (settings) return;

  for (const c of DEFAULT_CATEGORIES) {
    await Store.put('categories', { ...c, archived: false, budgetMonthlyEGP: null });
  }
  for (const a of DEFAULT_ACCOUNTS) {
    await Store.put('accounts', { ...a, archived: false });
  }
  await Store.put('settings', {
    id: 'app',
    baseDisplayCurrency: 'EGP',
    monthStartDay: 1,
    lastKnownRate: 51.00, // EGP per 1 USD — placeholder, user should update
    salaryUSD: null,
    onboarded: false
  });
}

// ---------- Derived / computed queries ----------

/**
 * Compute the live balance of an account from the transaction log.
 * Transfers move money OUT of fromAccount and INTO toAccount using the
 * amounts actually recorded at conversion time (no re-conversion).
 */
async function accountBalance(accountId) {
  const txns = await Store.all('transactions');
  let bal = 0;
  for (const t of txns) {
    if (t.type === 'income' && t.accountId === accountId) bal += t.amount;
    if (t.type === 'expense' && t.accountId === accountId) bal -= t.amount;
    if (t.type === 'transfer') {
      if (t.accountId === accountId) bal -= t.amount; // leaving source account
      if (t.toAccountId === accountId) bal += t.toAmount; // arriving in destination account
    }
  }
  return bal;
}

async function allBalances() {
  const accounts = await Store.all('accounts');
  const out = {};
  for (const a of accounts) {
    out[a.id] = await accountBalance(a.id);
  }
  return out;
}

/** Net worth expressed in both currencies, using the given rate for cross-conversion. */
async function netWorth(currentRate) {
  const accounts = await Store.all('accounts');
  const balances = await allBalances();
  let usd = 0, egp = 0;
  for (const a of accounts) {
    const b = balances[a.id] || 0;
    if (a.currency === 'USD') usd += b; else egp += b;
  }
  return {
    usd, egp,
    totalUSD: usd + (egp / currentRate),
    totalEGP: egp + (usd * currentRate)
  };
}

function monthKey(dateStr, monthStartDay = 1) {
  const d = new Date(dateStr);
  if (monthStartDay > 1 && d.getDate() < monthStartDay) {
    d.setMonth(d.getMonth() - 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function spendingByCategory(monthKeyFilter, monthStartDay = 1) {
  const txns = await Store.all('transactions');
  const cats = await Store.all('categories');
  const catMap = Object.fromEntries(cats.map((c) => [c.id, c]));
  const sums = {};
  for (const t of txns) {
    if (t.type !== 'expense') continue;
    if (monthKeyFilter && monthKey(t.date, monthStartDay) !== monthKeyFilter) continue;
    const key = t.categoryId || '__uncategorized';
    if (!sums[key]) sums[key] = { categoryId: key, name: catMap[key]?.name || 'Uncategorized', color: catMap[key]?.color || '#9AA5B8', icon: catMap[key]?.icon || '❓', egp: 0, usd: 0 };
    sums[key].egp += t.amountEGP;
    sums[key].usd += t.amountUSD;
  }
  return Object.values(sums).sort((a, b) => b.egp - a.egp);
}

async function monthlyTotals(monthStartDay = 1) {
  const txns = await Store.all('transactions');
  const byMonth = {};
  for (const t of txns) {
    const k = monthKey(t.date, monthStartDay);
    if (!byMonth[k]) byMonth[k] = { month: k, incomeEGP: 0, expenseEGP: 0, incomeUSD: 0, expenseUSD: 0, avgRate: [] };
    if (t.type === 'income') { byMonth[k].incomeEGP += t.amountEGP; byMonth[k].incomeUSD += t.amountUSD; }
    if (t.type === 'expense') { byMonth[k].expenseEGP += t.amountEGP; byMonth[k].expenseUSD += t.amountUSD; }
    if (t.rate) byMonth[k].avgRate.push(t.rate);
  }
  return Object.values(byMonth)
    .map((m) => ({ ...m, avgRate: m.avgRate.length ? m.avgRate.reduce((a, b) => a + b, 0) / m.avgRate.length : null }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

window.BudJetDB = {
  Store, uid, ensureSeeded, accountBalance, allBalances, netWorth,
  spendingByCategory, monthlyTotals, monthKey, DEFAULT_CATEGORIES, DEFAULT_ACCOUNTS
};
