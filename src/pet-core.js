// Правила питомца (тамагочи) — чистая логика без базы.
//
// Один общий питомец на пару. Растёт от заботы обоих:
//   яйцо → малыш → подросток → взрослый.
// Сытость и настроение со временем падают (считаем «лениво», по времени с последнего обновления),
// но питомец никогда не умирает — он просто грустит и ждёт заботы.

export const PET_TYPES = [
  { id: 'cat', title: 'Котик', defaultName: 'Мими' },
  { id: 'bunny', title: 'Зайка', defaultName: 'Снежок' },
  { id: 'bear', title: 'Мишка', defaultName: 'Плюш' },
  { id: 'dog', title: 'Щенок', defaultName: 'Бублик' },
];

/** Стадии роста: from — с какого количества «любви» (XP) стадия начинается. */
export const STAGES = [
  { id: 'egg', title: 'Яйцо', from: 0 },
  { id: 'baby', title: 'Малыш', from: 30 },
  { id: 'kid', title: 'Подросток', from: 150 },
  { id: 'adult', title: 'Взрослый', from: 450 },
];

export const FOODS = [
  { id: 'berry', emoji: '🍓', title: 'Ягодка', fullness: 30, joy: 5 },
  { id: 'carrot', emoji: '🥕', title: 'Морковка', fullness: 35, joy: 0 },
  { id: 'cookie', emoji: '🍪', title: 'Печенька', fullness: 20, joy: 12 },
  { id: 'cake', emoji: '🍰', title: 'Тортик', fullness: 12, joy: 25 },
];

/** Сколько очков теряется за час. */
export const DECAY_PER_HOUR = { fullness: 4, joy: 3 };
/** Пауза между повторами (на каждого человека). Кормить и играть можно сколько нужно — их ограничивают сытость и настроение. */
export const COOLDOWN_SEC = { hug: 20 * 60, warm: 10 * 60 };
/** Сколько «любви» даёт действие. Бонус — когда за день позаботились оба. */
export const XP = { feed: 8, play: 8, hug: 0, warm: 10, bonus: 20 };

export const ACTIONS = ['feed', 'play', 'hug', 'warm'];
export const NAME_MAX = 16;

const clamp = (n) => Math.min(100, Math.max(0, n));
const round1 = (n) => Math.round(n * 10) / 10;

export const petType = (id) => PET_TYPES.find((t) => t.id === id) || null;

/** Текущие показатели с учётом времени, прошедшего с row.stats_at. */
export function currentStats(row, nowMs = Date.now()) {
  const hours = Math.max(0, (nowMs - new Date(row.stats_at).getTime()) / 3_600_000);
  return {
    fullness: round1(clamp(row.fullness - DECAY_PER_HOUR.fullness * hours)),
    joy: round1(clamp(row.joy - DECAY_PER_HOUR.joy * hours)),
  };
}

/** Стадия по XP + прогресс до следующей. */
export function stageOf(xp) {
  let index = 0;
  STAGES.forEach((s, i) => {
    if (xp >= s.from) index = i;
  });
  const cur = STAGES[index];
  const next = STAGES[index + 1] || null;
  return {
    index,
    id: cur.id,
    title: cur.title,
    from: cur.from,
    nextFrom: next ? next.from : null,
    nextTitle: next ? next.title : null,
    progress: next ? Math.min(1, (xp - cur.from) / (next.from - cur.from)) : 1,
  };
}

/** Настроение для картинки: egg / hungry / sad / happy / ok. */
export function moodOf(stats, stageId) {
  if (stageId === 'egg') return 'egg';
  if (stats.fullness < 25) return 'hungry';
  if (stats.joy < 25) return 'sad';
  if (stats.fullness >= 60 && stats.joy >= 60) return 'happy';
  return 'ok';
}

/**
 * Применить заботу. Возвращает { ok: true, stats, xpGain } или { ok: false, reason }.
 * reason: egg (яйцу нужно только тепло) · hatched (яйцо уже вылупилось) · bad_food · full · hungry · enough
 */
export function applyCare(kind, foodId, stats, xp) {
  const stage = stageOf(xp).id;
  let { fullness, joy } = stats;

  if (stage === 'egg' && kind !== 'warm') return { ok: false, reason: 'egg' };
  if (kind === 'warm' && stage !== 'egg') return { ok: false, reason: 'hatched' };

  if (kind === 'feed') {
    const food = FOODS.find((f) => f.id === foodId);
    if (!food) return { ok: false, reason: 'bad_food' };
    if (fullness > 90) return { ok: false, reason: 'full' };
    fullness += food.fullness;
    joy += food.joy;
  } else if (kind === 'play') {
    if (fullness < 10) return { ok: false, reason: 'hungry' };
    if (joy > 90) return { ok: false, reason: 'enough' };
    joy += 25;
    fullness -= 6;
  } else if (kind === 'hug') {
    if (joy >= 100) return { ok: false, reason: 'enough' };
    joy += 10;
  } else if (kind !== 'warm') {
    return { ok: false, reason: 'bad_action' };
  }

  return { ok: true, stats: { fullness: round1(clamp(fullness)), joy: round1(clamp(joy)) }, xpGain: XP[kind] };
}
