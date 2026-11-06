// Бизнес-логика: пары, профили, «Думаю о тебе», состояние главного экрана.
// Календарь — в events.js, питомец — в pet.js. Роуты в server.js только вызывают эти функции.
import crypto from 'node:crypto';
import { query, tx } from './db.js';
import { cfg, inviteLink, shareUrl, isAdmin } from './config.js';
import { todayStr, daysBetween, addDays, diffYMD, isValidDate } from './dates.js';
import { milestoneInfo } from './milestones.js';
import { upcoming, calendarItems, weddingInfo } from './calendar.js';
import { PHRASES } from './content.js';
import { cleanName, parseAge, parseGender, pick, esc } from './util.js';
import { notify, openAppKb } from './bot.js';
import { HttpError } from './errors.js';
import { loadPairContext, loadActiveContext } from './context.js';
import { loadEvents } from './events.js';
import { petSummary } from './pet.js';

export { HttpError };

const CODE_RE = /^[A-Za-z0-9_-]{6,16}$/;
const MIN_DATE = '1950-01-01';

/* ---------- проверки ---------- */

/** Дата начала отношений: корректная, не раньше 1950 и не «завтра» (запас в сутки: у человека «сегодня» может быть впереди APP_TZ). */
function checkStartDate(startDate) {
  if (!isValidDate(startDate) || startDate > addDays(todayStr(), 1) || startDate < MIN_DATE) throw new HttpError(400, 'bad_date');
}

/** Дата свадьбы: необязательная (пусто → null). Не раньше начала отношений, не дальше 20 лет вперёд. */
export function parseWedding(raw, startDate) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (!isValidDate(raw) || raw < startDate || raw > addDays(todayStr(), 365 * 20)) throw new HttpError(400, 'bad_wedding');
  return raw;
}

/** Имя, возраст и пол: все три обязательны при регистрации. */
function checkProfile({ name, age, gender }) {
  const cleanN = cleanName(name);
  if (!cleanN) throw new HttpError(400, 'bad_name');
  const ageN = parseAge(age);
  if (ageN === null) throw new HttpError(400, 'bad_age');
  const genderV = parseGender(gender);
  if (!genderV) throw new HttpError(400, 'bad_gender');
  return { name: cleanN, age: ageN, gender: genderV };
}

/* ---------- создание пары и приглашение ---------- */

export async function createPair(tgUser, body = {}) {
  const profile = checkProfile(body);
  checkStartDate(body.startDate);
  const weddingDate = parseWedding(body.weddingDate, body.startDate);

  await tx(async (c) => {
    const existing = await c.query('SELECT pair_id FROM users WHERE id = $1 FOR UPDATE', [tgUser.id]);
    if (existing.rows[0]?.pair_id) throw new HttpError(409, 'already_in_pair');

    const code = crypto.randomBytes(6).toString('base64url'); // 8 символов, подходит для startapp
    const pair = await c.query('INSERT INTO pairs(code, start_date, wedding_date, owner_id) VALUES ($1, $2, $3, $4) RETURNING id', [
      code,
      body.startDate,
      weddingDate,
      tgUser.id,
    ]);
    await c.query(
      `INSERT INTO users(id, name, age, gender, pair_id, can_notify) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, age = EXCLUDED.age, gender = EXCLUDED.gender, pair_id = EXCLUDED.pair_id`,
      [tgUser.id, profile.name, profile.age, profile.gender, pair.rows[0].id, tgUser.allows_write_to_pm === true],
    );
  });
}

/** Что показать человеку, открывшему приглашение. */
export async function getInvite(user, code) {
  if (!CODE_RE.test(code || '')) return { valid: false, reason: 'not_found' };
  if (user?.pair_id) return { valid: false, reason: 'already_in_pair' };
  const pair = (await query('SELECT * FROM pairs WHERE code = $1', [code])).rows[0];
  if (!pair) return { valid: false, reason: 'not_found' };
  if (pair.joined_at) return { valid: false, reason: 'used' };
  const owner = (await query('SELECT name FROM users WHERE id = $1', [pair.owner_id])).rows[0];
  return { valid: true, inviter: owner?.name || '' };
}

