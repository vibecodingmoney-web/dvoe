// Все настройки берутся из переменных окружения (на Render: Environment).
import crypto from 'node:crypto';

const botToken = process.env.BOT_TOKEN || '';

export const cfg = {
  port: Number(process.env.PORT) || 3000,
  botToken,
  databaseUrl: process.env.DATABASE_URL || '',
  // Render сам задаёт RENDER_EXTERNAL_URL (https://имя.onrender.com)
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),
  // Прямая ссылка на Mini App из BotFather (/newapp), например https://t.me/my_bot/app
  miniAppLink: (process.env.MINIAPP_LINK || '').replace(/\/+$/, ''),
  // Секрет для вебхука Telegram: если не задан, выводим из токена бота.
  webhookSecret:
    process.env.WEBHOOK_SECRET ||
    (botToken ? crypto.createHash('sha256').update(`webhook:${botToken}`).digest('hex').slice(0, 48) : ''),
  // Ключ для внешнего вызова /cron/tick (UptimeRobot / cron-job.org)
  cronKey: process.env.CRON_KEY || '',
  // Как часто можно нажимать «Думаю о тебе» (минуты)
  thoughtCooldownMin: Number(process.env.THOUGHT_COOLDOWN_MIN) || 180,
  // Только для локальной отладки вне Telegram. На проде НЕ включать.
  devAuth: process.env.DEV_AUTH === '1' && process.env.NODE_ENV !== 'production',
  // Заполняется при старте из getMe
  botUsername: '',
};

/** Ссылка-приглашение для второго участника пары. */
export function inviteLink(code) {
  const param = `pair_${code}`;
  if (cfg.miniAppLink) return `${cfg.miniAppLink}?startapp=${param}`;
  if (cfg.botUsername) return `https://t.me/${cfg.botUsername}?start=${param}`;
  return `${cfg.publicUrl}/?invite=${code}`;
}

/** Ссылка «поделиться в Telegram» с готовым текстом. */
export function shareUrl(link) {
  const text = 'Присоединяйся ко мне в «Двое» — нашем маленьком мире ❤️';
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}
