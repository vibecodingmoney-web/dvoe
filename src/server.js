// Точка входа: веб-сервер (API + статика Mini App), вебхук бота и планировщик.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webhookCallback } from 'grammy';

import { cfg } from './config.js';
import { validateInitData, safeEqual } from './auth.js';
import { initDb, query } from './db.js';
import { bot } from './bot.js';
import { runTick, startScheduler } from './scheduler.js';
import {
  HttpError,
  buildState,
  createPair,
  getInvite,
  joinPair,
  sendThought,
  getQuestionState,
  answerQuestion,
  getQuestionHistory,
  updateName,
  updateStartDate,
  allowNotifications,
} from './logic.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/* ---------- проверка настроек ---------- */

const missing = [];
if (!cfg.botToken) missing.push('BOT_TOKEN');
if (!cfg.databaseUrl) missing.push('DATABASE_URL');
if (missing.length) {
  console.error(`❌ Не заданы переменные окружения: ${missing.join(', ')}. См. README.md.`);
  process.exit(1);
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

/* ---------- express ---------- */

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Лёгкий эндпоинт для UptimeRobot — без обращения к базе.
app.get('/health', (_req, res) => res.json({ ok: true }));

app.use(express.json({ limit: '20kb' }));

// Вебхук Telegram. Секрет в заголовке не даёт посторонним слать боту поддельные апдейты.
app.post('/webhook', webhookCallback(bot, 'express', { secretToken: cfg.webhookSecret }));

// Внешний «тик» планировщика: UptimeRobot / cron-job.org заходит сюда раз в 5 минут.
// Заодно это держит бесплатный сервис Render бодрствующим.
app.all('/cron/tick', async (req, res) => {
  if (!cfg.cronKey || !safeEqual(req.query.key || '', cfg.cronKey)) return res.status(403).json({ error: 'forbidden' });
  await runTick();
  res.json({ ok: true });
});

/* ---------- API ---------- */

const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();

async function authenticate(req, res, next) {
  try {
    let tg = null;
    const header = req.get('authorization') || '';
    if (header.startsWith('tma ')) {
      const checked = validateInitData(header.slice(4), cfg.botToken);
      if (checked) tg = checked.user;
    } else if (cfg.devAuth && req.get('x-dev-user')) {
      const [id, ...name] = req.get('x-dev-user').split(':');
      tg = { id: Number(id), first_name: name.join(':') || 'Dev' };
    }
    if (!tg || !Number.isFinite(tg.id)) return res.status(401).json({ error: 'unauthorized' });

    const count = (hits.get(tg.id) || 0) + 1;
    hits.set(tg.id, count);
    if (count > 150) return res.status(429).json({ error: 'rate_limited' });

    req.tg = tg;
    req.user = (await query('SELECT * FROM users WHERE id = $1', [tg.id])).rows[0] || null;
    if (req.user) {
      query(`UPDATE users SET last_seen = now() WHERE id = $1 AND last_seen < now() - interval '5 minutes'`, [tg.id]).catch(() => {});
    }
    next();
  } catch (err) {
    next(err);
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

const api = express.Router();
api.use(authenticate);

api.get('/state', wrap(async (req, res) => res.json(await buildState(req.user, req.tg))));

api.get('/invite/:code', wrap(async (req, res) => res.json(await getInvite(req.user, req.params.code))));

api.post('/pair/create', wrap(async (req, res) => {
  await createPair(req.tg, req.body?.name, req.body?.startDate);
  res.json({ ok: true });
}));

api.post('/pair/join', wrap(async (req, res) => {
  await joinPair(req.tg, req.body?.code, req.body?.name);
  res.json({ ok: true });
}));

api.post('/thought', wrap(async (req, res) => res.json(await sendThought(req.user))));

api.get('/question', wrap(async (req, res) => res.json(await getQuestionState(req.user))));
api.post('/question/answer', wrap(async (req, res) => res.json(await answerQuestion(req.user, req.body?.text))));
api.get('/question/history', wrap(async (req, res) => res.json(await getQuestionHistory(req.user))));

api.patch('/me', wrap(async (req, res) => {
  if (!req.user) throw new HttpError(409, 'no_pair');
  await updateName(req.user, req.body?.name);
  res.json({ ok: true });
}));

api.patch('/pair', wrap(async (req, res) => {
  await updateStartDate(req.user, req.body?.startDate);
  res.json({ ok: true });
}));

api.post('/notify-allowed', wrap(async (req, res) => {
  if (req.user) await allowNotifications(req.user);
  res.json({ ok: true });
}));

app.use('/api', api);

// Статика Mini App. no-cache: браузер каждый раз спрашивает «изменилось?» (ETag), так обновления видны сразу.
app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }),
);

// Ошибки.
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, ...err.extra });
  console.error('[server] ошибка:', err);
  res.status(500).json({ error: 'server_error' });
});

/* ---------- запуск ---------- */

async function main() {
  await initDb();
  await bot.init();
  cfg.botUsername = bot.botInfo.username;
  console.log(`🤖 Бот: @${cfg.botUsername}`);

  if (cfg.publicUrl) {
    try {
      await bot.api.setWebhook(`${cfg.publicUrl}/webhook`, {
        secret_token: cfg.webhookSecret,
        allowed_updates: ['message', 'my_chat_member'],
      });
      await bot.api.setChatMenuButton({
        menu_button: { type: 'web_app', text: 'Открыть ❤️', web_app: { url: cfg.publicUrl } },
      });
      console.log(`🔗 Вебхук: ${cfg.publicUrl}/webhook`);
    } catch (err) {
      console.error('[startup] не удалось настроить вебхук/кнопку меню:', err.message);
    }
  } else {
    console.warn('⚠️  PUBLIC_URL не задан — бот работает через long polling (режим локальной разработки).');
    await bot.api.deleteWebhook().catch(() => {});
    bot.start({ allowed_updates: ['message', 'my_chat_member'] }).catch((e) => console.error('[polling]', e.message));
  }

  app.listen(cfg.port, '0.0.0.0', () => console.log(`🚀 Сервер слушает порт ${cfg.port}`));
  startScheduler();
}

main().catch((err) => {
  console.error('❌ Не удалось запустить приложение:', err);
  process.exit(1);
});
