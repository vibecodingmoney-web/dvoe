// Бизнес-логика: пары, вопрос дня, «Думаю о тебе». Роуты в server.js только вызывают эти функции.
import crypto from 'node:crypto';
import { query, tx } from './db.js';
import { cfg, inviteLink, shareUrl } from './config.js';
import { todayStr, daysBetween, addDays, diffYMD, isValidDate } from './dates.js';
import { milestoneInfo } from './milestones.js';
import { PHRASES, QUESTIONS } from './content.js';
import { cleanName, pick, esc } from './util.js';
import { notify, openAppKb } from './bot.js';

export class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const CODE_RE = /^[A-Za-z0-9_-]{6,16}$/;
const MIN_DATE = '1950-01-01';
// «Сегодня» у человека может быть на день впереди, чем в APP_TZ — разрешаем запас в сутки.
const MAX_ANSWER = 600;

/* ---------- общие помощники ---------- */

export async function getMembers(pairId) {
  const r = await query('SELECT id, name FROM users WHERE pair_id = $1 ORDER BY created_at, id', [pairId]);
  return r.rows;
}

/** Вопрос дня для пары: нумерация идёт от дня, когда присоединился Б. */
export function questionFor(joinedOn, date) {
  if (!joinedOn) return null;
  const n = daysBetween(joinedOn, date);
  if (n < 0) return null;
  const index = n % QUESTIONS.length;
  return { number: n + 1, index, text: QUESTIONS[index] };
}

