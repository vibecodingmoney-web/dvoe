// Работа с датами. Все даты в приложении — строки 'YYYY-MM-DD' в одном часовом поясе (APP_TZ).
// Пользователей мы о часовом поясе не спрашиваем: «сегодня» и «10:00» считаются по APP_TZ.

function resolveTz(name) {
  for (const candidate of [name, 'Europe/Kyiv', 'Europe/Kiev', 'UTC']) {
    if (!candidate) continue;
    try {
      new Intl.DateTimeFormat('en', { timeZone: candidate });
      return candidate;
    } catch {
      /* пробуем следующий */
    }
  }
  return 'UTC';
}

export const APP_TZ = resolveTz(process.env.APP_TZ);

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Текущее время в APP_TZ: { date: '2026-11-05', hour: 10, minute: 3, weekday: 0..6 (0 = воскресенье) } */
export function nowInTz(at = new Date()) {
  const p = Object.fromEntries(formatter.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

export const todayStr = () => nowInTz().date;

const DAY_MS = 86400000;

export function dayNum(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Сколько дней от a до b (b позже a — положительное число). */
export function daysBetween(a, b) {
  return dayNum(b) - dayNum(a);
}

export function addDays(dateStr, n) {
  return new Date((dayNum(dateStr) + n) * DAY_MS).toISOString().slice(0, 10);
}

export function daysInMonth(year, month1to12) {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** Прибавить месяцы; 31 января + 1 месяц = 28/29 февраля (не перескакиваем в март). */
export function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Разница «N лет M месяцев K дней» между двумя датами (from <= to). Согласована с addMonths (годовщины). */
export function diffYMD(from, to) {
  if (to < from) return { years: 0, months: 0, days: 0 };
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (months > 0 && addMonths(from, months) > to) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12, days: daysBetween(addMonths(from, months), to) };
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** '2026-11-05' -> '5 ноября 2026' (для сообщений бота) */
export function fmtDateRu(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]} ${y}`;
}
