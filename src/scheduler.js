// Автоматизация: бот сам присылает вопрос дня, напоминания, поздравления и итоги недели.
//
// Как это работает:
//  • runTick() вызывается раз в минуту изнутри приложения И при каждом заходе UptimeRobot на /cron/tick.
//  • Каждое уведомление «занимает ключ» в таблице notif_log (функция claim) — поэтому,
//    сколько бы раз tick ни вызывали, одно и то же сообщение дважды не уйдёт.
//  • Если сервис на Render заснул и проснулся позже — сообщение уйдёт при первом же тике в «окне» часов.
//  • Время везде по APP_TZ (по умолчанию Europe/Kyiv). Тихие часы: ночью ничего не шлём.
import { query, claim } from './db.js';
import { inviteLink, shareUrl } from './config.js';
import { notify, openAppKb, shareKb } from './bot.js';
import { nowInTz, addDays, dayNum } from './dates.js';
import { buildMilestones } from './milestones.js';
import { questionFor, computeStreak, getMembers } from './logic.js';
import { esc, plural } from './util.js';

let running = false;
let lastHeavyRun = 0;

export async function runTick() {
  if (running) return;
  running = true;
  try {
    const now = nowInTz();
    await dailyQuestions(now);
    await answerReminders(now);

    // Остальные проверки легче делать раз в ~10 минут.
    if (Date.now() - lastHeavyRun > 9 * 60_000) {
      lastHeavyRun = Date.now();
      await milestoneGreetings(now);
      await inviteReminders(now);
      await inactivityNudges(now);
      await weeklySummary(now);
      await cleanup(now);
    }
  } catch (err) {
    console.error('[tick] ошибка:', err);
  } finally {
    running = false;
  }
}

export function startScheduler() {
  setTimeout(runTick, 15_000);
  setInterval(runTick, 60_000);
}

/* ---------- помощники ---------- */

const inWindow = (now, from, to) => now.hour >= from && now.hour < to;

/** Отправить каждому из пары своё сообщение: build(me, partner) -> html. */
async function notifyPair(pairId, build, keyboard) {
  const members = await getMembers(pairId);
  for (const me of members) {
    const partner = members.find((m) => m.id !== me.id);
    await notify(me.id, build(me, partner), keyboard);
  }
}

/* ---------- 1. вопрос дня в 10:00 ---------- */

async function dailyQuestions(now) {
  if (!inWindow(now, 10, 22)) return;
  const { rows } = await query(
    `SELECT p.id, p.joined_on FROM pairs p
     WHERE p.joined_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM notif_log n WHERE n.key = 'q:' || p.id || ':' || $1::text)`,
    [now.date],
  );
  for (const p of rows) {
    if (!(await claim(`q:${p.id}:${now.date}`))) continue;
    const q = questionFor(p.joined_on, now.date);
    if (!q) continue;
    await notifyPair(
      p.id,
      () =>
        `🌅 <b>Вопрос дня №${q.number}</b>\n\n<i>${esc(q.text)}</i>\n\nОтветь — и вы увидите ответы друг друга 💌`,
      openAppKb('Ответить'),
    );
  }
}

/* ---------- 2. напоминание, если один ответил, а второй нет (через 6 часов) ---------- */

async function answerReminders(now) {
  if (!inWindow(now, 10, 22)) return;
  const { rows } = await query(
    `SELECT a.pair_id, a.user_id AS answered_by FROM answers a
     WHERE a.q_date = $1::text
       AND a.created_at < now() - interval '6 hours'
       AND (SELECT COUNT(*) FROM answers b WHERE b.pair_id = a.pair_id AND b.q_date = a.q_date) = 1
       AND NOT EXISTS (SELECT 1 FROM notif_log n WHERE n.key = 'qr:' || a.pair_id || ':' || $1::text)`,
    [now.date],
  );
  for (const r of rows) {
    if (!(await claim(`qr:${r.pair_id}:${now.date}`))) continue;
    const members = await getMembers(r.pair_id);
    const waiting = members.find((m) => m.id !== r.answered_by);
    if (!waiting) continue;
    await notify(
      waiting.id,
      '💭 Вопрос дня всё ещё ждёт твой ответ.\n\nОтвет любимого человека уже спрятан внутри — он откроется, как только ответишь ты.',
      openAppKb('Ответить'),
    );
  }
}

/* ---------- 3. годовщины и красивые даты (за 7 дней, за день и в сам день) ---------- */

