// Автоматизация: бот сам присылает напоминания о датах, поздравления, заботу о питомце и итоги недели.
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
import { getMembers } from './context.js';
import { loadEvents } from './events.js';
import { expandEvents, weddingOccurrences, upcoming } from './calendar.js';
import { currentStats, moodOf, stageOf } from './pet-core.js';
import { esc, plural } from './util.js';

let running = false;
let lastHeavyRun = 0;

export async function runTick() {
  if (running) return;
  running = true;
  try {
    const now = nowInTz();

    // Проверки делаем раз в ~10 минут: этого достаточно, а база меньше нагружается.
    if (Date.now() - lastHeavyRun > 9 * 60_000) {
      lastHeavyRun = Date.now();
      await milestoneGreetings(now);
      await eventReminders(now);
      await petNudges(now);
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

/* ---------- 1. годовщины и красивые даты (за 7 дней, за день и в сам день) ---------- */

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

/* ---------- 2. даты из календаря: за день и в сам день (+ годовщины свадьбы) ---------- */

async function eventReminders(now) {
  if (!inWindow(now, 9, 22)) return;
  const tomorrow = addDays(now.date, 1);

  const pairs = (await query('SELECT id, wedding_date FROM pairs WHERE joined_at IS NOT NULL')).rows;
  // Нужны только повторяющиеся события (их год считаем в коде) и разовые на сегодня/завтра.
  const evRows = (
    await query(
      `SELECT e.* FROM events e JOIN pairs p ON p.id = e.pair_id
       WHERE p.joined_at IS NOT NULL AND e.remind
         AND ((e.repeat_kind = 'yearly' AND e.on_date <= $2::text) OR e.on_date BETWEEN $1::text AND $2::text)`,
      [now.date, tomorrow],
    )
  ).rows;
  const byPair = new Map();
  for (const e of evRows) (byPair.get(e.pair_id) || byPair.set(e.pair_id, []).get(e.pair_id)).push(e);

  for (const p of pairs) {
    const occs = [...expandEvents(byPair.get(p.id) || [], now.date, tomorrow), ...weddingOccurrences(p.wedding_date, now.date, tomorrow)];
    for (const o of occs) {
      const kind = o.date === now.date ? '0' : '1';
      if (!(await claim(`evr:${p.id}:${o.key}:${o.date}:${kind}`))) continue;

      const years = o.kind === 'event' && o.years ? ` · ${o.years} ${plural(o.years, ['год', 'года', 'лет'])}` : '';
      const note = o.note ? `\n\n<i>${esc(o.note)}</i>` : '';
      const text =
        kind === '0'
          ? `${o.emoji} <b>Сегодня: ${esc(o.title)}</b>${years}${note}\n\nОтметьте этот день вместе 💞`
          : `🗓 Завтра — <b>${esc(o.title)}</b>${years}.${note}\n\nМожет, придумать маленький сюрприз?`;
      await notifyPair(p.id, () => text, openAppKb('Открыть календарь'));
    }
  }
}

/* ---------- 3. питомец: напомнить, если проголодался или скучает (не чаще раза в день) ---------- */

async function petNudges(now) {
  if (!inWindow(now, 10, 21)) return;
  // Только вылупившиеся, и только пока о них заботились в последние 5 дней — иначе бот надоест.
  const { rows } = await query(
    `SELECT pt.pair_id, pt.name, pt.xp, pt.fullness, pt.joy, pt.stats_at
     FROM pets pt JOIN pairs p ON p.id = pt.pair_id
     WHERE p.joined_at IS NOT NULL AND pt.xp >= 30 AND pt.stats_at > now() - interval '5 days'`,
  );
  for (const r of rows) {
    const mood = moodOf(currentStats(r), stageOf(r.xp).id);
    if (mood !== 'hungry' && mood !== 'sad') continue;
    if (!(await claim(`pnudge:${r.pair_id}:${now.date}`))) continue;
    const text =
      mood === 'hungry'
        ? `🍓 У <b>${esc(r.name)}</b> урчит в животике — пора кормить!`
        : `🎾 <b>${esc(r.name)}</b> скучает — давно не играли вместе.`;
    await notifyPair(r.pair_id, () => text, openAppKb('Открыть питомца'));
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
      '💔 Давно не виделись в «Двое»!\n\nЗагляни: питомец и кнопка «Думаю о тебе» уже скучают.',
      openAppKb(),
    );
  }
}

/* ---------- 6. итоги недели: воскресенье вечером ---------- */

async function weeklySummary(now) {
  if (now.weekday !== 0 || !inWindow(now, 19, 22)) return;
  const { rows } = await query(
    `SELECT p.id, p.start_date, p.wedding_date,
       (SELECT COUNT(*) FROM thoughts t WHERE t.pair_id = p.id AND t.created_at > now() - interval '7 days') AS thoughts,
       (SELECT COUNT(*) FROM pet_log l WHERE l.pair_id = p.id AND l.created_at > now() - interval '7 days') AS care,
       (SELECT name FROM pets pt WHERE pt.pair_id = p.id) AS pet_name
     FROM pairs p
     WHERE p.joined_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM notif_log n WHERE n.key = 'w:' || p.id || ':' || $1::text)`,
    [now.date],
  );
  for (const p of rows) {
    if (!(await claim(`w:${p.id}:${now.date}`))) continue;
    const lines = ['🌙 <b>Итоги недели</b>', '', `💌 «Думаю о тебе» отправлено: ${p.thoughts} ${plural(Number(p.thoughts), ['раз', 'раза', 'раз'])}`];
    if (p.pet_name) lines.push(`🐾 Забота о питомце (${esc(p.pet_name)}): ${p.care} ${plural(Number(p.care), ['раз', 'раза', 'раз'])}`);

    const next = upcoming(p, await loadEvents(p.id), now.date, { limit: 1, includeToday: false, horizon: 30 })[0];
    if (next) {
      const when = next.daysLeft === 1 ? 'завтра' : `через ${next.daysLeft} ${plural(next.daysLeft, ['день', 'дня', 'дней'])}`;
      lines.push(`📅 Скоро: ${next.emoji} ${esc(next.title)} — ${when}`);
    }
    lines.push('', 'Тёплой новой недели вам двоим ❤️');
    await notifyPair(p.id, () => lines.join('\n'), openAppKb());
  }
}

/* ---------- 7. уборка старого журнала (раз в сутки ночью) ---------- */

async function cleanup(now) {
  if (!inWindow(now, 3, 5)) return;
  if (!(await claim(`cleanup:${now.date}`))) return;
  await query(`DELETE FROM notif_log WHERE sent_at < now() - interval '90 days'`);
  await query(`DELETE FROM pet_log WHERE created_at < now() - interval '60 days'`);
}