/** Серия дней подряд, когда оба ответили на вопрос. Сегодняшний день не обрывает серию, пока не закончился. */
export async function computeStreak(pairId, today) {
  const r = await query(
    `SELECT q_date FROM answers WHERE pair_id = $1
     GROUP BY q_date HAVING COUNT(*) = 2
     ORDER BY q_date DESC LIMIT 400`,
    [pairId],
  );
  const days = new Set(r.rows.map((x) => x.q_date));
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

async function loadPairContext(user) {
  if (!user || !user.pair_id) throw new HttpError(409, 'no_pair');
  const pair = (await query('SELECT * FROM pairs WHERE id = $1', [user.pair_id])).rows[0];
  if (!pair) throw new HttpError(409, 'no_pair');
  const members = await getMembers(pair.id);
  const partner = members.find((m) => m.id !== user.id) || null;
  return { pair, partner };
}

async function loadActiveContext(user) {
  const ctx = await loadPairContext(user);
  if (!ctx.pair.joined_at || !ctx.partner) throw new HttpError(409, 'not_active');
  return ctx;
}

/* ---------- создание пары и приглашение ---------- */

export async function createPair(tgUser, rawName, startDate) {
  const name = cleanName(rawName);
  if (!name) throw new HttpError(400, 'bad_name');
  if (!isValidDate(startDate) || startDate > addDays(todayStr(), 1) || startDate < MIN_DATE) throw new HttpError(400, 'bad_date');

  await tx(async (c) => {
    const existing = await c.query('SELECT pair_id FROM users WHERE id = $1 FOR UPDATE', [tgUser.id]);
    if (existing.rows[0]?.pair_id) throw new HttpError(409, 'already_in_pair');

    const code = crypto.randomBytes(6).toString('base64url'); // 8 символов, подходит для startapp
    const pair = await c.query('INSERT INTO pairs(code, start_date, owner_id) VALUES ($1, $2, $3) RETURNING id', [
      code,
      startDate,
      tgUser.id,
    ]);
    await c.query(
      `INSERT INTO users(id, name, pair_id, can_notify) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, pair_id = EXCLUDED.pair_id`,
      [tgUser.id, name, pair.rows[0].id, tgUser.allows_write_to_pm === true],
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

export async function joinPair(tgUser, code, rawName) {
  const name = cleanName(rawName);
  if (!name) throw new HttpError(400, 'bad_name');
  if (!CODE_RE.test(code || '')) throw new HttpError(404, 'invite_not_found');
  const today = todayStr();

  const owner = await tx(async (c) => {
    const existing = await c.query('SELECT pair_id FROM users WHERE id = $1 FOR UPDATE', [tgUser.id]);
    if (existing.rows[0]?.pair_id) throw new HttpError(409, 'already_in_pair');

    const pair = (await c.query('SELECT * FROM pairs WHERE code = $1 FOR UPDATE', [code])).rows[0];
    if (!pair) throw new HttpError(404, 'invite_not_found');
    if (pair.joined_at) throw new HttpError(409, 'invite_used');
    if (pair.owner_id === tgUser.id) throw new HttpError(400, 'own_invite');

    await c.query(
      `INSERT INTO users(id, name, pair_id, can_notify) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, pair_id = EXCLUDED.pair_id`,
      [tgUser.id, name, pair.id, tgUser.allows_write_to_pm === true],
    );
    await c.query('UPDATE pairs SET joined_at = now(), joined_on = $2 WHERE id = $1', [pair.id, today]);
    return (await c.query('SELECT id, name FROM users WHERE id = $1', [pair.owner_id])).rows[0];
  });

  if (owner) {
    await notify(
      owner.id,
      `🎉 <b>${esc(name)}</b> теперь с тобой в «Двое»!\n\nВаш общий мир открыт. Загляни — там уже ждёт вопрос дня.`,
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

export async function buildState(user, tgUser) {
  if (!user || !user.pair_id) {
    return { status: 'none', prefillName: tgUser?.first_name || '' };
  }
  const { pair, partner } = await loadPairContext(user);
  const active = Boolean(pair.joined_at && partner);
  const today = todayStr();
  const ms = milestoneInfo(pair.start_date, today);

  const home = {
    days: Math.max(0, daysBetween(pair.start_date, today)),
    breakdown: diffYMD(pair.start_date, today),
    startDate: pair.start_date,
    today: ms.today,
    next: ms.next,
    upcoming: ms.upcoming,
    past: ms.past,
    streak: 0,
    thought: null,
  };
  if (active) {
    home.streak = await computeStreak(pair.id, today);
    home.thought = await thoughtState(user, pair);
  }

  const isOwner = pair.owner_id === user.id;
  const link = !active && isOwner ? inviteLink(pair.code) : null;

  return {
    status: active ? 'active' : 'waiting',
    me: { id: user.id, name: user.name, isOwner, canNotify: user.can_notify },
    partner: partner ? { name: partner.name } : null,
    pair: { startDate: pair.start_date, inviteLink: link, shareUrl: link ? shareUrl(link) : null },
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

/* ---------- вопрос дня ---------- */

export async function getQuestionState(user) {
  const { pair, partner } = await loadActiveContext(user);
  const today = todayStr();
  const q = questionFor(pair.joined_on, today);
  if (!q) throw new HttpError(409, 'no_question');

  const rows = (await query('SELECT user_id, body FROM answers WHERE pair_id = $1 AND q_date = $2', [pair.id, today])).rows;
  const mine = rows.find((r) => r.user_id === user.id) || null;
  const theirs = rows.find((r) => r.user_id === partner.id) || null;

  return {
    date: today,
    number: q.number,
    text: q.text,
    mine: mine ? mine.body : null,
    partnerAnswered: Boolean(theirs),
    // Ответ любимого человека показываем только после собственного ответа.
    theirs: mine && theirs ? theirs.body : null,
  };
}

export async function answerQuestion(user, text) {
  const { pair, partner } = await loadActiveContext(user);
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) throw new HttpError(400, 'empty');
  if (body.length > MAX_ANSWER) throw new HttpError(400, 'too_long');

  const today = todayStr();
  if (!questionFor(pair.joined_on, today)) throw new HttpError(409, 'no_question');

  const ins = await query(
    'INSERT INTO answers(pair_id, q_date, user_id, body) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [pair.id, today, user.id, body],
  );
  if (ins.rowCount === 0) throw new HttpError(409, 'already_answered');

  const other = await query('SELECT 1 FROM answers WHERE pair_id = $1 AND q_date = $2 AND user_id = $3', [
    pair.id,
    today,
    partner.id,
  ]);
  if (other.rowCount > 0) {
    // Любимый человек ответил раньше — сообщаем ему, что ответы открылись.
    await notify(partner.id, '✨ Вы оба ответили на вопрос дня — ответы открыты!\n\nЗагляни, это приятно 💞', openAppKb('Посмотреть ответы'));
  }
  return getQuestionState(user);
}

/** Прошлые дни, когда ответили оба (последние 30). */
export async function getQuestionHistory(user) {
  const { pair, partner } = await loadActiveContext(user);
  const today = todayStr();
  const rows = (
    await query(
      `SELECT q_date, user_id, body FROM answers
       WHERE pair_id = $1 AND q_date < $2
         AND q_date IN (SELECT q_date FROM answers WHERE pair_id = $1 GROUP BY q_date HAVING COUNT(*) = 2)
       ORDER BY q_date DESC LIMIT 60`,
      [pair.id, today],
    )
  ).rows;

  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.q_date)) byDate.set(r.q_date, {});
    byDate.get(r.q_date)[r.user_id === user.id ? 'mine' : 'theirs'] = r.body;
  }
  return [...byDate.entries()].slice(0, 30).map(([date, a]) => {
    const q = questionFor(pair.joined_on, date);
    return { date, number: q?.number ?? null, text: q?.text ?? '', mine: a.mine ?? '', theirs: a.theirs ?? '', partnerName: partner.name };
  });
}

/* ---------- профиль и настройки ---------- */

export async function updateName(user, rawName) {
  const name = cleanName(rawName);
  if (!name) throw new HttpError(400, 'bad_name');
  await query('UPDATE users SET name = $2 WHERE id = $1', [user.id, name]);
}

export async function updateStartDate(user, startDate) {
  const { pair } = await loadPairContext(user);
  if (pair.owner_id !== user.id) throw new HttpError(403, 'owner_only');
  if (!isValidDate(startDate) || startDate > addDays(todayStr(), 1) || startDate < MIN_DATE) throw new HttpError(400, 'bad_date');
  await query('UPDATE pairs SET start_date = $2 WHERE id = $1', [pair.id, startDate]);
}

export async function allowNotifications(user) {
  await query('UPDATE users SET can_notify = TRUE WHERE id = $1', [user.id]);
}
