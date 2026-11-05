// Проверка подписи Telegram (initData). Без неё любой смог бы притвориться любым пользователем.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
import crypto from 'node:crypto';

/**
 * Возвращает { user, startParam } если подпись верна и данные свежие, иначе null.
 * maxAgeSec — сколько секунд initData считается действительным (по умолчанию сутки).
 */
export function validateInitData(initData, botToken, maxAgeSec = 86400) {
  if (!initData || typeof initData !== 'string' || initData.length > 4096 || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;

  try {
    const user = JSON.parse(params.get('user') || 'null');
    if (!user || typeof user.id !== 'number') return null;
    return { user, startParam: params.get('start_param') || null };
  } catch {
    return null;
  }
}

/** Сравнение секретов без утечки по времени. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
