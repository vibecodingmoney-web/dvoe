// Годовщины и «красивые» даты. Считаются автоматически от даты начала отношений.
import { addDays, addMonths, daysBetween } from './dates.js';
import { plural } from './util.js';

// 365 и 730 дней сюда не входят: их заменяет календарная годовщина.
const DAY_MARKS = [100, 111, 200, 222, 300, 333, 444, 500, 555, 666, 700, 777, 800, 888, 900, 999, 1000, 1111, 1234, 1500, 2000, 2222, 2500, 3000, 3333, 4000, 5000];

const MONTH_MARKS = [
  { m: 1, title: 'Месяц вместе' },
  { m: 3, title: '3 месяца вместе' },
  { m: 6, title: 'Полгода вместе' },
  { m: 9, title: '9 месяцев вместе' },
];

/** Полный отсортированный список дат пары: [{ id, title, date, days }] */
export function buildMilestones(start) {
  const list = [];
  for (const n of DAY_MARKS) {
    list.push({ id: `d${n}`, title: `${n} ${plural(n, ['день', 'дня', 'дней'])} вместе`, date: addDays(start, n), days: n });
  }
  for (const { m, title } of MONTH_MARKS) {
    const date = addMonths(start, m);
    list.push({ id: `m${m}`, title, date, days: daysBetween(start, date) });
  }
  for (let y = 1; y <= 50; y += 1) {
    const date = addMonths(start, 12 * y);
    const title = y === 1 ? 'Год вместе' : `${y} ${plural(y, ['год', 'года', 'лет'])} вместе`;
    list.push({ id: `y${y}`, title, date, days: daysBetween(start, date) });
  }
  list.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return list;
}

/** Данные для экрана: ближайшая дата с прогрессом, список будущих и прошлых, сегодняшний праздник. */
export function milestoneInfo(start, today) {
  const all = buildMilestones(start);
  const past = all.filter((m) => m.date <= today);
  const upcoming = all.filter((m) => m.date > today);
  const todayOnes = all.filter((m) => m.date === today);

  let next = null;
  if (upcoming.length) {
    const n = upcoming[0];
    const prevDate = past.length ? past[past.length - 1].date : start;
    const total = Math.max(1, daysBetween(prevDate, n.date));
    const done = Math.min(total, Math.max(0, daysBetween(prevDate, today)));
    next = { ...n, daysLeft: daysBetween(today, n.date), progress: done / total };
  }

  return {
    today: todayOnes.length ? todayOnes[0] : null,
    next,
    upcoming: upcoming.slice(0, 8).map((m) => ({ ...m, daysLeft: daysBetween(today, m.date) })),
    past: past
      .slice(-6)
      .reverse()
      .map((m) => ({ ...m, daysAgo: daysBetween(m.date, today) })),
  };
}
