// Тесты календаря, питомца, профиля и «страховка» на импорты. Без базы и сети: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expandEvents, weddingOccurrences, calendarItems, upcoming, weddingInfo, weddingTitle, sameDayInYear } from '../src/calendar.js';
import {
  ACTIONS, COOLDOWN_SEC, FOODS, PET_TYPES, STAGES, XP,
  applyCare, currentStats, moodOf, stageOf,
} from '../src/pet-core.js';
import { cleanText, parseAge, parseGender, verb, MIN_AGE, MAX_AGE } from '../src/util.js';
import { fmtDateRu } from '../src/dates.js';

const ev = (over) => ({ id: 1, title: 'Событие', emoji: '💞', on_date: '2024-05-10', repeat_kind: 'none', note: '', remind: true, ...over });

/* ---------- календарь ---------- */

test('календарь: разовое событие попадает только в свой период', () => {
  const e = [ev({ on_date: '2026-11-20' })];
  assert.equal(expandEvents(e, '2026-11-01', '2026-11-30').length, 1);
  assert.equal(expandEvents(e, '2026-12-01', '2026-12-31').length, 0);
  assert.equal(expandEvents(e, '2026-11-20', '2026-11-20').length, 1); // границы включительно
});

test('календарь: ежегодное событие считает годы', () => {
  const e = [ev({ on_date: '2023-02-14', repeat_kind: 'yearly' })];
  const r = expandEvents(e, '2023-01-01', '2026-12-31');
  assert.deepEqual(r.map((x) => [x.date, x.years]), [['2023-02-14', null], ['2024-02-14', 1], ['2025-02-14', 2], ['2026-02-14', 3]]);
  // раньше первой даты ничего нет
  assert.equal(expandEvents(e, '2020-01-01', '2022-12-31').length, 0);
});

test('календарь: 29 февраля в невисокосный год — 28 февраля', () => {
  assert.equal(sameDayInYear('2024-02-29', 2027), '2027-02-28');
  assert.equal(sameDayInYear('2024-02-29', 2028), '2028-02-29');
  const r = expandEvents([ev({ on_date: '2024-02-29', repeat_kind: 'yearly' })], '2027-01-01', '2028-12-31');
  assert.deepEqual(r.map((x) => x.date), ['2027-02-28', '2028-02-29']);
});

test('календарь: свадьба и годовщины с названиями', () => {
  const r = weddingOccurrences('2026-06-14', '2026-01-01', '2032-12-31');
  assert.equal(r[0].title, 'День свадьбы');
  assert.equal(r[0].date, '2026-06-14');
  assert.equal(r[1].date, '2027-06-14');
  assert.equal(r[1].title, 'Годовщина свадьбы: 1 год (ситцевая)');
  assert.equal(weddingTitle(2), 'Годовщина свадьбы: 2 года (бумажная)');
  assert.equal(weddingTitle(25), 'Годовщина свадьбы: 25 лет (серебряная)');
  assert.equal(weddingTitle(16), 'Годовщина свадьбы: 16 лет'); // без названия
  assert.deepEqual(weddingOccurrences(null, '2026-01-01', '2030-01-01'), []);
  assert.deepEqual(weddingOccurrences('', '2026-01-01', '2030-01-01'), []);
});

test('календарь: общий список отсортирован, события идут перед авто-датами', () => {
  const pair = { start_date: '2026-01-01', wedding_date: null };
  const items = calendarItems(pair, [ev({ id: 7, title: 'Мой день', on_date: '2026-04-11' })], '2026-04-01', '2026-04-30');
  // 1 апреля — 3 месяца, 11 апреля — 100-й день (и событие: оно стоит раньше авто-даты), 22 апреля — 111-й день
  assert.deepEqual(items.map((i) => i.title), ['3 месяца вместе', 'Мой день', '100 дней вместе', '111 дней вместе']);
  const dates = items.map((i) => i.date);
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(items[1].editable, true);
  assert.equal(items[2].editable, false);
});

test('календарь: upcoming — daysLeft, includeToday и лимит', () => {
  const pair = { start_date: '2026-01-01', wedding_date: null };
  const events = [ev({ on_date: '2026-11-06' }), ev({ id: 2, on_date: '2026-11-10', title: 'Позже' })];
  const withToday = upcoming(pair, events, '2026-11-06', { limit: 3 });
  assert.equal(withToday[0].daysLeft, 0);
  const noToday = upcoming(pair, events, '2026-11-06', { limit: 3, includeToday: false });
  assert.ok(noToday.every((i) => i.daysLeft >= 1));
  assert.equal(noToday[0].title, 'Позже');
  assert.equal(noToday[0].daysLeft, 4);
  assert.equal(upcoming(pair, events, '2026-11-06', { limit: 1 }).length, 1);
});

