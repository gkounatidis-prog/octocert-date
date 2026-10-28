export function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Athens' }).format(new Date());
}
export function daysUntil(date, base = today()) {
  return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(base + 'T00:00:00Z')) / 86400000);
}
export function status(date, base = today()) {
  const days = daysUntil(date, base);
  return days < 0 ? 'late' : days <= 30 ? 'soon' : 'ok';
}
export function normalize(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('el').replace(/ς/g, 'σ');
}
export function matches(record, query) {
  return normalize([record.client, record.facility, record.number].join(' ')).includes(normalize(query.trim()));
}
export function validate(input) {
  const record = {};
  for (const [key, max] of [['client', 120], ['facility', 160], ['number', 80]]) {
    record[key] = String(input[key] ?? '').trim();
    if (!record[key] || record[key].length > max) throw new Error('Συμπληρώστε σωστά όλα τα πεδία κειμένου.');
  }
  for (const key of ['issued', 'due']) {
    const date = input[key];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) {
      throw new Error('Συμπληρώστε έγκυρες ημερομηνίες.');
    }
    record[key] = date;
  }
  if (record.due < record.issued) throw new Error('Ο επανέλεγχος δεν μπορεί να είναι πριν από την έκδοση.');
  return record;
}
