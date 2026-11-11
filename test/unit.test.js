// Тесты чистой логики (без базы и без сети): node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { validateInitData, safeEqual } from '../src/auth.js';
import { addDays, addMonths, daysBetween, diffYMD, isValidDate, nowInTz } from '../src/dates.js';
import { buildMilestones, milestoneInfo } from '../src/milestones.js';
import { PHRASES } from '../src/content.js';
import { cleanName, cleanMessage, esc, plural, isUnreachableError, isButtonError } from '../src/util.js';

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

test('контент: достаточно фраз, без дублей и пустых', () => {
  assert.ok(PHRASES.length >= 100, `фраз ${PHRASES.length}`);
  assert.equal(new Set(PHRASES).size, PHRASES.length);
  for (const s of PHRASES) assert.ok(typeof s === 'string' && s.trim().length > 5);
});

test('контент: нет явных родовых окончаний (текст подходит любой паре)', () => {
  const gendered = /(^|[\s«"(])(скучал[аи]?|соскучил(ся|ась|ись)|думал[аи]?|любил[аи]?|хотел[аи]?|влюбил(ся|ась|ись)|рад|рада|счастлив|счастлива)([\s.,!?»")]|$)/i;
  const bad = PHRASES.filter((s) => gendered.test(s));
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

test('cleanMessage: личный текст «Думаю о тебе»', () => {
  assert.equal(cleanMessage('  Скучаю   по тебе  '), 'Скучаю по тебе');
  assert.equal(cleanMessage('Привет\r\n\r\n\r\n\r\nЛюблю'), 'Привет\n\nЛюблю');
  assert.equal(cleanMessage('a\u0000b\u0007c'), 'a b c');
  assert.equal(cleanMessage('1 < 2 & 3 > 2'), '1 < 2 & 3 > 2'); // экранирование делает esc() при выводе
  assert.equal(cleanMessage('   \n  '), '');
  assert.equal(cleanMessage(null), '');
  assert.equal(cleanMessage(42), '');
  assert.equal(Array.from(cleanMessage('x'.repeat(900))).length, 500);
  // эмодзи (2 UTF-16 символа) не режутся пополам
  const cut = cleanMessage('💗'.repeat(600));
  assert.equal(Array.from(cut).length, 500);
  assert.ok(!/[\ud800-\udbff]$/.test(cut));
});

test('уведомления: когда человека считаем недоступным для бота', () => {
  // человек заблокировал бота / не начинал диалог
  assert.equal(isUnreachableError({ error_code: 403, description: 'Forbidden: bot was blocked by the user' }), true);
  assert.equal(isUnreachableError({ error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" }), true);
  assert.equal(isUnreachableError({ error_code: 400, description: 'Bad Request: chat not found' }), true);
  // а это — наши ошибки, на доступности человека они не сказываются
  assert.equal(isUnreachableError({ error_code: 400, description: "Bad Request: can't parse entities: Unsupported start tag" }), false);
  assert.equal(isUnreachableError({ error_code: 400, description: 'Bad Request: BUTTON_URL_INVALID' }), false);
  assert.equal(isUnreachableError({ error_code: 400, description: 'Bad Request: message is too long' }), false);
  assert.equal(isUnreachableError({ error_code: 429, description: 'Too Many Requests: retry after 5' }), false);
  assert.equal(isUnreachableError({ error_code: 500 }), false);
  assert.equal(isUnreachableError(new Error('network down')), false);
  assert.equal(isUnreachableError(null), false);
});

test('уведомления: ошибка кнопки отличается от ошибки человека', () => {
  assert.equal(isButtonError({ error_code: 400, description: 'Bad Request: BUTTON_URL_INVALID' }), true);
  assert.equal(isButtonError({ error_code: 400, description: 'Bad Request: WEB_APP_URL_INVALID' }), true);
  assert.equal(isButtonError({ error_code: 400, description: 'Bad Request: chat not found' }), false);
  assert.equal(isButtonError({ error_code: 403, description: 'Forbidden: bot was blocked by the user' }), false);
});

test('«Думаю о тебе»: текст с разметкой не ломает HTML-сообщение Telegram', () => {
  const evil = '<b>привет</b> & <script>alert(1)</script> "кавычки"';
  const html = `💌 <b>Думаю о тебе</b>\n\n<i>${esc(cleanMessage(evil))}</i>`;
  // внутри <i> не остаётся ни одного «живого» тега, кроме собственных <b> и <i>
  const tags = html.match(/<\/?[a-z][^>]*>/gi);
  assert.deepEqual(tags, ['<b>', '</b>', '<i>', '</i>']);
  assert.ok(html.length < 4096);
  // самое длинное сообщение (500 символов, все — спецсимволы) тоже укладывается в лимит Telegram
  const worst = `💌 <b>Думаю о тебе</b>\n\n<i>${esc(cleanMessage('&'.repeat(900)))}</i>`;
  assert.ok(worst.length < 4096, `длина ${worst.length}`);
});
