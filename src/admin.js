// Данные для админ-режима: все пары и сводная статистика.
// Личное (заметки к датам, названия событий) сюда намеренно НЕ попадает — только количества.
import { query } from './db.js';
import { todayStr, daysBetween } from './dates.js';
import { stageOf } from './pet-core.js';

const iso = (d) => (d ? new Date(d).toISOString() : null);
const latest = (...xs) => xs.filter(Boolean).map((x) => new Date(x).getTime()).reduce((a, b) => Math.max(a, b), 0) || null;

export async function adminOverview() {
  const [totalsRes, pairsRes, usersRes] = await Promise.all([
    query(`SELECT
      (SELECT count(*) FROM users)                                                   AS users,
      (SELECT count(*) FROM pairs)                                                   AS pairs,
      (SELECT count(*) FROM pairs WHERE joined_at IS NOT NULL)                       AS active_pairs,
      (SELECT count(*) FROM users WHERE pair_id IS NULL)                             AS no_pair,
      (SELECT count(*) FROM users WHERE can_notify)                                  AS notifiable,
      (SELECT count(*) FROM users WHERE last_seen > now() - interval '24 hours')     AS active_24h,
      (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days')      AS new_7d,
      (SELECT count(*) FROM thoughts)                                                AS thoughts,
      (SELECT count(*) FROM thoughts WHERE created_at > now() - interval '24 hours') AS thoughts_24h,
      (SELECT count(*) FROM events)                                                  AS events,
      (SELECT count(*) FROM pets)                                                    AS pets`),
    query(`SELECT p.id, p.code, p.start_date, p.wedding_date, p.owner_id, p.created_at, p.joined_at,
      (SELECT count(*) FROM thoughts t WHERE t.pair_id = p.id) AS thoughts,
      (SELECT count(*) FROM events e WHERE e.pair_id = p.id)   AS events,
      (SELECT max(t.created_at) FROM thoughts t WHERE t.pair_id = p.id) AS last_thought,
      (SELECT max(l.created_at) FROM pet_log l WHERE l.pair_id = p.id)  AS last_care,
      pt.name AS pet_name, pt.type AS pet_type, pt.xp AS pet_xp
      FROM pairs p LEFT JOIN pets pt ON pt.pair_id = p.id
      ORDER BY p.created_at DESC LIMIT 500`),
    query(`SELECT id, name, age, gender, pair_id, can_notify, last_seen, created_at FROM users ORDER BY created_at LIMIT 3000`),
  ]);

  const t = totalsRes.rows[0];
  const today = todayStr();

  const byPair = new Map();
  const lonely = [];
  for (const u of usersRes.rows) {
    const member = {
      id: u.id,
      name: u.name,
      age: u.age ?? null,
      gender: u.gender ?? null,
      canNotify: u.can_notify,
      lastSeen: iso(u.last_seen),
      createdAt: iso(u.created_at),
    };
    if (u.pair_id == null) lonely.push(member);
    else (byPair.get(u.pair_id) || byPair.set(u.pair_id, []).get(u.pair_id)).push(member);
  }

  const pairs = pairsRes.rows.map((p) => {
    const members = (byPair.get(p.id) || [])
      .map((m) => ({ ...m, isOwner: m.id === p.owner_id }))
      .sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
    return {
      id: p.id,
      code: p.code,
      status: p.joined_at ? 'active' : 'waiting',
      startDate: p.start_date,
      weddingDate: p.wedding_date || null,
      days: Math.max(0, daysBetween(p.start_date, today)),
      createdAt: iso(p.created_at),
      joinedAt: iso(p.joined_at),
      thoughts: p.thoughts,
      events: p.events,
      pet: p.pet_name ? { name: p.pet_name, type: p.pet_type, stage: stageOf(p.pet_xp).title } : null,
      lastActivity: iso(latest(p.last_thought, p.last_care, ...members.map((m) => m.lastSeen))),
      members,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      users: t.users,
      pairs: t.pairs,
      activePairs: t.active_pairs,
      noPair: t.no_pair,
      notifiable: t.notifiable,
      active24h: t.active_24h,
      new7d: t.new_7d,
      thoughts: t.thoughts,
      thoughts24h: t.thoughts_24h,
      events: t.events,
      pets: t.pets,
    },
    pairs,
    lonely,
  };
}
