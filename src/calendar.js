// Календарь памятных дат — чистая логика без базы (поэтому её легко тестировать).
//
// Три источника дат:
//  • события пары (таблица events): разовые или повторяющиеся каждый год;
//  • «авто»-даты: начало истории, красивые числа дней (100, 500…), месяцы и годовщины отношений;
//  • свадьба: день свадьбы и годовщины с традиционными названиями (ситцевая, бумажная…).
import { addDays, addMonths, daysBetween, daysInMonth, diffYMD } from './dates.js';
import { buildMilestones } from './milestones.js';
import { plural } from './util.js';

const YEARS = ['год', 'года', 'лет'];

/** Традиционные названия годовщин свадьбы. */
export const WEDDING_NAMES = {
  1: 'ситцевая', 2: 'бумажная', 3: 'кожаная', 4: 'льняная', 5: 'деревянная', 6: 'чугунная', 7: 'медная', 8: 'жестяная',
  9: 'фаянсовая', 10: 'розовая', 11: 'стальная', 12: 'никелевая', 13: 'кружевная', 14: 'агатовая', 15: 'хрустальная',
  20: 'фарфоровая', 25: 'серебряная', 30: 'жемчужная', 35: 'коралловая', 40: 'рубиновая', 45: 'сапфировая',
  50: 'золотая', 55: 'изумрудная', 60: 'бриллиантовая',
};

export function weddingTitle(years) {
  const name = WEDDING_NAMES[years];
  const base = `Годовщина свадьбы: ${years} ${plural(years, YEARS)}`;
  return name ? `${base} (${name})` : base;
}

/** Тот же день в другом году; 29 февраля в невисокосный год превращается в 28 февраля. */
export function sameDayInYear(dateStr, year) {
  const [, m, d] = dateStr.split('-').map(Number);
  const day = Math.min(d, daysInMonth(year, m));
  return `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const eventOcc = (e, date, years) => ({
  key: `e${e.id}`,
  kind: 'event',
  id: e.id,
  date,
  base: e.on_date, // исходная дата события (для повторяющихся она не совпадает с date)
  title: e.title,
  emoji: e.emoji,
  note: e.note || '',
  years,
  repeat: e.repeat_kind,
  remind: Boolean(e.remind),
  editable: true,
});

const autoOcc = (key, date, title, emoji, years = null) => ({
  key,
  kind: 'auto',
  id: null,
  date,
  base: date,
  title,
  emoji,
  note: '',
  years,
  repeat: 'none',
  remind: true,
  editable: false,
});

/**
 * Развернуть события в даты внутри [from, to] (включительно).
 * Строки событий — как в БД: { id, title, emoji, on_date, repeat_kind: 'none'|'yearly', note, remind }.
 * Для повторяющихся years — сколько лет прошло с первой даты (на самой первой дате — null).
 */
export function expandEvents(events, from, to) {
  const out = [];
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  for (const e of events) {
    const base = e.on_date;
    if (e.repeat_kind === 'yearly') {
      const baseYear = Number(base.slice(0, 4));
      for (let y = Math.max(fromYear, baseYear); y <= toYear; y += 1) {
        const date = sameDayInYear(base, y);
        if (date >= from && date <= to) out.push(eventOcc(e, date, y - baseYear || null));
      }
    } else if (base >= from && base <= to) {
      out.push(eventOcc(e, base, null));
    }
  }
  return out;
}

/** День свадьбы и её годовщины внутри [from, to]. */
export function weddingOccurrences(wedding, from, to) {
  const out = [];
  if (!wedding) return out;
  if (wedding >= from && wedding <= to) out.push(autoOcc('wed', wedding, 'День свадьбы', '💒'));
  for (let y = 1; y <= 60; y += 1) {
    const date = addMonths(wedding, 12 * y);
    if (date > to) break;
    if (date >= from) out.push(autoOcc(`wed${y}`, date, weddingTitle(y), '💍', y));
  }
  return out;
}

/** Автоматические даты пары: начало истории, красивые числа, годовщины отношений, свадьба. */
export function autoOccurrences(pair, from, to) {
  const out = [];
  if (pair.start_date >= from && pair.start_date <= to) out.push(autoOcc('start', pair.start_date, 'Начало нашей истории', '💞'));
  for (const m of buildMilestones(pair.start_date)) {
    if (m.date >= from && m.date <= to) out.push(autoOcc(`ms:${m.id}`, m.date, m.title, m.id.startsWith('y') ? '🎉' : '✨'));
  }
  out.push(...weddingOccurrences(pair.wedding_date, from, to));
  return out;
}

const KIND_ORDER = { event: 0, auto: 1 };
const byDate = (a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title, 'ru');

/** Всё, что происходит в [from, to]: события + авто-даты, по порядку. */
export function calendarItems(pair, events, from, to) {
  return [...expandEvents(events, from, to), ...autoOccurrences(pair, from, to)].sort(byDate);
}

/** Ближайшие даты. includeToday=false — начиная с завтрашнего дня. daysLeft считается от today. */
export function upcoming(pair, events, today, { limit = 6, includeToday = true, horizon = 400 } = {}) {
  const from = includeToday ? today : addDays(today, 1);
  return calendarItems(pair, events, from, addDays(today, horizon))
    .slice(0, limit)
    .map((i) => ({ ...i, daysLeft: daysBetween(today, i.date) }));
}

/** Свадьба для главного экрана: сколько дней до неё или сколько в браке. */
export function weddingInfo(wedding, today) {
  if (!wedding) return null;
  if (wedding > today) return { date: wedding, past: false, daysLeft: daysBetween(today, wedding) };
  return { date: wedding, past: true, breakdown: diffYMD(wedding, today) };
}
