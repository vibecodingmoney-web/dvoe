// Телеграм-бот (grammY). Его работа: открывать Mini App, присылать уведомления, принимать приглашения.
import { Bot, InlineKeyboard } from 'grammy';
import { cfg } from './config.js';
import { query } from './db.js';
import { isUnreachableError, isButtonError } from './util.js';

// Заглушка нужна, чтобы импорт не падал без токена; реальную проверку делает server.js.
export const bot = new Bot(cfg.botToken || 'missing:token');

/** Кнопка, открывающая Mini App прямо из сообщения. */
export function openAppKb(text = 'Открыть «Двое» ❤️') {
  if (!cfg.publicUrl) return undefined;
  return new InlineKeyboard().webApp(text, cfg.publicUrl);
}

/** Кнопка «поделиться ссылкой-приглашением». */
export function shareKb(url, text = 'Отправить приглашение 💌') {
  return new InlineKeyboard().url(text, url);
}

/** Отправить сообщение пользователю. Никогда не бросает ошибку; true — доставлено. */
export async function notify(userId, html, keyboard) {
  let markup = keyboard;
  let retried = false;
  let withoutButton = false;

  for (;;) {
    try {
      await bot.api.sendMessage(userId, html, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: markup,
      });
      // Дошло — значит, писать можно: поднимаем флаг, если он был сброшен раньше.
      query('UPDATE users SET can_notify = TRUE WHERE id = $1 AND NOT can_notify', [userId]).catch(() => {});
      return true;
    } catch (err) {
      // Лимит Telegram (429): коротко ждём, сколько просят, и пробуем ещё раз — иначе напоминание потеряется.
      const wait = Number(err?.parameters?.retry_after);
      if (!retried && err?.error_code === 429 && wait > 0 && wait <= 10) {
        retried = true;
        await new Promise((r) => setTimeout(r, wait * 1000 + 200));
        continue;
      }
      // Неверная кнопка (например, PUBLIC_URL без https): шлём текст без кнопки, а не теряем сообщение.
      if (!withoutButton && markup && isButtonError(err)) {
        withoutButton = true;
        markup = undefined;
        continue;
      }
      // 403 — бот заблокирован или диалог не начат; 400 «chat not found» — чата нет. Остальные ошибки флаг не трогают.
      if (isUnreachableError(err)) {
        await query('UPDATE users SET can_notify = FALSE WHERE id = $1', [userId]).catch(() => {});
      }
      console.warn(`[notify] не доставлено ${userId}:`, err?.description || err?.message || err);
      return false;
    }
  }
}

async function setNotifiable(userId, value) {
  await query('UPDATE users SET can_notify = $2 WHERE id = $1', [userId, value]).catch(() => {});
}

bot.command('start', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  await setNotifiable(ctx.from.id, true);

  // Запасной путь приглашения: t.me/бот?start=pair_КОД
  const payload = ctx.match || '';
  const m = /^pair_([A-Za-z0-9_-]{6,16})$/.exec(payload);
  if (m && cfg.publicUrl) {
    const kb = new InlineKeyboard().webApp('Присоединиться ❤️', `${cfg.publicUrl}/?invite=${m[1]}`);
    await ctx.reply('💞 Тебя пригласили в «Двое» — маленький тёплый мир для двоих.\n\nНажми кнопку, чтобы присоединиться.', {
      reply_markup: kb,
    });
    return;
  }

  await ctx.reply(
    '💞 Привет! Это «Двое» — маленький тёплый мир для двоих.\n\nСчётчик ваших дней, календарь памятных дат, общий питомец, нежные послания и напоминания о важном.',
    { reply_markup: openAppKb('Открыть «Двое» ❤️') },
  );
});

// Узнать свой Telegram id (нужен для ADMIN_IDS).
bot.command('id', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  await ctx.reply(`Твой Telegram id: <code>${ctx.from.id}</code>`, { parse_mode: 'HTML' });
});

// Любое другое сообщение в личке — подсказываем, где приложение.
bot.on('message', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  await ctx.reply('Все самое тёплое — в приложении 👇', { reply_markup: openAppKb() });
});

// Человек заблокировал бота или вернулся.
bot.on('my_chat_member', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  const status = ctx.myChatMember.new_chat_member.status;
  await setNotifiable(ctx.from.id, status === 'member');
});

bot.catch((err) => console.error('[bot] ошибка обработчика:', err.message));
