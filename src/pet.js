// Питомец пары: усыновление, забота, рост. Правила — в pet-core.js, здесь работа с базой и уведомления.
import { query, tx } from './db.js';
import { HttpError } from './errors.js';
import { loadActiveContext } from './context.js';
import { todayStr } from './dates.js';
import { cleanText, esc, verb } from './util.js';
import { notify, openAppKb } from './bot.js';
import {
  ACTIONS,
  COOLDOWN_SEC,
  FOODS,
  NAME_MAX,
  PET_TYPES,
  XP,
  applyCare,
  currentStats,
  moodOf,
  petType,
  stageOf,
} from './pet-core.js';

const PET_VERBS = { feed: 'покормил', play: 'поиграл', hug: 'обнял', warm: 'согрел' };

const sentence = (kind, who, gender, petName) => {
  const v = verb(gender, PET_VERBS[kind]);
  if (kind === 'feed') return `${who} ${v} ${petName}`;
  if (kind === 'play') return `${who} ${v} с ${petName}`;
  if (kind === 'hug') return `${who} ${v} ${petName}`;
  return `${who} ${v} яйцо`;
};

const cleanPetName = (raw, fallback) => cleanText(raw, NAME_MAX) || fallback || '';

/** Полное состояние питомца для вкладки «Питомец». */
export async function getPet(user) {
  const { pair, partner } = await loadActiveContext(user);
  const row = (await query('SELECT * FROM pets WHERE pair_id = $1', [pair.id])).rows[0];
  if (!row) return { exists: false, types: PET_TYPES };

  const now = Date.now();
  const stats = currentStats(row, now);
  const stage = stageOf(row.xp);
  const today = todayStr();

  const cooldowns = {};
  for (const kind of ['hug', 'warm']) {
    const last = (
      await query(
        `SELECT EXTRACT(EPOCH FROM (now() - created_at)) AS ago FROM pet_log
         WHERE user_id = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 1`,
        [user.id, kind],
      )
    ).rows[0];
    cooldowns[kind] = last ? Math.max(0, Math.ceil(COOLDOWN_SEC[kind] - Number(last.ago))) : 0;
  }

  const careRows = (await query('SELECT DISTINCT user_id FROM pet_log WHERE pair_id = $1 AND day = $2', [pair.id, today])).rows;
  const careIds = new Set(careRows.map((r) => r.user_id));

  const lastRow = (
    await query(
      `SELECT l.kind, l.user_id, u.name, u.gender, EXTRACT(EPOCH FROM (now() - l.created_at)) AS ago
       FROM pet_log l JOIN users u ON u.id = l.user_id
       WHERE l.pair_id = $1 ORDER BY l.created_at DESC LIMIT 1`,
      [pair.id],
    )
  ).rows[0];
  const last = lastRow
    ? {
        text: sentence(lastRow.kind, lastRow.user_id === user.id ? 'Ты' : lastRow.name, lastRow.gender, row.name),
        agoSec: Math.floor(Number(lastRow.ago)),
      }
    : null;

  return {
    exists: true,
    type: row.type,
    name: row.name,
    stage,
    xp: row.xp,
    stats: { fullness: Math.round(stats.fullness), joy: Math.round(stats.joy) },
    mood: moodOf(stats, stage.id),
    ageDays: Math.max(0, Math.floor((now - new Date(row.created_at).getTime()) / 86_400_000)),
    cooldowns,
    foods: FOODS,
    care: { me: careIds.has(user.id), partner: careIds.has(partner.id) },
    last,
  };
}

/** Краткая сводка для главного экрана. */
export async function petSummary(pairId) {
  const row = (await query('SELECT * FROM pets WHERE pair_id = $1', [pairId])).rows[0];
  if (!row) return { exists: false };
  const stats = currentStats(row);
  const stage = stageOf(row.xp);
  return {
    exists: true,
    type: row.type,
    name: row.name,
    stageId: stage.id,
    mood: moodOf(stats, stage.id),
    stats: { fullness: Math.round(stats.fullness), joy: Math.round(stats.joy) },
  };
}

export async function adoptPet(user, rawType, rawName) {
  const { pair, partner } = await loadActiveContext(user);
  const type = petType(rawType);
  if (!type) throw new HttpError(400, 'bad_pet_type');
  const name = cleanPetName(rawName, type.defaultName);

  const r = await query(
    'INSERT INTO pets(pair_id, type, name, adopted_by) VALUES ($1, $2, $3, $4) ON CONFLICT (pair_id) DO NOTHING',
    [pair.id, type.id, name, user.id],
  );
  if (r.rowCount === 0) throw new HttpError(409, 'pet_exists');

  await notify(
    partner.id,
    `🥚 <b>${esc(user.name)}</b> ${verb(user.gender, 'завёл')} вам питомца — <b>${esc(name)}</b>!\n\nПока это яйцо. Согревайте его вместе, и скоро оно проснётся.`,
    openAppKb('Согреть яйцо'),
  );
  return getPet(user);
}

