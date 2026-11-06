// Общие загрузчики: пара пользователя и её участники.
import { query } from './db.js';
import { HttpError } from './errors.js';

export async function getMembers(pairId) {
  const r = await query('SELECT id, name, age, gender FROM users WHERE pair_id = $1 ORDER BY created_at, id', [pairId]);
  return r.rows;
}

/** Пара пользователя (даже если второй участник ещё не присоединился). */
export async function loadPairContext(user) {
  if (!user || !user.pair_id) throw new HttpError(409, 'no_pair');
  const pair = (await query('SELECT * FROM pairs WHERE id = $1', [user.pair_id])).rows[0];
  if (!pair) throw new HttpError(409, 'no_pair');
  const members = await getMembers(pair.id);
  const partner = members.find((m) => m.id !== user.id) || null;
  return { pair, partner };
}

/** Пара, в которой уже оба участника. */
export async function loadActiveContext(user) {
  const ctx = await loadPairContext(user);
  if (!ctx.pair.joined_at || !ctx.partner) throw new HttpError(409, 'not_active');
  return ctx;
}