export async function joinPair(tgUser, body = {}) {
  const { code } = body;
  const profile = checkProfile(body);
  if (!CODE_RE.test(code || '')) throw new HttpError(404, 'invite_not_found');

  const owner = await tx(async (c) => {
    const existing = await c.query('SELECT pair_id FROM users WHERE id = $1 FOR UPDATE', [tgUser.id]);
    if (existing.rows[0]?.pair_id) throw new HttpError(409, 'already_in_pair');

    const pair = (await c.query('SELECT * FROM pairs WHERE code = $1 FOR UPDATE', [code])).rows[0];
    if (!pair) throw new HttpError(404, 'invite_not_found');
    if (pair.joined_at) throw new HttpError(409, 'invite_used');
    if (pair.owner_id === tgUser.id) throw new HttpError(400, 'own_invite');

    await c.query(
      `INSERT INTO users(id, name, age, gender, pair_id, can_notify) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, age = EXCLUDED.age, gender = EXCLUDED.gender, pair_id = EXCLUDED.pair_id`,
      [tgUser.id, profile.name, profile.age, profile.gender, pair.id, tgUser.allows_write_to_pm === true],
    );
    await c.query('UPDATE pairs SET joined_at = now() WHERE id = $1', [pair.id]);
    return (await c.query('SELECT id, name FROM users WHERE id = $1', [pair.owner_id])).rows[0];
  });

  if (owner) {
    await notify(
      owner.id,
      `🎉 <b>${esc(profile.name)}</b> теперь с тобой в «Двое»!\n\nВаш общий мир открыт. Загляни — можно завести питомца и отметить памятные даты.`,
      openAppKb(),
    );
  }
}

/* ---------- состояние для главного экрана ---------- */

async function thoughtState(user, pair) {
  const total = cfg.thoughtCooldownMin * 60;
  const last = (
    await query(
      `SELECT EXTRACT(EPOCH FROM (now() - created_at)) AS ago
       FROM thoughts WHERE from_user = $1 ORDER BY created_at DESC LIMIT 1`,
      [user.id],
    )
  ).rows[0];
  const cooldownSec = last ? Math.max(0, Math.ceil(total - Number(last.ago))) : 0;

  const received = (
    await query(
      `SELECT phrase, EXTRACT(EPOCH FROM (now() - created_at)) AS ago
       FROM thoughts WHERE pair_id = $1 AND from_user <> $2 ORDER BY created_at DESC LIMIT 1`,
      [pair.id, user.id],
    )
  ).rows[0];

  return {
    cooldownSec,
    cooldownTotalSec: total,
    received: received ? { phrase: received.phrase, agoSec: Math.floor(Number(received.ago)) } : null,
  };
}

const profileComplete = (u) => u.age != null && Boolean(u.gender);
const person = (u) => ({ name: u.name, age: u.age ?? null, gender: u.gender ?? null });

export async function buildState(user, tgUser) {
  const today = todayStr();
  if (!user || !user.pair_id) {
    return { status: 'none', today, prefillName: tgUser?.first_name || '', isAdmin: isAdmin(tgUser?.id) };
  }
  const { pair, partner } = await loadPairContext(user);
  const active = Boolean(pair.joined_at && partner);

  const events = await loadEvents(pair.id);
  const ms = milestoneInfo(pair.start_date, today);
  const nextItem = upcoming(pair, events, today, { limit: 1, includeToday: false })[0] || null;
  // Полоска прогресса есть только у «красивых чисел» — у остальных дат нет понятного «начала пути».
  const progress = nextItem && ms.next && nextItem.key === `ms:${ms.next.id}` ? ms.next.progress : null;

  const home = {
    days: Math.max(0, daysBetween(pair.start_date, today)),
    breakdown: diffYMD(pair.start_date, today),
    startDate: pair.start_date,
    wedding: weddingInfo(pair.wedding_date, today),
    todayItems: calendarItems(pair, events, today, today)
      .slice(0, 3)
      .map((i) => ({ kind: i.kind, title: i.title, emoji: i.emoji, years: i.years })),
    next: nextItem
      ? { kind: nextItem.kind, title: nextItem.title, emoji: nextItem.emoji, date: nextItem.date, daysLeft: nextItem.daysLeft, years: nextItem.years, progress }
      : null,
    thought: null,
    pet: null,
  };
  if (active) {
    home.thought = await thoughtState(user, pair);
    home.pet = await petSummary(pair.id);
  }

  const isOwner = pair.owner_id === user.id;
  const link = !active && isOwner ? inviteLink(pair.code) : null;

  return {
    status: active ? 'active' : 'waiting',
    today,
    isAdmin: isAdmin(user.id),
    me: { id: user.id, ...person(user), isOwner, canNotify: user.can_notify, profileComplete: profileComplete(user) },
    partner: partner ? person(partner) : null,
    pair: { startDate: pair.start_date, weddingDate: pair.wedding_date || null, inviteLink: link, shareUrl: link ? shareUrl(link) : null },
    home,
  };
}

