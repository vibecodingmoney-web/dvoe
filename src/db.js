// База данных: Postgres (рекомендуем бесплатный Neon или Supabase).
// Бесплатный Postgres на Render удаляется через 30 дней — для него не подходит.
import pg from 'pg';
import { cfg } from './config.js';

// bigint (id Telegram, счётчики) отдаём как обычные числа: id Telegram помещаются в 2^53.
pg.types.setTypeParser(20, (v) => Number(v));

const isLocal = /@(localhost|127\.0\.0\.1)/.test(cfg.databaseUrl);
const hasSslMode = /sslmode=/.test(cfg.databaseUrl);

export const pool = new pg.Pool({
  connectionString: cfg.databaseUrl,
  ssl: isLocal ? false : hasSslMode ? undefined : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

// Neon «засыпает» и рвёт неактивные соединения — без этого обработчика процесс бы упал.
pool.on('error', (err) => console.error('[pg] ошибка неактивного соединения:', err.message));

export const query = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* соединение уже закрыто */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Занять «ключ уведомления»: true — мы первые (можно слать), false — уже отправляли. */
export async function claim(key) {
  const r = await query('INSERT INTO notif_log(key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
  return r.rowCount === 1;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pairs (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,        -- код приглашения
  start_date  TEXT NOT NULL,               -- дата начала отношений, YYYY-MM-DD
  owner_id    BIGINT NOT NULL,             -- участник А (тот, кто создал пару)
  joined_at   TIMESTAMPTZ,                 -- когда присоединился Б
  joined_on   TEXT,                        -- та же дата строкой (по APP_TZ), от неё идёт нумерация вопросов
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id          BIGINT PRIMARY KEY,          -- Telegram user id
  name        TEXT NOT NULL,
  pair_id     BIGINT REFERENCES pairs(id) ON DELETE SET NULL,
  can_notify  BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_pair_idx ON users(pair_id);

CREATE TABLE IF NOT EXISTS answers (
  pair_id     BIGINT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  q_date      TEXT NOT NULL,               -- день вопроса YYYY-MM-DD
  user_id     BIGINT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pair_id, q_date, user_id)
);

CREATE TABLE IF NOT EXISTS thoughts (
  id          BIGSERIAL PRIMARY KEY,
  pair_id     BIGINT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  from_user   BIGINT NOT NULL,
  phrase      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS thoughts_user_idx ON thoughts(from_user, created_at DESC);
CREATE INDEX IF NOT EXISTS thoughts_pair_idx ON thoughts(pair_id, created_at DESC);

-- Журнал отправленных уведомлений: по ключу не даёт отправить одно и то же дважды.
CREATE TABLE IF NOT EXISTS notif_log (
  key         TEXT PRIMARY KEY,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function initDb() {
  await pool.query(SCHEMA);
}
