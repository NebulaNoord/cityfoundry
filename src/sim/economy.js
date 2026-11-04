// Daily finances. All money is held in integer cents internally so that
// arithmetic is exact and saves reproduce identical results.

import { TAX_BASE_CENTS, LOW_FUNDS_THRESHOLD, MAX_TAX } from './constants.js';

/** Income and expenses for one day, in cents. */
export function dailyFinances(s, agg) {
  const t = s.taxRates;
  const incomeCents =
    agg.households * t.R * TAX_BASE_CENTS.R +
    agg.jobs.C * t.C * TAX_BASE_CENTS.C +
    agg.jobs.I * t.I * TAX_BASE_CENTS.I;
  const expensesCents = s.upkeepCents;
  s.fundsCents += incomeCents - expensesCents;
  s.lastDaily = { incomeCents, expensesCents };
  return s.lastDaily;
}

export function isValidTax(pct) {
  return Number.isInteger(pct) && pct >= 0 && pct <= MAX_TAX;
}

/** Low-funds / debt notifications, latched so they fire once per crossing. */
export function checkFunds(s, notify) {
  const funds = s.fundsCents / 100;
  if (funds < LOW_FUNDS_THRESHOLD) {
    if (!s.alerts.lowFunds) {
      s.alerts.lowFunds = true;
      notify('warn', `Funds are low: $${Math.floor(funds).toLocaleString('en-US')}. Raise taxes or cut road upkeep.`);
    }
  } else {
    s.alerts.lowFunds = false;
  }
  if (funds < 0) {
    if (!s.alerts.inDebt) {
      s.alerts.inDebt = true;
      notify('alert', 'The city is in debt.');
    }
  } else {
    s.alerts.inDebt = false;
  }
}
