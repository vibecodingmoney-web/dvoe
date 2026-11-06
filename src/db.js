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
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,        -- код приглашения
  start_date    TEXT NOT NULL,               -- дата начала отношений, YYYY-MM-DD
  wedding_date  TEXT,                        -- дата свадьбы (необязательная), YYYY-MM-DD
  owner_id      BIGINT NOT NULL,             -- участник А (тот, кто создал пару)
  joined_at     TIMESTAMPTZ,                 -- когда присоединился Б
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id          BIGINT PRIMARY KEY,            -- Telegram user id
  name        TEXT NOT NULL,
  age         SMALLINT,                      -- возраст (14–99)
  gender      TEXT,                          -- 'm' или 'f'
  pair_id     BIGINT REFERENCES pairs(id) ON DELETE SET NULL,
  can_notify  BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_pair_idx ON users(pair_id);

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

-- Памятные даты пары (календарь).
CREATE TABLE IF NOT EXISTS events (
  id           BIGSERIAL PRIMARY KEY,
  pair_id      BIGINT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  emoji        TEXT NOT NULL DEFAULT '💞',
  on_date      TEXT NOT NULL,                -- YYYY-MM-DD
  repeat_kind  TEXT NOT NULL DEFAULT 'none', -- 'none' | 'yearly'
  note         TEXT NOT NULL DEFAULT '',
  remind       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_pair_idx ON events(pair_id);

-- Общий питомец пары: сытость и настроение хранятся на момент stats_at и «тают» со временем.
CREATE TABLE IF NOT EXISTS pets (
  pair_id     BIGINT PRIMARY KEY REFERENCES pairs(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  name        TEXT NOT NULL,
  xp          INT NOT NULL DEFAULT 0,
  fullness    REAL NOT NULL DEFAULT 70,
  joy         REAL NOT NULL DEFAULT 70,
  stats_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  adopted_by  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Журнал заботы: для пауз между действиями и бонуса «позаботились оба».
CREATE TABLE IF NOT EXISTS pet_log (
  id          BIGSERIAL PRIMARY KEY,
  pair_id     BIGINT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL,
  kind        TEXT NOT NULL,
  day         TEXT NOT NULL,                 -- день по APP_TZ
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_log_pair_idx ON pet_log(pair_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pet_log_user_idx ON pet_log(user_id, kind, created_at DESC);

-- Миграции для баз, созданных старой версией (данные не удаляем, только добавляем).
ALTER TABLE users ADD COLUMN IF NOT EXISTS age SMALLINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE pairs ADD COLUMN IF NOT EXISTS wedding_date TEXT;
`;

export async function initDb() {
  await pool.query(SCHEMA);
}
