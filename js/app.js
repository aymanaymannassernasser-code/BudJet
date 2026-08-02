/* global BudJetDB, BudJetCharts */
(() => {
  const { Store, uid, ensureSeeded, allBalances, netWorth, spendingByCategory, monthlyTotals, monthKey } = BudJetDB;

  // ---------- In-memory cache ----------
  let state = {
    accounts: [], categories: [], transactions: [], goals: [], recurring: [], settings: null,
    activeTab: 'dashboard', editingTxnId: null, editingCatId: null, editingAccId: null,
    editingGoalId: null, editingRecId: null,
  };

  const ICONS = ['🏠','💡','🛒','🍽️','🚗','💊','📱','🤝','💳','📚','👕','🎬','📶','📈','🎁','🛡️','✳️','🐾','✈️','🎓','🧴','🔧','🎮','☕','👶','💇','🏋️','📦'];
  const COLORS = ['#C9A24B','#3FAE7A','#C9622D','#4C8BF5','#D65B5B','#8A6FD1','#E0B84B','#9AA5B8','#5FBFB3','#E0895F'];

  // ---------- Utils ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function fmt(amount, currency, opts = {}) {
    const sym = currency === 'USD' ? '$' : 'E£';
    const n = Number(amount) || 0;
    const abs = Math.abs(n);
    const str = abs.toLocaleString('en-US', { minimumFractionDigits: opts.decimals ?? 2, maximumFractionDigits: opts.decimals ?? 2 });
    return `${n < 0 ? '-' : ''}${sym}${str}`;
  }

  function fmtCompact(amount, currency) {
    const sym = currency === 'USD' ? '$' : 'E£';
    const n = Number(amount) || 0;
    const abs = Math.abs(n);
    let out;
    if (abs >= 1000000) out = (abs / 1000000).toFixed(1) + 'M';
    else if (abs >= 1000) out = (abs / 1000).toFixed(1) + 'k';
    else out = abs.toFixed(0);
    return `${n < 0 ? '-' : ''}${sym}${out}`;
  }

  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function openSheet(id) { $(id).classList.add('active'); }
  function closeSheet(id) { $(id).classList.remove('active'); }
  $$('.sheet-backdrop').forEach((el) => {
    el.addEventListener('click', (e) => { if (e.target === el) el.classList.remove('active'); });
  });

  function accountsById() { return Object.fromEntries(state.accounts.map((a) => [a.id, a])); }
  function categoriesById() { return Object.fromEntries(state.categories.map((c) => [c.id, c])); }

  // ---------- Data reload ----------
  async function reload() {
    const [accounts, categories, transactions, goals, recurring, settings] = await Promise.all([
      Store.all('accounts'), Store.all('categories'), Store.all('transactions'),
      Store.all('goals'), Store.all('recurring'), Store.get('settings', 'app')
    ]);
    state.accounts = accounts.filter((a) => !a.archived);
    state.categories = categories.filter((c) => !c.archived);
    state.categoriesAll = categories;
    state.transactions = transactions.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    state.goals = goals;
    state.recurring = recurring;
    state.settings = settings;
  }

  // ---------- Rendering: Dashboard ----------
  async function renderDashboard() {
    const s = state.settings;
    const rate = s.lastKnownRate || 1;
    const balances = await allBalances();
    const accMap = accountsById();

    let usdTotal = 0, egpTotal = 0;
    for (const a of state.accounts) {
      const b = balances[a.id] || 0;
      if (a.currency === 'USD') usdTotal += b; else egpTotal += b;
    }
    $('#gaugeUSD').textContent = fmtCompact(usdTotal, 'USD');
    $('#gaugeEGP').textContent = fmtCompact(egpTotal, 'EGP');

    const nw = await netWorth(rate);
    $('#netWorthPill').textContent = `${fmt(nw.totalUSD, 'USD', { decimals: 0 })} / ${fmt(nw.totalEGP, 'EGP', { decimals: 0 })}`;

    $('#rateDisplay').textContent = `1 USD = ${rate.toFixed(2)} EGP`;
    const needle = $('#rateDialNeedle');
    // Map rate roughly 20-70 EGP range onto a -70..70 degree swing for a visual "heading"
    const clamped = Math.max(20, Math.min(70, rate));
    const deg = ((clamped - 20) / 50) * 140 - 70;
    needle.style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
    $('#rateAsOf').textContent = s.rateUpdatedAt ? `Updated ${new Date(s.rateUpdatedAt).toLocaleDateString()}` : 'Set this in Settings';

    // Onboarding / recurring due banners
    renderBanners();

    // This month category donut
    const mk = monthKey(todayISO(), s.monthStartDay || 1);
    $('#monthLabel').textContent = new Date(mk + '-02').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const cats = await spendingByCategory(mk, s.monthStartDay || 1);
    const donutData = cats.map((c) => ({ value: c.egp, color: c.color }));
    const totalSpendEGP = cats.reduce((s2, c) => s2 + c.egp, 0);
    BudJetCharts.drawDonut($('#donutChart'), donutData, {
      centerLabel: fmtCompact(totalSpendEGP, 'EGP'),
      centerSub: 'spent'
    });
    const legend = $('#donutLegend');
    legend.innerHTML = cats.length ? cats.slice(0, 6).map((c) => `
      <div class="cat-legend-row">
        <span class="cat-dot" style="background:${c.color}"></span>
        <span class="name">${c.icon} ${c.name}</span>
        <span class="pct">${fmt(c.egp, 'EGP', { decimals: 0 })} · ${totalSpendEGP ? Math.round(c.egp / totalSpendEGP * 100) : 0}%</span>
      </div>`).join('') : `<div class="empty"><div class="glyph">📭</div><div class="msg">No spending logged yet this month</div></div>`;

    // Cost of living in USD
    const totalSpendUSD = cats.reduce((s2, c) => s2 + c.usd, 0);
    $('#colUSD').textContent = fmt(totalSpendUSD, 'USD', { decimals: 0 });
    const salary = s.salaryUSD;
    $('#colPct').textContent = salary ? `${Math.round((totalSpendUSD / salary) * 100)}%` : '—';

    // Recent entries
    renderTxnList($('#recentList'), state.transactions.slice(0, 6), true);
  }

  function renderBanners() {
    const s = state.settings;
    const box = $('#onboardBanner');
    box.innerHTML = '';
    if (!s.salaryUSD) {
      box.innerHTML += `<div class="banner"><div><strong>Set up your basics.</strong> Add your monthly USD salary and today's exchange rate in Settings to unlock the full dashboard.</div></div>`;
    }
    // Recurring due but not logged this month
    const mk = monthKey(todayISO(), s.monthStartDay || 1);
    const today = new Date();
    const dueUnlogged = state.recurring.filter((r) => {
      if (!r.active) return false;
      if (today.getDate() < r.dayOfMonth) return false;
      const alreadyLogged = state.transactions.some((t) => t.recurringId === r.id && monthKey(t.date, s.monthStartDay || 1) === mk);
      return !alreadyLogged;
    });
    if (dueUnlogged.length) {
      const accMap = accountsById();
      box.innerHTML += `<div class="banner warn"><div style="flex:1;">
        <strong>${dueUnlogged.length} recurring item${dueUnlogged.length > 1 ? 's' : ''} due this month</strong>
        <div style="margin-top:8px; display:flex; flex-direction:column; gap:6px;">
          ${dueUnlogged.map((r) => `
            <div class="row-between">
              <span class="small">${escapeHtml(r.name)} · ${fmt(r.amount, accMap[r.accountId]?.currency || 'EGP', { decimals: 0 })}</span>
              <button class="btn btn-sm btn-primary" onclick="window.logRecurring('${r.id}')">Log it</button>
            </div>`).join('')}
        </div>
      </div></div>`;
    }
  }

  function renderTxnList(container, txns, compact) {
    const accMap = accountsById();
    const catMap = categoriesById();
    if (!txns.length) {
      container.innerHTML = `<div class="empty"><div class="glyph">🧭</div><div class="msg">No entries yet. Tap + to log your first one.</div></div>`;
      return;
    }
    container.innerHTML = txns.map((t) => {
      const acc = accMap[t.accountId] || {};
      let icon = '💱', title = '', sub = '', amtClass = 'amt-out', amtSign = '-';
      if (t.type === 'income') {
        const c = catMap[t.categoryId];
        icon = c ? c.icon : '💰'; title = c ? c.name : 'Income'; amtClass = 'amt-in'; amtSign = '+';
        sub = `${acc.name || 'Account'} · ${new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      } else if (t.type === 'expense') {
        const c = catMap[t.categoryId];
        icon = c ? c.icon : '❓'; title = c ? c.name : 'Uncategorized'; amtClass = 'amt-out'; amtSign = '-';
        sub = `${acc.name || 'Account'} · ${new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      } else {
        icon = '⇄'; title = `${acc.name || '?'} → ${(accMap[t.toAccountId] || {}).name || '?'}`; amtClass = 'amt-transfer'; amtSign = '';
        sub = `Converted · ${new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      }
      const amtPrimary = t.type === 'transfer'
        ? `${fmt(t.amount, t.currency, { decimals: 0 })} → ${fmt(t.toAmount, t.toCurrency, { decimals: 0 })}`
        : `${amtSign}${fmt(t.amount, t.currency, { decimals: 0 })}`;
      const secondary = t.type === 'transfer' ? `rate ${t.rate?.toFixed(2) || '—'}` : (t.currency === 'USD' ? fmt(t.amountEGP, 'EGP', { decimals: 0 }) : fmt(t.amountUSD, 'USD', { decimals: 2 }));
      return `<div class="list-row" data-id="${t.id}" style="cursor:pointer;">
        <div class="list-icon">${icon}</div>
        <div class="list-main">
          <div class="list-title">${title}${t.note ? ` <span class="muted">· ${escapeHtml(t.note)}</span>` : ''}</div>
          <div class="list-sub">${sub}</div>
        </div>
        <div class="list-amt">
          <div class="primary ${amtClass} num">${amtPrimary}</div>
          <div class="secondary">${secondary}</div>
        </div>
      </div>`;
    }).join('');
    container.querySelectorAll('.list-row').forEach((row) => {
      row.addEventListener('click', () => openTxnSheet(row.dataset.id));
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  // ---------- Log tab ----------
  function renderLog() {
    const filter = $('#logFilter').value;
    const txns = filter === 'all' ? state.transactions : state.transactions.filter((t) => t.type === filter);
    renderTxnList($('#fullList'), txns, false);
  }

  // ---------- Budgets tab ----------
  async function renderBudgets() {
    const mk = monthKey(todayISO(), state.settings.monthStartDay || 1);
    const spend = await spendingByCategory(mk, state.settings.monthStartDay || 1);
    const spendMap = Object.fromEntries(spend.map((s) => [s.categoryId, s.egp]));
    const withBudget = state.categories.filter((c) => c.budgetMonthlyEGP);
    const box = $('#budgetList');
    if (!withBudget.length) {
      box.innerHTML = `<div class="empty"><div class="glyph">🎯</div><div class="msg">No budgets set. Add one from a category in Settings.</div></div>`;
    } else {
      box.innerHTML = withBudget.map((c) => {
        const spent = spendMap[c.id] || 0;
        const pct = Math.min(100, Math.round((spent / c.budgetMonthlyEGP) * 100));
        const over = spent > c.budgetMonthlyEGP;
        return `<div class="budget-row">
          <div class="budget-top">
            <span class="cat-name">${c.icon} ${c.name}</span>
            <span class="amounts">${fmt(spent, 'EGP', { decimals: 0 })} / ${fmt(c.budgetMonthlyEGP, 'EGP', { decimals: 0 })}</span>
          </div>
          <div class="budget-track"><div class="budget-fill" style="width:${pct}%; background:${over ? 'var(--danger)' : c.color}"></div></div>
        </div>`;
      }).join('');
    }

    const rbox = $('#recurringList');
    if (!state.recurring.length) {
      rbox.innerHTML = `<div class="empty"><div class="glyph">🗓️</div><div class="msg">No recurring items yet.</div></div>`;
    } else {
      const catMap = categoriesById();
      const accMap = accountsById();
      rbox.innerHTML = state.recurring.map((r) => `
        <div class="list-row" data-id="${r.id}" style="cursor:pointer;">
          <div class="list-icon">${r.type === 'income' ? '💰' : (catMap[r.categoryId]?.icon || '📌')}</div>
          <div class="list-main">
            <div class="list-title">${escapeHtml(r.name)}</div>
            <div class="list-sub">${accMap[r.accountId]?.name || ''} · day ${r.dayOfMonth} of month</div>
          </div>
          <div class="list-amt">
            <div class="primary num ${r.type === 'income' ? 'amt-in' : 'amt-out'}">${fmt(r.amount, accMap[r.accountId]?.currency || 'EGP', { decimals: 0 })}</div>
          </div>
        </div>`).join('');
      rbox.querySelectorAll('.list-row').forEach((row) => row.addEventListener('click', () => openRecurringSheet(row.dataset.id)));
    }
  }

  // ---------- Goals tab ----------
  async function renderGoals() {
    const box = $('#goalsList');
    const rate = state.settings.lastKnownRate || 1;
    if (!state.goals.length) {
      box.innerHTML = `<div class="card empty"><div class="glyph">🎯</div><div class="msg">No goals yet.</div></div>`;
    } else {
      box.innerHTML = state.goals.map((g) => {
        const pct = Math.min(100, Math.round(((g.saved || 0) / g.targetAmount) * 100));
        return `<div class="card goal-card" data-id="${g.id}" style="cursor:pointer;">
          <div class="goal-top">
            <span class="goal-name">${escapeHtml(g.name)}</span>
            ${g.deadline ? `<span class="goal-deadline">by ${new Date(g.deadline).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>` : ''}
          </div>
          <div class="goal-track"><div class="goal-fill" style="width:${pct}%"></div></div>
          <div class="goal-nums">
            <span>${fmt(g.saved || 0, g.currency, { decimals: 0 })} saved</span>
            <span>${pct}% of ${fmt(g.targetAmount, g.currency, { decimals: 0 })}</span>
          </div>
        </div>`;
      }).join('');
      box.querySelectorAll('.goal-card').forEach((el) => el.addEventListener('click', () => openGoalSheet(el.dataset.id)));
    }

    const totals = await monthlyTotals(state.settings.monthStartDay || 1);
    const last6 = totals.slice(-6);
    const points = last6.map((m) => ({
      label: new Date(m.month + '-02').toLocaleDateString('en-US', { month: 'short' }),
      value: m.incomeEGP - m.expenseEGP
    }));
    BudJetCharts.drawLine($('#savingsLineChart'), points, { color: '#3FAE7A' });
  }

  // ---------- Settings tab ----------
  function renderSettings() {
    $('#settingRate').value = state.settings.lastKnownRate || '';
    $('#settingSalary').value = state.settings.salaryUSD || '';
    $('#settingMonthStart').value = state.settings.monthStartDay || 1;

    const accMap = state.accounts;
    Store.all('accounts').then((all) => {
      const balancesP = allBalances();
      balancesP.then((balances) => {
        $('#accountsList').innerHTML = all.filter(a => !a.archived).map((a) => `
          <div class="list-row" data-id="${a.id}" style="cursor:pointer;">
            <div class="list-icon">${a.currency === 'USD' ? '💵' : '💷'}</div>
            <div class="list-main">
              <div class="list-title">${escapeHtml(a.name)}</div>
              <div class="list-sub">${a.currency} · ${a.type}</div>
            </div>
            <div class="list-amt"><div class="primary num">${fmt(balances[a.id] || 0, a.currency)}</div></div>
          </div>`).join('') || `<div class="empty small">No accounts</div>`;
        $('#accountsList').querySelectorAll('.list-row').forEach((row) => row.addEventListener('click', () => openAccountSheet(row.dataset.id)));
      });
    });

    $('#categoriesList').innerHTML = state.categories.map((c) => `
      <div class="list-row" data-id="${c.id}" style="cursor:pointer;">
        <div class="list-icon" style="background:${c.color}33;">${c.icon}</div>
        <div class="list-main">
          <div class="list-title">${escapeHtml(c.name)}</div>
          <div class="list-sub">${c.budgetMonthlyEGP ? `Budget: ${fmt(c.budgetMonthlyEGP, 'EGP', { decimals: 0 })}/mo` : 'No budget set'}</div>
        </div>
      </div>`).join('') || `<div class="empty small">No categories</div>`;
    $('#categoriesList').querySelectorAll('.list-row').forEach((row) => row.addEventListener('click', () => openCategorySheet(row.dataset.id)));
  }

  // ---------- Render dispatch ----------
  async function renderActive() {
    await reload();
    populateSelects();
    if (state.activeTab === 'dashboard') await renderDashboard();
    if (state.activeTab === 'log') renderLog();
    if (state.activeTab === 'budgets') await renderBudgets();
    if (state.activeTab === 'goals') await renderGoals();
    if (state.activeTab === 'settings') renderSettings();
  }

  function populateSelects() {
    const accOpts = state.accounts.map((a) => `<option value="${a.id}">${a.name} (${a.currency})</option>`).join('');
    $('#txnAccount').innerHTML = accOpts;
    $('#txnToAccount').innerHTML = accOpts;
    $('#recAccount').innerHTML = accOpts;
    const catOpts = state.categories.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
    $('#txnCategory').innerHTML = catOpts;
    $('#recCategory').innerHTML = catOpts;
  }

  // ---------- Tab navigation ----------
  $$('.tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      $$('.tab').forEach((b) => b.classList.remove('active'));
      tabBtn.classList.add('active');
      $$('main section').forEach((s) => s.classList.remove('active'));
      state.activeTab = tabBtn.dataset.tab;
      $(`#tab-${state.activeTab}`).classList.add('active');
      renderActive();
    });
  });
  $('#btnSeeAllLog').addEventListener('click', () => document.querySelector('.tab[data-tab="log"]').click());
  $('#btnSettingsShortcut').addEventListener('click', () => document.querySelector('.tab[data-tab="settings"]').click());
  $('#logFilter').addEventListener('change', renderLog);

  // ---------- Segmented controls ----------
  function wireSeg(id, onChange) {
    $$(`${id} button`).forEach((btn) => {
      btn.addEventListener('click', () => {
        $$(`${id} button`).forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        onChange(btn.dataset.val);
      });
    });
  }
  function segVal(id) { return $(`${id} button.active`)?.dataset.val; }

  // ---------- Transaction sheet ----------
  wireSeg('#txnTypeSeg', updateTxnFormForType);
  $('#txnAccount').addEventListener('change', updateTxnFormForType);

  function updateTxnFormForType() {
    const type = segVal('#txnTypeSeg');
    const accId = $('#txnAccount').value;
    const acc = accountsById()[accId];
    $('#fieldToAccount').style.display = type === 'transfer' ? 'block' : 'none';
    $('#fieldToAmount').style.display = type === 'transfer' ? 'block' : 'none';
    $('#fieldCategory').style.display = type === 'transfer' ? 'none' : 'block';
    $('#fieldRate').style.display = 'block';
    $('#labelAccountFrom').textContent = type === 'transfer' ? 'From account' : 'Account';
    $('#labelAmount').textContent = acc ? `Amount (${acc.currency})` : 'Amount';
    if (type === 'transfer') {
      $('#rateHintText').textContent = "💡 Rate is calculated from the amounts you enter — adjust either side to match your actual conversion.";
    } else {
      $('#rateHintText').textContent = "💡 Enter the rate you actually got — it's saved with this entry forever, so past spending never re-prices itself.";
    }
  }

  function openTxnSheet(id) {
    state.editingTxnId = id || null;
    const t = id ? state.transactions.find((x) => x.id === id) : null;
    $('#txnSheetTitle').textContent = t ? 'Edit log entry' : 'New log entry';
    $('#btnDeleteTxn').style.display = t ? 'block' : 'none';

    const type = t?.type || 'expense';
    $$('#txnTypeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.val === type));
    $('#txnAccount').value = t?.accountId || state.accounts[0]?.id || '';
    $('#txnToAccount').value = t?.toAccountId || (state.accounts[1]?.id || '');
    $('#txnAmount').value = t?.amount ?? '';
    $('#txnToAmount').value = t?.toAmount ?? '';
    $('#txnRate').value = t?.rate ?? state.settings.lastKnownRate ?? '';
    $('#txnCategory').value = t?.categoryId || (state.categories[0]?.id || '');
    $('#txnDate').value = t?.date || todayISO();
    $('#txnNote').value = t?.note || '';
    updateTxnFormForType();
    openSheet('#sheetTxn');
  }

  $('#fabAdd').addEventListener('click', () => openTxnSheet(null));

  $('#btnSaveTxn').addEventListener('click', async () => {
    const type = segVal('#txnTypeSeg');
    const accountId = $('#txnAccount').value;
    const acc = accountsById()[accountId];
    const amount = parseFloat($('#txnAmount').value);
    const date = $('#txnDate').value || todayISO();
    const note = $('#txnNote').value.trim();

    if (!accountId || !amount || amount <= 0) { toast('Enter an account and a valid amount'); return; }

    let payload = { id: state.editingTxnId || undefined, type, accountId, currency: acc.currency, amount, date, note };

    if (type === 'transfer') {
      const toAccountId = $('#txnToAccount').value;
      const toAcc = accountsById()[toAccountId];
      const toAmount = parseFloat($('#txnToAmount').value);
      if (!toAccountId || !toAmount || toAmount <= 0) { toast('Enter a destination account and amount'); return; }
      if (toAccountId === accountId) { toast('Choose two different accounts'); return; }
      let rate;
      if (acc.currency === 'USD' && toAcc.currency === 'EGP') rate = toAmount / amount;
      else if (acc.currency === 'EGP' && toAcc.currency === 'USD') rate = amount / toAmount;
      else rate = state.settings.lastKnownRate || 1; // same-currency transfer edge case
      payload = { ...payload, toAccountId, toCurrency: toAcc.currency, toAmount, rate,
        amountUSD: acc.currency === 'USD' ? amount : toAmount, amountEGP: acc.currency === 'EGP' ? amount : toAmount };
      // Keep the global rate fresh from real conversions the user actually performs
      if (acc.currency !== toAcc.currency) {
        await saveSettingsPatch({ lastKnownRate: rate, rateUpdatedAt: new Date().toISOString() });
      }
    } else {
      const rate = parseFloat($('#txnRate').value) || state.settings.lastKnownRate || 1;
      const categoryId = $('#txnCategory').value;
      const amountUSD = acc.currency === 'USD' ? amount : amount / rate;
      const amountEGP = acc.currency === 'EGP' ? amount : amount * rate;
      payload = { ...payload, categoryId, rate, amountUSD, amountEGP };
      if (state.editingTxnId) {
        const existing = state.transactions.find((x) => x.id === state.editingTxnId);
        if (existing?.recurringId) payload.recurringId = existing.recurringId;
      }
    }

    await Store.put('transactions', payload);
    closeSheet('#sheetTxn');
    toast('Entry saved');
    await renderActive();
  });

  $('#btnDeleteTxn').addEventListener('click', async () => {
    if (!state.editingTxnId) return;
    await Store.remove('transactions', state.editingTxnId);
    closeSheet('#sheetTxn');
    toast('Entry deleted');
    await renderActive();
  });

  // ---------- Category sheet ----------
  function buildIconPicker(selected) {
    $('#catIconPicker').innerHTML = ICONS.map((ic) => `<div class="emoji-pick ${ic === selected ? 'selected' : ''}" data-icon="${ic}">${ic}</div>`).join('');
    $('#catIconPicker').querySelectorAll('.emoji-pick').forEach((el) => {
      el.addEventListener('click', () => {
        $('#catIconPicker').querySelectorAll('.emoji-pick').forEach((e) => e.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
  }
  function buildColorPicker(selected) {
    $('#catColorPicker').innerHTML = COLORS.map((c) => `<div class="swatch ${c === selected ? 'selected' : ''}" data-color="${c}" style="background:${c}"></div>`).join('');
    $('#catColorPicker').querySelectorAll('.swatch').forEach((el) => {
      el.addEventListener('click', () => {
        $('#catColorPicker').querySelectorAll('.swatch').forEach((e) => e.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
  }

  function openCategorySheet(id) {
    state.editingCatId = id || null;
    const c = id ? state.categoriesAll.find((x) => x.id === id) : null;
    $('#catName').value = c?.name || '';
    $('#catBudget').value = c?.budgetMonthlyEGP || '';
    buildIconPicker(c?.icon || ICONS[0]);
    buildColorPicker(c?.color || COLORS[0]);
    $('#btnArchiveCategory').style.display = c ? 'block' : 'none';
    openSheet('#sheetCategory');
  }
  $('#btnAddCategory').addEventListener('click', () => openCategorySheet(null));

  $('#btnSaveCategory').addEventListener('click', async () => {
    const name = $('#catName').value.trim();
    if (!name) { toast('Give the category a name'); return; }
    const icon = $('#catIconPicker .selected')?.dataset.icon || ICONS[0];
    const color = $('#catColorPicker .selected')?.dataset.color || COLORS[0];
    const budgetMonthlyEGP = parseFloat($('#catBudget').value) || null;
    await Store.put('categories', { id: state.editingCatId || undefined, name, icon, color, budgetMonthlyEGP, archived: false });
    closeSheet('#sheetCategory');
    toast('Category saved');
    await renderActive();
  });
  $('#btnArchiveCategory').addEventListener('click', async () => {
    if (!state.editingCatId) return;
    const c = state.categoriesAll.find((x) => x.id === state.editingCatId);
    await Store.put('categories', { ...c, archived: true });
    closeSheet('#sheetCategory');
    toast('Category archived — past entries keep their history');
    await renderActive();
  });

  // ---------- Account sheet ----------
  wireSeg('#accCurrencySeg', () => {});
  wireSeg('#accTypeSeg', () => {});

  function openAccountSheet(id) {
    state.editingAccId = id || null;
    const a = id ? state.accounts.find((x) => x.id === id) : null;
    $('#accName').value = a?.name || '';
    $$('#accCurrencySeg button').forEach((b) => b.classList.toggle('active', b.dataset.val === (a?.currency || 'USD')));
    $$('#accTypeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.val === (a?.type || 'bank')));
    $('#accStartBalance').value = '';
    $('#accStartBalance').closest('.field').style.display = a ? 'none' : 'block';
    $('#btnArchiveAccount').style.display = a ? 'block' : 'none';
    openSheet('#sheetAccount');
  }
  $('#btnAddAccount').addEventListener('click', () => openAccountSheet(null));

  $('#btnSaveAccount').addEventListener('click', async () => {
    const name = $('#accName').value.trim();
    if (!name) { toast('Give the account a name'); return; }
    const currency = segVal('#accCurrencySeg');
    const type = segVal('#accTypeSeg');
    const acc = await Store.put('accounts', { id: state.editingAccId || undefined, name, currency, type, archived: false });
    const startBalance = parseFloat($('#accStartBalance').value);
    if (!state.editingAccId && startBalance) {
      // Seed with an opening-balance income transaction so it participates in the ledger cleanly.
      await Store.put('transactions', {
        type: 'income', accountId: acc.id, currency, amount: startBalance, date: todayISO(),
        note: 'Opening balance', categoryId: null, rate: state.settings.lastKnownRate || 1,
        amountUSD: currency === 'USD' ? startBalance : startBalance / (state.settings.lastKnownRate || 1),
        amountEGP: currency === 'EGP' ? startBalance : startBalance * (state.settings.lastKnownRate || 1)
      });
    }
    closeSheet('#sheetAccount');
    toast('Account saved');
    await renderActive();
  });
  $('#btnArchiveAccount').addEventListener('click', async () => {
    if (!state.editingAccId) return;
    const a = state.accounts.find((x) => x.id === state.editingAccId);
    await Store.put('accounts', { ...a, archived: true });
    closeSheet('#sheetAccount');
    toast('Account archived');
    await renderActive();
  });

  // ---------- Goal sheet ----------
  wireSeg('#goalCurrencySeg', () => {});

  function openGoalSheet(id) {
    state.editingGoalId = id || null;
    const g = id ? state.goals.find((x) => x.id === id) : null;
    $('#goalName').value = g?.name || '';
    $('#goalTarget').value = g?.targetAmount || '';
    $$('#goalCurrencySeg button').forEach((b) => b.classList.toggle('active', b.dataset.val === (g?.currency || 'USD')));
    $('#goalDeadline').value = g?.deadline || '';
    $('#goalSaved').value = g?.saved || '';
    $('#btnDeleteGoal').style.display = g ? 'block' : 'none';
    openSheet('#sheetGoal');
  }
  $('#btnAddGoal').addEventListener('click', () => openGoalSheet(null));

  $('#btnSaveGoal').addEventListener('click', async () => {
    const name = $('#goalName').value.trim();
    const targetAmount = parseFloat($('#goalTarget').value);
    if (!name || !targetAmount) { toast('Give the goal a name and target'); return; }
    const currency = segVal('#goalCurrencySeg');
    const deadline = $('#goalDeadline').value || null;
    const saved = parseFloat($('#goalSaved').value) || 0;
    await Store.put('goals', { id: state.editingGoalId || undefined, name, targetAmount, currency, deadline, saved });
    closeSheet('#sheetGoal');
    toast('Goal saved');
    await renderActive();
  });
  $('#btnDeleteGoal').addEventListener('click', async () => {
    if (!state.editingGoalId) return;
    await Store.remove('goals', state.editingGoalId);
    closeSheet('#sheetGoal');
    toast('Goal deleted');
    await renderActive();
  });

  // ---------- Recurring sheet ----------
  wireSeg('#recTypeSeg', (val) => { $('#fieldRecCategory').style.display = val === 'income' ? 'none' : 'block'; });

  function openRecurringSheet(id) {
    state.editingRecId = id || null;
    const r = id ? state.recurring.find((x) => x.id === id) : null;
    $('#recName').value = r?.name || '';
    $$('#recTypeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.val === (r?.type || 'expense')));
    $('#fieldRecCategory').style.display = (r?.type || 'expense') === 'income' ? 'none' : 'block';
    $('#recAccount').value = r?.accountId || state.accounts[0]?.id || '';
    $('#recCategory').value = r?.categoryId || state.categories[0]?.id || '';
    $('#recAmount').value = r?.amount || '';
    $('#recDay').value = r?.dayOfMonth || 1;
    $('#btnDeleteRecurring').style.display = r ? 'block' : 'none';
    openSheet('#sheetRecurring');
  }
  $('#btnAddRecurring').addEventListener('click', () => openRecurringSheet(null));

  $('#btnSaveRecurring').addEventListener('click', async () => {
    const name = $('#recName').value.trim();
    const amount = parseFloat($('#recAmount').value);
    if (!name || !amount) { toast('Give it a name and amount'); return; }
    const type = segVal('#recTypeSeg');
    await Store.put('recurring', {
      id: state.editingRecId || undefined, name, type,
      accountId: $('#recAccount').value, categoryId: type === 'income' ? null : $('#recCategory').value,
      amount, dayOfMonth: parseInt($('#recDay').value) || 1, active: true
    });
    closeSheet('#sheetRecurring');
    toast('Recurring entry saved');
    await renderActive();
  });
  $('#btnDeleteRecurring').addEventListener('click', async () => {
    if (!state.editingRecId) return;
    await Store.remove('recurring', state.editingRecId);
    closeSheet('#sheetRecurring');
    toast('Recurring entry removed');
    await renderActive();
  });
  // Quick-log a recurring item as a real transaction from the dashboard banner
  window.logRecurring = async (recId) => {
    const r = state.recurring.find((x) => x.id === recId);
    if (!r) return;
    const acc = accountsById()[r.accountId];
    const rate = state.settings.lastKnownRate || 1;
    await Store.put('transactions', {
      type: r.type, accountId: r.accountId, currency: acc.currency, amount: r.amount, date: todayISO(),
      note: r.name, categoryId: r.categoryId, recurringId: r.id, rate,
      amountUSD: acc.currency === 'USD' ? r.amount : r.amount / rate,
      amountEGP: acc.currency === 'EGP' ? r.amount : r.amount * rate
    });
    toast(`Logged ${r.name}`);
    await renderActive();
  };

  // ---------- Settings actions ----------
  async function saveSettingsPatch(patch) {
    const merged = { ...state.settings, ...patch };
    await Store.put('settings', merged);
    state.settings = merged;
  }

  $('#btnSaveRate').addEventListener('click', async () => {
    const rate = parseFloat($('#settingRate').value);
    if (!rate || rate <= 0) { toast('Enter a valid rate'); return; }
    await saveSettingsPatch({ lastKnownRate: rate, rateUpdatedAt: new Date().toISOString() });
    toast('Rate updated');
    await renderActive();
  });

  $('#btnSaveSalary').addEventListener('click', async () => {
    const salaryUSD = parseFloat($('#settingSalary').value) || null;
    const monthStartDay = parseInt($('#settingMonthStart').value) || 1;
    await saveSettingsPatch({ salaryUSD, monthStartDay, onboarded: true });
    toast('Saved');
    await renderActive();
  });

  // ---------- Export / Import ----------
  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  $('#btnExportJSON').addEventListener('click', async () => {
    const dump = {
      accounts: await Store.all('accounts'), categories: await Store.all('categories'),
      transactions: await Store.all('transactions'), goals: await Store.all('goals'),
      recurring: await Store.all('recurring'), settings: await Store.get('settings', 'app'),
      exportedAt: new Date().toISOString(), version: 1
    };
    downloadFile(`budjet-backup-${todayISO()}.json`, JSON.stringify(dump, null, 2), 'application/json');
    toast('Backup downloaded');
  });

  $('#btnExportCSV').addEventListener('click', async () => {
    const accMap = accountsById();
    const catMap = categoriesById();
    const rows = [['Date', 'Type', 'Account', 'Category', 'Amount', 'Currency', 'Amount USD', 'Amount EGP', 'Rate', 'Note']];
    state.transactions.forEach((t) => {
      rows.push([
        t.date, t.type, accMap[t.accountId]?.name || '', t.type === 'transfer' ? 'Transfer' : (catMap[t.categoryId]?.name || 'Uncategorized'),
        t.amount, t.currency, (t.amountUSD ?? '').toFixed?.(2) ?? t.amountUSD, (t.amountEGP ?? '').toFixed?.(2) ?? t.amountEGP,
        t.rate ?? '', (t.note || '').replace(/,/g, ';')
      ]);
    });
    const csv = rows.map((r) => r.join(',')).join('\n');
    downloadFile(`budjet-log-${todayISO()}.csv`, csv, 'text/csv');
    toast('CSV downloaded');
  });

  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      if (!confirm('This replaces all current data with the backup file. Continue?')) return;
      await Store.clearAll();
      for (const a of data.accounts || []) await Store.put('accounts', a);
      for (const c of data.categories || []) await Store.put('categories', c);
      for (const t of data.transactions || []) await Store.put('transactions', t);
      for (const g of data.goals || []) await Store.put('goals', g);
      for (const r of data.recurring || []) await Store.put('recurring', r);
      if (data.settings) await Store.put('settings', data.settings);
      toast('Backup restored');
      await renderActive();
    } catch (err) {
      toast('That file could not be read');
    }
    e.target.value = '';
  });

  $('#btnResetAll').addEventListener('click', async () => {
    if (!confirm('This erases everything on this device permanently. Are you sure?')) return;
    await Store.clearAll();
    await ensureSeeded();
    toast('All data erased');
    location.reload();
  });

  // ---------- Boot ----------
  async function boot() {
    await ensureSeeded();
    await renderActive();

    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('service-worker.js'); } catch (e) { /* offline install still works via cache on next load */ }
    }
  }

  boot();
})();
