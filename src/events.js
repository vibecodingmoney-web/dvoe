// Календарь памятных дат: события пары (создаёт любой из двоих) + авто-даты.
import { query, claim } from './db.js';
import { HttpError } from './errors.js';
import { loadPairContext } from './context.js';
import { todayStr, addDays, daysInMonth, isValidDate, fmtDateRu } from './dates.js';
import { calendarItems, expandEvents, upcoming } from './calendar.js';
import { cleanText, esc, verb } from './util.js';
import { notify, openAppKb } from './bot.js';

const MIN_DATE = '1950-01-01';
const MAX_EVENTS = 150;
const REPEATS = ['none', 'yearly'];

export async function loadEvents(pairId) {
  return (await query('SELECT * FROM events WHERE pair_id = $1 ORDER BY on_date, id', [pairId])).rows;
}

/** Проверка и очистка данных события. Бросает HttpError 400 с понятным кодом. */
export function normalizeEventInput(input, today) {
  const title = cleanText(input?.title, 40);
  if (!title) throw new HttpError(400, 'bad_title');

  const onDate = input?.date;
  if (!isValidDate(onDate) || onDate < MIN_DATE || onDate > addDays(today, 365 * 30)) throw new HttpError(400, 'bad_date');

  const repeat = input?.repeat === undefined ? 'none' : input.repeat;
  if (!REPEATS.includes(repeat)) throw new HttpError(400, 'bad_repeat');

  // Эмодзи — одна «картинка»: берём только если в строке есть настоящий эмодзи и она короткая.
  const rawEmoji = typeof input?.emoji === 'string' ? input.emoji.trim() : '';
  const emoji = rawEmoji.length > 0 && rawEmoji.length <= 12 && /\p{Extended_Pictographic}/u.test(rawEmoji) && !/[<>&"]/.test(rawEmoji) ? rawEmoji : '💞';

  return {
    title,
    emoji,
    on_date: onDate,
    repeat_kind: repeat,
    note: cleanText(input?.note, 140),
    remind: input?.remind !== false,
  };
}

/** Поля даты, которые уходят в приложение. */
const publicItem = (i) => ({
  key: i.key,
  kind: i.kind,
  id: i.id,
  date: i.date,
  base: i.base,
  title: i.title,
  emoji: i.emoji,
  note: i.note,
  years: i.years,
  repeat: i.repeat,
  remind: i.remind,
  editable: i.editable,
});

/** Данные для вкладки «Календарь»: даты выбранного месяца + ближайшие. */
export async function getCalendar(user, monthParam) {
  const { pair } = await loadPairContext(user);
  const today = todayStr();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam || '') ? monthParam : today.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`;

  const events = await loadEvents(pair.id);
  const items = calendarItems(pair, events, from, to).map(publicItem);
  const soon = upcoming(pair, events, today, { limit: 6 }).map((i) => ({ ...publicItem(i), daysLeft: i.daysLeft }));
  return { month, today, items, upcoming: soon, eventsCount: events.length };
}

export async function createEvent(user, input) {
  const { pair, partner } = await loadPairContext(user);
  const today = todayStr();
  const data = normalizeEventInput(input, today);

  const count = (await query('SELECT count(*)::int AS n FROM events WHERE pair_id = $1', [pair.id])).rows[0].n;
  if (count >= MAX_EVENTS) throw new HttpError(409, 'too_many');

  const row = (
    await query(
      `INSERT INTO events(pair_id, title, emoji, on_date, repeat_kind, note, remind, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [pair.id, data.title, data.emoji, data.on_date, data.repeat_kind, data.note, data.remind, user.id],
    )
  ).rows[0];

  // Человек только что сам добавил дату — напоминание «сегодня/завтра» сразу после этого не нужно.
  const tomorrow = addDays(today, 1);
  for (const o of expandEvents([row], today, tomorrow)) {
    await claim(`evr:${pair.id}:${o.key}:${o.date}:${o.date === today ? '0' : '1'}`);
  }

  if (partner && pair.joined_at) {
    await notify(
      partner.id,
      `📅 <b>${esc(user.name)}</b> ${verb(user.gender, 'добавил')} в календарь:\n${row.emoji} <b>${esc(row.title)}</b> — ${esc(fmtDateRu(row.on_date))}`,
      openAppKb('Открыть календарь'),
    );
  }
  return { id: row.id };
}

export async function updateEvent(user, id, input) {
  const { pair } = await loadPairContext(user);
  const data = normalizeEventInput(input, todayStr());
  const r = await query(
    `UPDATE events SET title = $3, emoji = $4, on_date = $5, repeat_kind = $6, note = $7, remind = $8
     WHERE id = $1 AND pair_id = $2`,
    [id, pair.id, data.title, data.emoji, data.on_date, data.repeat_kind, data.note, data.remind],
  );
  if (r.rowCount === 0) throw new HttpError(404, 'not_found');
}

export async function deleteEvent(user, id) {
  const { pair } = await loadPairContext(user);
  const r = await query('DELETE FROM events WHERE id = $1 AND pair_id = $2', [id, pair.id]);
  if (r.rowCount === 0) throw new HttpError(404, 'not_found');
}