/* ---------- «Думаю о тебе» ---------- */

export async function sendThought(user) {
  const { pair, partner } = await loadActiveContext(user);
  const cooldownSec = cfg.thoughtCooldownMin * 60;

  // Берём фразу, которой не было среди последних 12 отправленных этим человеком.
  const recent = (
    await query('SELECT phrase FROM thoughts WHERE from_user = $1 ORDER BY created_at DESC LIMIT 12', [user.id])
  ).rows.map((r) => r.phrase);
  const fresh = PHRASES.filter((p) => !recent.includes(p));
  const phrase = pick(fresh.length ? fresh : PHRASES);

  // Проверка кулдауна и вставка — атомарно (блокировка по id пользователя защищает от двойного тапа).
  const inserted = await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1::bigint)', [user.id]);
    const r = await c.query(
      `INSERT INTO thoughts(pair_id, from_user, phrase)
       SELECT $1::bigint, $2::bigint, $3::text
       WHERE NOT EXISTS (
         SELECT 1 FROM thoughts
         WHERE from_user = $2::bigint AND created_at > now() - ($4::int * interval '1 second')
       )`,
      [pair.id, user.id, phrase, cooldownSec],
    );
    return r.rowCount === 1;
  });

  if (!inserted) {
    const st = await thoughtState(user, pair);
    throw new HttpError(429, 'cooldown', { cooldownSec: st.cooldownSec });
  }

  const delivered = await notify(
    partner.id,
    `💌 <b>${esc(user.name)}</b> думает о тебе\n\n<i>«${esc(phrase)}»</i>`,
    openAppKb(),
  );
  return { phrase, delivered, cooldownSec };
}

/* ---------- профиль и настройки ---------- */

/** Обновить свой профиль: любые из name / age / gender (так же дополняют профиль те, кто регистрировался раньше). */
export async function updateProfile(user, body = {}) {
  const sets = [];
  const values = [user.id];
  const add = (column, value) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) throw new HttpError(400, 'bad_name');
    add('name', name);
  }
  if (body.age !== undefined) {
    const age = parseAge(body.age);
    if (age === null) throw new HttpError(400, 'bad_age');
    add('age', age);
  }
  if (body.gender !== undefined) {
    const gender = parseGender(body.gender);
    if (!gender) throw new HttpError(400, 'bad_gender');
    add('gender', gender);
  }
  if (!sets.length) throw new HttpError(400, 'nothing_to_update');
  await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, values);
}

/** Даты пары (только создатель): startDate и/или weddingDate (пустая строка или null — убрать дату свадьбы). */
export async function updatePairDates(user, body = {}) {
  const { pair } = await loadPairContext(user);
  if (pair.owner_id !== user.id) throw new HttpError(403, 'owner_only');

  const startDate = body.startDate !== undefined ? body.startDate : pair.start_date;
  checkStartDate(startDate);
  const weddingRaw = body.weddingDate !== undefined ? body.weddingDate : pair.wedding_date;
  const weddingDate = parseWedding(weddingRaw, startDate);

  await query('UPDATE pairs SET start_date = $2, wedding_date = $3 WHERE id = $1', [pair.id, startDate, weddingDate]);
}

export async function allowNotifications(user) {
  await query('UPDATE users SET can_notify = TRUE WHERE id = $1', [user.id]);
}