test('календарь: weddingInfo', () => {
  assert.equal(weddingInfo(null, '2026-11-06'), null);
  assert.deepEqual(weddingInfo('2027-01-01', '2026-11-06'), { date: '2027-01-01', past: false, daysLeft: 56 });
  assert.deepEqual(weddingInfo('2025-11-06', '2026-11-06'), { date: '2025-11-06', past: true, breakdown: { years: 1, months: 0, days: 0 } });
});

test('даты: fmtDateRu', () => {
  assert.equal(fmtDateRu('2026-11-05'), '5 ноября 2026');
  assert.equal(fmtDateRu('2025-03-08'), '8 марта 2025');
});

/* ---------- питомец ---------- */

const NOW = Date.parse('2026-11-06T12:00:00Z');
const row = (over) => ({ xp: 200, fullness: 80, joy: 80, stats_at: '2026-11-06T12:00:00Z', ...over });

test('питомец: показатели тают со временем и не уходят ниже нуля', () => {
  const s0 = currentStats(row(), NOW);
  assert.deepEqual(s0, { fullness: 80, joy: 80 });
  const s5 = currentStats(row(), NOW + 5 * 3_600_000);
  assert.deepEqual(s5, { fullness: 60, joy: 65 }); // −4/ч и −3/ч
  const s99 = currentStats(row(), NOW + 99 * 3_600_000);
  assert.deepEqual(s99, { fullness: 0, joy: 0 });
  // время «назад» (рассинхрон часов) не прибавляет очков
  assert.deepEqual(currentStats(row(), NOW - 3_600_000), { fullness: 80, joy: 80 });
});

test('питомец: стадии и прогресс', () => {
  assert.equal(stageOf(0).id, 'egg');
  assert.equal(stageOf(29).id, 'egg');
  assert.equal(stageOf(30).id, 'baby');
  assert.equal(stageOf(149).id, 'baby');
  assert.equal(stageOf(150).id, 'kid');
  assert.equal(stageOf(450).id, 'adult');
  assert.equal(stageOf(99999).progress, 1);
  assert.equal(stageOf(99999).nextFrom, null);
  assert.equal(stageOf(15).progress, 0.5);
  assert.equal(stageOf(90).nextTitle, 'Подросток');
  assert.deepEqual(STAGES.map((s) => s.id), ['egg', 'baby', 'kid', 'adult']);
});

test('питомец: настроение', () => {
  assert.equal(moodOf({ fullness: 10, joy: 90 }, 'baby'), 'hungry');
  assert.equal(moodOf({ fullness: 90, joy: 10 }, 'baby'), 'sad');
  assert.equal(moodOf({ fullness: 90, joy: 90 }, 'kid'), 'happy');
  assert.equal(moodOf({ fullness: 50, joy: 50 }, 'kid'), 'ok');
  assert.equal(moodOf({ fullness: 5, joy: 5 }, 'egg'), 'egg');
  // голод важнее грусти
  assert.equal(moodOf({ fullness: 10, joy: 10 }, 'adult'), 'hungry');
});

test('питомец: кормление', () => {
  const r = applyCare('feed', 'cake', { fullness: 40, joy: 40 }, 200);
  assert.equal(r.ok, true);
  assert.deepEqual(r.stats, { fullness: 52, joy: 65 }); // тортик: +12 сытости, +25 радости
  assert.equal(r.xpGain, XP.feed);
  assert.equal(applyCare('feed', 'berry', { fullness: 95, joy: 40 }, 200).reason, 'full');
  assert.equal(applyCare('feed', 'pizza', { fullness: 10, joy: 40 }, 200).reason, 'bad_food');
  // значения не выходят за 100
  assert.equal(applyCare('feed', 'carrot', { fullness: 90, joy: 100 }, 200).stats.fullness, 100);
  assert.equal(FOODS.length, 4);
});