async function milestoneGreetings(now) {
  if (!inWindow(now, 9, 22)) return;
  const tomorrow = addDays(now.date, 1);
  const inWeek = addDays(now.date, 7);
  const { rows } = await query('SELECT id, start_date FROM pairs WHERE joined_at IS NOT NULL');

  for (const p of rows) {
    for (const m of buildMilestones(p.start_date)) {
      const kind = m.date === now.date ? '0' : m.date === tomorrow ? '1' : m.date === inWeek ? '7' : null;
      if (!kind) continue;
      if (!(await claim(`ms:${p.id}:${m.id}:${kind}`))) continue;

      const text =
        kind === '0'
          ? `🎉 <b>${esc(m.title)}!</b>\n\nСегодня особенный день для вас двоих. Скажите друг другу что-нибудь тёплое — а можно отправить «Думаю о тебе» прямо сейчас 💞`
          : kind === '1'
            ? `🌹 Завтра — <b>${esc(m.title.toLowerCase())}</b>!\n\nМожет, придумать маленький сюрприз?`
            : `🗓 Через неделю — <b>${esc(m.title.toLowerCase())}</b>.\n\nСамое время придумать подарок или планы на вечер 🎁`;
      await notifyPair(p.id, () => text, openAppKb());
    }
  }
}

/* ---------- 4. приглашение: напомнить автору через 24 часа и через 3 дня ---------- */

async function inviteReminders(now) {
  if (!inWindow(now, 10, 21)) return;
  const { rows } = await query(
    `SELECT id, code, owner_id, EXTRACT(EPOCH FROM (now() - created_at)) / 3600 AS age_hours
     FROM pairs
     WHERE joined_at IS NULL AND created_at < now() - interval '24 hours' AND created_at > now() - interval '10 days'`,
  );
  for (const p of rows) {
    const stage = Number(p.age_hours) >= 72 ? '3d' : '1d';
    if (!(await claim(`inv${stage}:${p.id}`))) continue;
    const link = inviteLink(p.code);
    await notify(
      p.owner_id,
      stage === '1d'
        ? '💌 Ваш «Двое» ждёт второго участника.\n\nОтправь ссылку-приглашение любимому человеку — вместе тут намного интереснее.'
        : '💞 Напоминаю про приглашение в «Двое».\n\nСсылка всё ещё действует — отправь её любимому человеку, когда будет удобно.',
      shareKb(shareUrl(link)),
    );
  }
}

/* ---------- 5. «давно не виделись» после 3 дней без заходов ---------- */

async function inactivityNudges(now) {
  if (!inWindow(now, 12, 20)) return;
  const { rows } = await query(
    `SELECT u.id FROM users u JOIN pairs p ON p.id = u.pair_id
     WHERE p.joined_at IS NOT NULL AND u.can_notify
       AND u.last_seen < now() - interval '3 days'
       AND u.last_seen > now() - interval '21 days'`,
  );
  const bucket = Math.floor(dayNum(now.date) / 5); // не чаще одного раза в 5 дней
  for (const u of rows) {
    if (!(await claim(`ia:${u.id}:${bucket}`))) continue;
    await notify(
      u.id,
      '💔 Давно не виделись в «Двое»!\n\nЗагляни: вопрос дня и кнопка «Думаю о тебе» уже скучают.',
      openAppKb(),
    );
  }
}

/* ---------- 6. итоги недели: воскресенье вечером ---------- */

async function weeklySummary(now) {
  if (now.weekday !== 0 || !inWindow(now, 19, 22)) return;
  const since = addDays(now.date, -6);
  const { rows } = await query(
    `SELECT p.id,
       (SELECT COUNT(*) FROM (
          SELECT 1 FROM answers a WHERE a.pair_id = p.id AND a.q_date >= $1::text
          GROUP BY a.q_date HAVING COUNT(*) = 2) s) AS both_days,
       (SELECT COUNT(*) FROM thoughts t WHERE t.pair_id = p.id AND t.created_at > now() - interval '7 days') AS thoughts
     FROM pairs p
     WHERE p.joined_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM notif_log n WHERE n.key = 'w:' || p.id || ':' || $2::text)`,
    [since, now.date],
  );
  for (const p of rows) {
    if (!(await claim(`w:${p.id}:${now.date}`))) continue;
    const streak = await computeStreak(p.id, now.date);
    const lines = [
      '🌙 <b>Итоги недели</b>',
      '',
      `💭 Вместе ответили на вопросы: ${p.both_days} из 7`,
      `💌 «Думаю о тебе» отправлено: ${p.thoughts} ${plural(Number(p.thoughts), ['раз', 'раза', 'раз'])}`,
      streak > 0 ? `🔥 Серия: ${streak} ${plural(streak, ['день', 'дня', 'дней'])} подряд` : '🔥 Серия начнётся, когда оба ответите на вопрос дня',
      '',
      'Тёплой новой недели вам двоим ❤️',
    ];
    await notifyPair(p.id, () => lines.join('\n'), openAppKb());
  }
}

/* ---------- 7. уборка старого журнала (раз в сутки ночью) ---------- */

async function cleanup(now) {
  if (!inWindow(now, 3, 5)) return;
  if (!(await claim(`cleanup:${now.date}`))) return;
  await query(`DELETE FROM notif_log WHERE sent_at < now() - interval '90 days'`);
}
