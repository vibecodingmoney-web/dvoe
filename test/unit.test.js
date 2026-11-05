// Тесты чистой логики (без базы и без сети): node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { validateInitData, safeEqual } from '../src/auth.js';
import { addDays, addMonths, daysBetween, diffYMD, isValidDate, nowInTz } from '../src/dates.js';
import { buildMilestones, milestoneInfo } from '../src/milestones.js';
import { PHRASES, QUESTIONS } from '../src/content.js';
import { cleanName, esc, plural } from '../src/util.js';

/* ---------- подпись Telegram ---------- */

/** Независимая реализация подписи по документации Telegram — проверяем, что наш код с ней согласен. */
function signInitData(fields, token) {
  const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b));
  const dcs = entries.map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const TOKEN = '123456:TEST-TOKEN';
const nowSec = () => Math.floor(Date.now() / 1000);
const userJson = JSON.stringify({ id: 42, first_name: 'Аня', allows_write_to_pm: true });

test('initData: верная подпись принимается', () => {
  const data = signInitData({ auth_date: String(nowSec()), query_id: 'AAA', user: userJson, start_param: 'pair_abc' }, TOKEN);
  const r = validateInitData(data, TOKEN);
  assert.equal(r.user.id, 42);
  assert.equal(r.user.first_name, 'Аня');
  assert.equal(r.startParam, 'pair_abc');
});

test('initData: чужой токен, подделка и просрочка отклоняются', () => {
  const good = signInitData({ auth_date: String(nowSec()), user: userJson }, TOKEN);
  assert.equal(validateInitData(good, 'other:token'), null);

  const forged = good.replace('42', '43'); // подменили id пользователя
  assert.equal(validateInitData(forged, TOKEN), null);

  const old = signInitData({ auth_date: String(nowSec() - 3 * 86400), user: userJson }, TOKEN);
  assert.equal(validateInitData(old, TOKEN), null);

  assert.equal(validateInitData('', TOKEN), null);
  assert.equal(validateInitData('user=%7B%7D', TOKEN), null); // без hash
  assert.equal(validateInitData(good, ''), null);
});

test('safeEqual', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});

/* ---------- даты ---------- */

test('даты: базовая арифметика', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-11'), 10);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('2024-02-29'), true);
  assert.equal(isValidDate('2026-2-3'), false);
});

test('даты: addMonths не перескакивает через месяц', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-11-05', 12), '2027-11-05');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
});

test('даты: diffYMD', () => {
  assert.deepEqual(diffYMD('2025-11-05', '2026-11-05'), { years: 1, months: 0, days: 0 });
  assert.deepEqual(diffYMD('2026-11-05', '2026-11-05'), { years: 0, months: 0, days: 0 });
  assert.deepEqual(diffYMD('2025-08-10', '2026-11-05'), { years: 1, months: 2, days: 26 });
  // начало 31-го числа: «месяцы» согласованы с годовщинами из addMonths
  assert.deepEqual(diffYMD('2026-01-31', '2026-02-28'), { years: 0, months: 1, days: 0 });
  assert.deepEqual(diffYMD('2026-01-31', '2026-03-01'), { years: 0, months: 1, days: 1 });
  assert.deepEqual(diffYMD('2026-12-31', '2026-12-31'), { years: 0, months: 0, days: 0 });
  assert.deepEqual(diffYMD('2026-12-01', '2026-11-01'), { years: 0, months: 0, days: 0 }); // будущее не ломает
});

test('даты: nowInTz отдаёт корректные поля', () => {
  const n = nowInTz(new Date('2026-11-05T09:30:00Z'));
  assert.match(n.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(n.hour >= 0 && n.hour <= 23);
  assert.ok(n.weekday >= 0 && n.weekday <= 6);
});

/* ---------- годовщины ---------- */

test('годовщины: список отсортирован, содержит нужные даты', () => {
  const list = buildMilestones('2026-01-01');
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(list.map((x) => x.id), sorted.map((x) => x.id));

  const byId = Object.fromEntries(list.map((m) => [m.id, m]));
  assert.equal(byId.d100.date, '2026-04-11');
  assert.equal(byId.m1.date, '2026-02-01');
  assert.equal(byId.m6.title, 'Полгода вместе');
  assert.equal(byId.y1.date, '2027-01-01');
  assert.equal(byId.y1.title, 'Год вместе');
  assert.equal(byId.y5.title, '5 лет вместе');
  assert.equal(byId.y2.title, '2 года вместе');
});

test('годовщины: milestoneInfo — сегодня / ближайшая / прогресс', () => {
  const start = '2026-01-01';
  const info = milestoneInfo(start, '2026-02-01'); // ровно месяц
  assert.equal(info.today.id, 'm1');
  assert.equal(info.next.id, 'm3');
  assert.ok(info.next.progress >= 0 && info.next.progress <= 1);
  assert.ok(info.next.daysLeft > 0);

  const fresh = milestoneInfo('2026-11-05', '2026-11-05'); // день начала
  assert.equal(fresh.today, null);
  assert.equal(fresh.next.id, 'm1');
  assert.equal(fresh.next.progress, 0);
  assert.ok(fresh.upcoming.length > 0);
  assert.equal(fresh.past.length, 0);
});

/* ---------- контент ---------- */

test('контент: достаточно фраз и вопросов, без дублей и пустых', () => {
  assert.ok(PHRASES.length >= 100, `фраз ${PHRASES.length}`);
  assert.ok(QUESTIONS.length >= 90, `вопросов ${QUESTIONS.length}`);
  assert.equal(new Set(PHRASES).size, PHRASES.length);
  assert.equal(new Set(QUESTIONS).size, QUESTIONS.length);
  for (const s of [...PHRASES, ...QUESTIONS]) assert.ok(typeof s === 'string' && s.trim().length > 5);
});

test('контент: нет явных родовых окончаний (текст подходит любой паре)', () => {
  const gendered = /(^|[\s«"(])(скучал[аи]?|соскучил(ся|ась|ись)|думал[аи]?|любил[аи]?|хотел[аи]?|влюбил(ся|ась|ись)|рад|рада|счастлив|счастлива)([\s.,!?»")]|$)/i;
  const bad = [...PHRASES, ...QUESTIONS].filter((s) => gendered.test(s));
  assert.deepEqual(bad, []);
});

/* ---------- утилиты ---------- */

test('util: plural / esc / cleanName', () => {
  assert.equal(plural(1, ['день', 'дня', 'дней']), 'день');
  assert.equal(plural(2, ['день', 'дня', 'дней']), 'дня');
  assert.equal(plural(5, ['день', 'дня', 'дней']), 'дней');
  assert.equal(plural(11, ['день', 'дня', 'дней']), 'дней');
  assert.equal(plural(21, ['день', 'дня', 'дней']), 'день');
  assert.equal(plural(112, ['день', 'дня', 'дней']), 'дней');
  assert.equal(esc('<b>"Аня" & Ко</b>'), '&lt;b&gt;&quot;Аня&quot; &amp; Ко&lt;/b&gt;');
  assert.equal(cleanName('  Аня   <script> '), 'Аня script');
  assert.equal(cleanName('x'.repeat(100)).length, 30);
  assert.equal(cleanName(123), '');
});