test('питомец: игра и объятия', () => {
  const p = applyCare('play', undefined, { fullness: 50, joy: 40 }, 200);
  assert.deepEqual(p.stats, { fullness: 44, joy: 65 });
  assert.equal(applyCare('play', undefined, { fullness: 5, joy: 40 }, 200).reason, 'hungry');
  assert.equal(applyCare('play', undefined, { fullness: 50, joy: 95 }, 200).reason, 'enough');
  const h = applyCare('hug', undefined, { fullness: 50, joy: 40 }, 200);
  assert.equal(h.stats.joy, 50);
  assert.equal(h.xpGain, 0);
  assert.equal(applyCare('hug', undefined, { fullness: 50, joy: 100 }, 200).reason, 'enough');
});

test('питомец: яйцо принимает только тепло, и только пока оно яйцо', () => {
  const stats = { fullness: 70, joy: 70 };
  assert.equal(applyCare('feed', 'berry', stats, 0).reason, 'egg');
  assert.equal(applyCare('play', undefined, stats, 10).reason, 'egg');
  assert.equal(applyCare('hug', undefined, stats, 10).reason, 'egg');
  const w = applyCare('warm', undefined, stats, 20);
  assert.equal(w.ok, true);
  assert.equal(w.xpGain, XP.warm);
  assert.equal(applyCare('warm', undefined, stats, 30).reason, 'hatched');
  assert.equal(applyCare('dance', undefined, stats, 200).reason, 'bad_action');
  // тремя согреваниями яйцо вылупляется
  assert.equal(stageOf(3 * XP.warm).id, 'baby');
});

test('питомец: справочники согласованы', () => {
  assert.deepEqual(ACTIONS.sort(), ['feed', 'hug', 'play', 'warm']);
  assert.ok(COOLDOWN_SEC.hug > 0 && COOLDOWN_SEC.warm > 0);
  assert.deepEqual(PET_TYPES.map((t) => t.id), ['cat', 'bunny', 'bear', 'dog']);
  for (const t of PET_TYPES) assert.ok(t.defaultName.length > 0 && t.defaultName.length <= 16);
});

/* ---------- профиль ---------- */

test('профиль: возраст', () => {
  assert.equal(parseAge(25), 25);
  assert.equal(parseAge('30'), 30);
  assert.equal(parseAge(MIN_AGE), MIN_AGE);
  assert.equal(parseAge(MAX_AGE), MAX_AGE);
  for (const bad of [MIN_AGE - 1, MAX_AGE + 1, 25.5, '', null, undefined, 'abc', NaN, true, -3]) assert.equal(parseAge(bad), null, String(bad));
});

test('профиль: пол', () => {
  assert.equal(parseGender('m'), 'm');
  assert.equal(parseGender('f'), 'f');
  for (const bad of ['', 'M', 'x', 'male', null, undefined, 1]) assert.equal(parseGender(bad), null, String(bad));
});

test('глаголы по полу', () => {
  assert.equal(verb('f', 'покормил'), 'покормила');
  assert.equal(verb('m', 'покормил'), 'покормил');
  assert.equal(verb(null, 'обнял'), 'обнял');
  assert.equal(verb('f', 'завёл'), 'завёла');
});

test('cleanText: лишнее убирается, длина ограничена', () => {
  assert.equal(cleanText('  Первый   <b>поцелуй</b>\n', 40), 'Первый b поцелуй /b');
  assert.equal(cleanText('x'.repeat(200), 40).length, 40);
  assert.equal(cleanText(null, 10), '');
  assert.equal(cleanText(42, 10), '');
});

/* ---------- страховка: импорты между модулями ---------- */
// Сервер в тестах не запускается (нужна база), поэтому проверяем статически: всё, что один модуль
// импортирует из другого, там реально экспортируется. Ловит опечатки и забытые экспорты до деплоя.

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function exportsOf(file) {
  const code = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  return names;
}

test('импорты между модулями src/ существуют', () => {
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js'));
  const problems = [];
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.\/[^']+)'/g)) {
      const target = path.join(SRC, m[2]);
      if (!fs.existsSync(target)) {
        problems.push(`${f}: нет файла ${m[2]}`);
        continue;
      }
      const have = exportsOf(target);
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0];
        if (name && !have.has(name)) problems.push(`${f}: «${name}» не экспортируется из ${m[2]}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('в коде не осталось вопросов дня и серий', () => {
  const leftovers = [];
  for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    if (/QUESTIONS|computeStreak|answerQuestion|FROM answers|INTO answers/.test(code)) leftovers.push(f);
  }
  assert.deepEqual(leftovers, []);
});
