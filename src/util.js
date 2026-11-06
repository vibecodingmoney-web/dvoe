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

/** Короткий текст от пользователя: без управляющих символов и <>, пробелы схлопнуты, не длиннее max. */
export function cleanText(raw, max) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Имя пользователя: максимум 30 символов. */
export function cleanName(raw) {
  return cleanText(raw, 30);
}

export function pick(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/* ---------- профиль ---------- */

export const MIN_AGE = 14;
export const MAX_AGE = 99;

/** Возраст: целое число MIN_AGE..MAX_AGE, иначе null. Принимает число или строку. */
export function parseAge(value) {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= MIN_AGE && n <= MAX_AGE ? n : null;
}

/** Пол: 'm' (мужской) или 'f' (женский), иначе null. */
export function parseGender(value) {
  return value === 'm' || value === 'f' ? value : null;
}

/** Глагол прошедшего времени по полу: verb('f', 'покормил') -> 'покормила'. Без пола — мужская форма. */
export function verb(gender, masculine) {
  return gender === 'f' ? `${masculine}а` : masculine;
}
