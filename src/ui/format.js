// Display formatting only. Never derives simulation figures.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatMoney(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '−' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

export function formatSignedMoney(n) {
  if (n == null || Number.isNaN(n)) return '—';
  if (n > 0) return `+${formatMoney(n)}`;
  return formatMoney(n);
}

export function formatInt(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

export function formatDate(t) {
  if (!t) return '—';
  return `${t.day} ${MONTHS[(t.month - 1) % 12] ?? t.month}, Year ${t.year}`;
}

export function formatHour(h) {
  return `${String(h ?? 0).padStart(2, '0')}:00`;
}

export function formatRelative(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const ZONE_NAMES = { R: 'Residential', C: 'Commercial', I: 'Industrial' };