export async function renamePet(user, rawName) {
  const { pair } = await loadActiveContext(user);
  const name = cleanPetName(rawName, '');
  if (!name) throw new HttpError(400, 'bad_pet_name');
  const r = await query('UPDATE pets SET name = $2 WHERE pair_id = $1', [pair.id, name]);
  if (r.rowCount === 0) throw new HttpError(404, 'no_pet');
  return getPet(user);
}

/**
 * Позаботиться о питомце: feed (покормить, нужен foodId) · play · hug · warm (согреть яйцо).
 * Всё внутри одной транзакции с блокировкой строки питомца — два тапа подряд не собьют счётчики.
 */
export async function petAction(user, kind, foodId) {
  if (!ACTIONS.includes(kind)) throw new HttpError(400, 'bad_action');
  const { pair, partner } = await loadActiveContext(user);
  const today = todayStr();
  const nowMs = Date.now();

  const done = await tx(async (c) => {
    const row = (await c.query('SELECT * FROM pets WHERE pair_id = $1 FOR UPDATE', [pair.id])).rows[0];
    if (!row) throw new HttpError(404, 'no_pet');

    const cooldown = COOLDOWN_SEC[kind];
    if (cooldown) {
      const last = (
        await c.query(
          `SELECT EXTRACT(EPOCH FROM (now() - created_at)) AS ago FROM pet_log
           WHERE user_id = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 1`,
          [user.id, kind],
        )
      ).rows[0];
      if (last && Number(last.ago) < cooldown) {
        throw new HttpError(429, 'cooldown', { cooldownSec: Math.ceil(cooldown - Number(last.ago)) });
      }
    }

    const before = stageOf(row.xp);
    const care = applyCare(kind, foodId, currentStats(row, nowMs), row.xp);
    if (!care.ok) throw new HttpError(409, `pet_${care.reason}`);

    let xp = row.xp + care.xpGain;
    let gained = care.xpGain;

    await c.query('INSERT INTO pet_log(pair_id, user_id, kind, day) VALUES ($1, $2, $3, $4)', [pair.id, user.id, kind, today]);

    // Бонус раз в день, когда позаботились оба.
    let bonus = false;
    const who = (await c.query('SELECT DISTINCT user_id FROM pet_log WHERE pair_id = $1 AND day = $2', [pair.id, today])).rows;
    if (who.length >= 2) {
      const claimed = await c.query('INSERT INTO notif_log(key) VALUES ($1) ON CONFLICT DO NOTHING', [`pb:${pair.id}:${today}`]);
      if (claimed.rowCount === 1) {
        bonus = true;
        xp += XP.bonus;
        gained += XP.bonus;
      }
    }

    await c.query('UPDATE pets SET xp = $2, fullness = $3, joy = $4, stats_at = now() WHERE pair_id = $1', [
      pair.id,
      xp,
      care.stats.fullness,
      care.stats.joy,
    ]);

    const after = stageOf(xp);
    return { name: row.name, gained, bonus, hatched: before.id === 'egg' && after.id !== 'egg', grew: after.index > before.index, stage: after };
  });

  // Уведомления партнёру — вне транзакции; ошибки Telegram сюда не долетают (notify не бросает).
  if (done.grew) {
    const text = done.hatched
      ? `🐣 Яйцо проснулось — знакомьтесь, <b>${esc(done.name)}</b>!\n\n${esc(user.name)} ${verb(user.gender, 'согрел')} его последним.`
      : `✨ У <b>${esc(done.name)}</b> новая стадия роста: «${esc(done.stage.title)}»!`;
    await notify(partner.id, text, openAppKb('Посмотреть'));
  } else {
    // Не чаще одного сообщения в 3 часа от одного человека — иначе бот превратится в спамера.
    const bucket = Math.floor(nowMs / (3 * 3_600_000));
    const key = `pn:${pair.id}:${user.id}:${bucket}`;
    const claimed = await query('INSERT INTO notif_log(key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
    if (claimed.rowCount === 1) {
      const icon = { feed: '🍓', play: '🎾', hug: '🤗', warm: '🥚' }[kind];
      await notify(partner.id, `${icon} ${esc(sentence(kind, user.name, user.gender, done.name))}`, openAppKb('Открыть питомца'));
    }
  }

  return { pet: await getPet(user), result: { gained: done.gained, bonus: done.bonus, hatched: done.hatched, grew: done.grew } };
}
