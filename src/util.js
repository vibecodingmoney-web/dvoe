// Мелкие помощники без зависимостей.

/** Экранирование для Telegram parse_mode: 'HTML' (имена и фразы приходят от пользователей!). */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** plural(5, ['день','дня','дней']) -> 'дней' */
export function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** Имя пользователя: обрезаем пробелы и управляющие символы, максимум 30 символов. */
export function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
}

export function pick(array) {
  return array[Math.floor(Math.random() * array.length)];
}
