// «Двое» — клиентская часть Mini App. Чистый JS без сборки: открываешь и читаешь сверху вниз.
// Порядок файла: помощники → API → экраны (HTML-шаблоны) → действия → запуск.

import { petSvg } from './pet-art.js';
import { TEMPLATES, QUICK_TEMPLATES, EMOJIS } from './templates.js';

const tg = window.Telegram?.WebApp;
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const params = new URLSearchParams(location.search);
const DEV_USER = params.get('dev'); // локальная отладка вне Telegram: ?dev=123:Имя (нужен DEV_AUTH=1 на сервере)

/* ====================== помощники ====================== */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const plural = (n, forms) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
};
const DAYS = ['день', 'дня', 'дней'];

const fmtDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(' г.', '');
};
const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const ago = (sec) => {
  if (sec < 60) return 'только что';
  if (sec < 3600) return `${Math.floor(sec / 60)} мин назад`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ч назад`;
  const d = Math.floor(sec / 86400);
  return d === 1 ? 'вчера' : `${d} ${plural(d, DAYS)} назад`;
};

const agoIso = (iso) => (iso ? ago(Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000))) : '—');

const fmtCool = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h} ч ${String(m).padStart(2, '0')} мин` : `${m}:${String(s).padStart(2, '0')}`;
};

const daysLeftText = (n) => (n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} ${plural(n, DAYS)}`);

const breakdownText = (b) => {
  const parts = [];
  if (b.years) parts.push(`${b.years} ${plural(b.years, ['год', 'года', 'лет'])}`);
  if (b.months) parts.push(`${b.months} ${plural(b.months, ['месяц', 'месяца', 'месяцев'])}`);
  if (b.days) parts.push(`${b.days} ${plural(b.days, DAYS)}`);
  return parts.length ? parts.join(' · ') : 'Ваша история только начинается ✨';
};

const ICON = {
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
  paw: '<svg viewBox="0 0 24 24"><circle cx="7" cy="10" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="17" cy="10" r="2"/><path d="M12 12c-3 0-5.5 3-5.5 5.2 0 1.6 1.4 2.3 3 2.3 1 0 1.6-.4 2.5-.4s1.5.4 2.5.4c1.6 0 3-.7 3-2.3C17.5 15 15 12 12 12z"/></svg>',
  us: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9.5" r="2.5"/><path d="M3 19c0-3.4 2.7-5.5 6-5.5s6 2.1 6 5.5M15.5 14.2c3 0 5.5 1.7 5.5 4.8"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>',
};

const ERR = {
  bad_name: 'Введи имя — до 30 символов',
  bad_date: 'Проверь дату',
  bad_age: 'Возраст — от 14 до 99',
  bad_gender: 'Выбери пол',
  bad_wedding: 'Дата свадьбы не может быть раньше начала отношений',
  bad_title: 'Напиши название — до 40 символов',
  bad_repeat: 'Неверное повторение',
  too_many: 'Слишком много дат — удали ненужные',
  not_found: 'Не найдено — возможно, уже удалено',
  already_in_pair: 'Ты уже в паре',
  invite_used: 'Это приглашение уже использовано',
  invite_not_found: 'Приглашение не найдено',
  own_invite: 'Это твоя собственная ссылка — отправь её любимому человеку',
  bad_pet_name: 'Имя питомца — до 16 символов',
  bad_pet_type: 'Выбери питомца',
  pet_exists: 'У вас уже есть питомец',
  pet_egg: 'Яйцу нужно только тепло 🥚',
  pet_hatched: 'Питомец уже вылупился',
  pet_bad_food: 'Такой еды нет',
  pet_full: 'Питомец сыт — подожди немного 🍽',
  pet_hungry: 'Сначала покорми — он голоден',
  pet_enough: 'Ему сейчас и так хорошо 💞',
  no_pet: 'Сначала заведите питомца',
  rate_limited: 'Слишком часто. Подожди минутку',
  unauthorized: 'Открой приложение из Telegram',
  owner_only: 'Даты может менять только создатель пары',
  forbidden: 'Нет доступа',
  server_error: 'Что-то пошло не так. Попробуй ещё раз',
};
const errText = (e) => {
  if (e instanceof TypeError) return 'Нет связи с сервером. Проверь интернет и попробуй снова';
  if (e?.data?.error === 'cooldown') return `Пока рано — снова можно через ${fmtCool(e.data.cooldownSec || 0)}`;
  return ERR[e?.data?.error] || ERR.server_error;
};

/* ====================== состояние ====================== */

const S = {
  data: null, // ответ /api/state
  tab: 'home', // home | cal | pet | us
  inviteCode: null,
  invite: null,
  gender: '', // выбор пола на формах (хранится, чтобы перерисовка не сбрасывала)
  cal: null, // ответ /api/calendar
  calMonth: null, // 'YYYY-MM'
  calDay: null, // выбранный день 'YYYY-MM-DD'
  pet: null, // ответ /api/pet
  petFood: false, // открыт ли выбор еды
  sheet: null, // открытое окно: { mode:'pick'|'form', item }
  cooldownEnd: 0,
  lastSent: null,
  lastRefresh: 0,
  countedUp: false,
  busy: false,
  adminMode: false,
  adminData: null,
  adminError: false,
  adminAt: 0,
};

/** localStorage может быть недоступен — не падаем. */
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ничего страшного */
    }
  },
};
S.adminMode = store.get('dvoe_admin') === '1';
const adminOn = () => Boolean(S.data?.isAdmin && S.adminMode);

/* ====================== Telegram ====================== */

function initTelegram() {
  if (!tg) {
    applyTheme(); // вне Telegram (отладка в браузере) — берём тему системы
    return;
  }
  try {
    tg.ready();
    tg.expand();
    tg.disableVerticalSwipes?.();
  } catch {
    /* старые версии клиента */
  }
  applyTheme();
  tg.onEvent?.('themeChanged', applyTheme);
}

function applyTheme() {
  const dark = tg ? tg.colorScheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try {
    const c = dark ? '#2a0e1b' : '#fff5f7';
    tg?.setHeaderColor?.(c);
    tg?.setBackgroundColor?.(c);
    tg?.setBottomBarColor?.(c);
  } catch {
    /* не поддерживается */
  }
}

function haptic(kind = 'light') {
  try {
    if (kind === 'success' || kind === 'error' || kind === 'warning') tg?.HapticFeedback?.notificationOccurred(kind);
    else tg?.HapticFeedback?.impactOccurred(kind);
  } catch {
    /* ничего */
  }
}

function inviteFromStart() {
  const q = params.get('invite');
  if (q) return q;
  const sp = tg?.initDataUnsafe?.start_param || params.get('startapp') || '';
  return sp.startsWith('pair_') ? sp.slice(5) : null;
}

/** Попросить у Telegram разрешение, чтобы бот мог писать (иначе уведомления не дойдут). */
function requestNotifyAccess({ explain = false } = {}) {
  try {
    if (tg?.requestWriteAccess && tg.isVersionAtLeast?.('6.9') !== false) {
      tg.requestWriteAccess(async (allowed) => {
        if (!allowed) return explain && toast('Без разрешения уведомления не придут. Можно написать боту /start');
        await api('/notify-allowed', { method: 'POST' }).catch(() => {});
        await softRefresh();
        toast('Готово, теперь бот сможет писать 💌');
      });
      return;
    }
  } catch {
    /* падаем в подсказку ниже */
  }
  if (explain) toast('Открой чат с ботом и нажми /start — тогда уведомления будут приходить');
}

/* ====================== API ====================== */

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (tg?.initData) headers.Authorization = `tma ${tg.initData}`;
  else if (DEV_USER) headers['X-Dev-User'] = DEV_USER;
  const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* пустой ответ */
  }
  if (!res.ok) {
    const err = new Error(data?.error || 'error');
    err.status = res.status;
    err.data = data || {};
    throw err;
  }
  return data;
}

async function refresh() {
  const d = await api('/state');
  S.data = d;
  S.lastRefresh = Date.now();
  if (d.home?.thought) S.cooldownEnd = Date.now() + d.home.thought.cooldownSec * 1000;
  if (d.status === 'none' && S.inviteCode && !S.invite) {
    S.invite = await api(`/invite/${encodeURIComponent(S.inviteCode)}`).catch(() => ({ valid: false, reason: 'not_found' }));
  }
}

/* ====================== эффекты ====================== */

function toast(msg, ms = 2800) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}

function mountBackground() {
  const bg = $('#bg');
  const chars = ['♥', '♡', '❀', '✦', '♥'];
  for (let i = 0; i < 14; i += 1) {
    const s = document.createElement('span');
    s.textContent = chars[i % chars.length];
    s.style.left = `${Math.random() * 100}%`;
    s.style.fontSize = `${10 + Math.random() * 18}px`;
    s.style.animationDuration = `${14 + Math.random() * 16}s`;
    s.style.animationDelay = `${-Math.random() * 20}s`;
    s.style.setProperty('--sway', `${Math.random() * 80 - 40}px`);
    s.style.setProperty('--rot', `${Math.random() * 120 - 60}deg`);
    s.style.setProperty('--o', (0.18 + Math.random() * 0.3).toFixed(2));
    bg.appendChild(s);
  }
}

/** Фейерверк из сердечек от центра элемента (или экрана). */
function burst(el) {
  const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const emojis = ['💗', '💖', '💕', '❤️', '💞', '✨'];
  const layer = $('#fx');
  for (let i = 0; i < 18; i += 1) {
    const s = document.createElement('span');
    s.className = 'burst';
    s.textContent = emojis[i % emojis.length];
    s.style.left = `${cx}px`;
    s.style.top = `${cy}px`;
    const a = Math.random() * Math.PI * 2;
    const dist = 70 + Math.random() * 140;
    s.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * dist - 60}px`);
    s.style.setProperty('--r', `${Math.random() * 80 - 40}deg`);
    s.style.fontSize = `${16 + Math.random() * 16}px`;
    layer.appendChild(s);
    setTimeout(() => s.remove(), 1400);
  }
}

function countUp(el, to) {
  if (to <= 0) {
    el.textContent = String(to);
    return;
  }
  const t0 = performance.now();
  const dur = Math.min(1600, 500 + to * 3);
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ====================== экраны ====================== */

const splashView = () => `<div class="splash"><div class="logo">❦</div><div>Открываем вашу историю…</div></div>`;

function errorView(e) {
  const unauth = e?.status === 401 || (!tg && !DEV_USER);
  const text = unauth ? 'Открой приложение из Telegram — через бота или по ссылке-приглашению.' : errText(e);
  return `<section class="screen center">
    <div class="logo" style="--i:0">❦</div>
    <h2 style="text-align:center;--i:1">Не получилось загрузиться</h2>
    <p class="lead" style="--i:2">${esc(text)}</p>
    ${unauth ? '' : '<button class="btn primary" data-act="retry" style="--i:3">Попробовать снова</button>'}
  </section>`;
}

/* ---- поля профиля: пол и возраст ---- */
const genderField = (value) => `<div class="field">Пол
  <div class="seg" role="radiogroup">
    <label class="${value === 'male' ? 'on' : ''}"><input type="radio" name="gender" value="male" ${value === 'male' ? 'checked' : ''} required />👨 Мужской</label>
    <label class="${value === 'female' ? 'on' : ''}"><input type="radio" name="gender" value="female" ${value === 'female' ? 'checked' : ''} />👩 Женский</label>
  </div></div>`;

const ageField = (value) => {
  let opts = '<option value="" disabled' + (value ? '' : ' selected') + '>Выбери</option>';
  for (let a = 14; a <= 99; a += 1) opts += `<option value="${a}"${Number(value) === a ? ' selected' : ''}>${a}</option>`;
  return `<label>Возраст<select name="age" required>${opts}</select></label>`;
};

const profileFields = (v = {}) =>
  `<label>Как тебя зовут?
    <input name="name" maxlength="30" required autocomplete="off" placeholder="Например, Аня" value="${esc(v.name ?? '')}" />
  </label>${genderField(v.gender || S.gender)}${ageField(v.age)}`;

/* ---- онбординг: участник А ---- */
function createView() {
  return `<section class="screen center">
    <div class="logo" style="--i:0">❦</div>
    <h1 class="brand" style="--i:1">Двое</h1>
    <p class="lead" style="--i:2">Маленький тёплый мир для вас двоих: счётчик дней, календарь памятных дат и общий питомец.</p>
    <form class="card form" data-form="create" style="--i:3">
      ${profileFields({ name: S.data.prefillName })}
      <label>Когда начались ваши отношения?
        <input type="date" name="date" required min="1950-01-01" max="${localToday()}" />
      </label>
      <label>Дата свадьбы <span class="opt">необязательно</span>
        <input type="date" name="wedding" min="1950-01-01" />
      </label>
      <button class="btn primary" type="submit">Создать наш мир</button>
    </form>
    <p class="hint" style="--i:4">Потом ты получишь ссылку-приглашение для любимого человека.</p>
  </section>`;
}

/* ---- онбординг: участник Б ---- */
function joinView() {
  const inv = S.invite;
  if (!inv.valid) {
    const msg =
      inv.reason === 'used' ? 'Это приглашение уже использовано.' : inv.reason === 'already_in_pair' ? 'Ты уже состоишь в паре.' : 'Ссылка недействительна или устарела.';
    return `<section class="screen center">
      <div class="logo" style="--i:0">❦</div>
      <h2 style="text-align:center;--i:1">Ой…</h2>
      <p class="lead" style="--i:2">${esc(msg)} Но ты можешь создать свой мир.</p>
      <button class="btn primary" data-act="own" style="--i:3">Создать свой мир</button>
    </section>`;
  }
  return `<section class="screen center">
    <div class="logo" style="--i:0">💞</div>
    <h1 class="brand" style="--i:1;font-size:46px">${esc(inv.inviter)}</h1>
    <p class="lead" style="--i:2">приглашает тебя в «Двое» — маленький тёплый мир для вас двоих.</p>
    <form class="card form" data-form="join" style="--i:3">
      ${profileFields({ name: S.data.prefillName })}
      <button class="btn primary" type="submit">Присоединиться</button>
    </form>
  </section>`;
}

/* ---- уже зарегистрированным без возраста/пола: дозаполнить ---- */
function profileView() {
  const m = S.data.me;
  return `<section class="screen center">
    <div class="logo" style="--i:0">✨</div>
    <h2 style="text-align:center;--i:1">Расскажи о себе</h2>
    <p class="lead" style="--i:2">В приложении появились возраст и пол — укажи их, это займёт секунду.</p>
    <form class="card form" data-form="profile" style="--i:3">
      ${profileFields({ name: m.name, gender: m.gender, age: m.age })}
      <button class="btn primary" type="submit">Продолжить</button>
    </form>
  </section>`;
}

/* ---- общие блоки ---- */
const topbar = (a, b) =>
  `<div class="topbar"><span class="nm">${esc(a)}</span><span class="amp">♥</span>${b ? `<span class="nm">${esc(b)}</span>` : ''}</div>`;

function heroCard(h, idx = 0) {
  return `<div class="card hero" style="--i:${idx}">
    <div class="eyebrow">Мы вместе</div>
    <div class="days" id="days" data-n="${h.days}">${S.countedUp ? h.days : 0}</div>
    <div class="days-label">${plural(h.days, DAYS)}</div>
    <div class="divider">✦</div>
    <div class="breakdown">${esc(breakdownText(h.breakdown))}</div>
    <div class="since">с ${esc(fmtDate(h.startDate))}</div>
  </div>`;
}

function waitingView() {
  const d = S.data;
  return `<section class="screen">
    ${topbar(d.me.name)}
    ${heroCard(d.home, 0)}
    <div class="card" style="--i:1">
      <h2>Позови любимого человека</h2>
      <p class="muted" style="margin:6px 0 0">Как только вы окажетесь тут вдвоём, откроются календарь дат, питомец и «Думаю о тебе».</p>
      <div class="invite-link">${esc(d.pair.inviteLink)}</div>
      <div class="row-btns">
        <button class="btn primary" data-act="share">Отправить приглашение 💌</button>
        <button class="btn ghost" data-act="copy">Скопировать ссылку</button>
      </div>
    </div>
    <p class="hint">Эта страница сама обновится, когда приглашение примут.</p>
  </section>`;
}

/* ---- вкладка «Главная» ---- */
const cooldownLeft = () => Math.max(0, Math.ceil((S.cooldownEnd - Date.now()) / 1000));
function thoughtSub() {
  const left = cooldownLeft();
  return left > 0 ? `Снова можно через ${fmtCool(left)}` : `${S.data.partner.name} получит нежное сообщение от бота`;
}

const itemTitle = (i) => (i.years && i.kind === 'event' ? `${i.title} · ${i.years} ${plural(i.years, ['год', 'года', 'лет'])}` : i.title);

function homeView() {
  const d = S.data;
  const h = d.home;
  const t = h.thought;
  let html = '';

  if (!d.me.canNotify) {
    html += `<div class="notice" style="--i:0"><span>🔔 Разреши боту писать тебе, иначе уведомления не придут</span>
      <button class="btn primary small" data-act="allow">Разрешить</button></div>`;
  }
  if (h.todayItems?.length) {
    html += `<div class="card today-banner" style="--i:0"><div class="eyebrow">Сегодня особенный день</div>${h.todayItems
      .map((i) => `<div class="big">${esc(i.emoji)} ${esc(itemTitle(i))}</div>`)
      .join('')}</div>`;
  }

  html += heroCard(h, 1);

  if (h.wedding) {
    const w = h.wedding;
    const text = w.past ? `В браке: ${breakdownText(w.breakdown)}` : `До свадьбы ${daysLeftText(w.daysLeft)}`;
    html += `<div class="pill-wrap" style="--i:2"><span class="pill">💍 ${esc(text)}</span></div>`;
  }

  if (h.pet?.exists) {
    const p = h.pet;
    html += `<button class="card pet-mini" data-act="tab" data-tab="pet" style="--i:2">
      <span class="pm-art">${petSvg({ type: p.type, stage: p.stageId, mood: p.mood === 'egg' ? 'ok' : p.mood, uid: 'hm' })}</span>
      <span class="pm-txt"><b>${esc(p.name)}</b><span class="muted small">${esc(moodText(p.mood))}</span></span>
      <span class="pm-bars">${bar('🍓', p.stats.fullness)}${bar('💗', p.stats.joy)}</span>
    </button>`;
  } else {
    html += `<button class="card pet-mini adopt" data-act="tab" data-tab="pet" style="--i:2"><span class="pm-art big-e">🥚</span><span class="pm-txt"><b>Заведите питомца</b><span class="muted small">Растите его вместе</span></span></button>`;
  }

  html += `<div class="card thought" style="--i:3">
    <button id="heart" class="heart-btn ${cooldownLeft() > 0 ? 'cool' : ''}" data-act="thought" aria-label="Отправить «Думаю о тебе»">${ICON.heart}</button>
    <div class="t-title">Думаю о тебе</div>
    <div class="t-sub" id="t-sub">${esc(thoughtSub())}</div>
    <div class="sent" id="sent">${S.lastSent ? `«${esc(S.lastSent)}»` : ''}</div>
  </div>`;

  if (t?.received) {
    html += `<div class="card received" style="--i:4">
      <div class="who">💌 ${esc(d.partner.name)} · ${esc(ago(t.received.agoSec))}</div>
      <div class="quote">«${esc(t.received.phrase)}»</div>
    </div>`;
  }

  if (h.next) {
    html += `<button class="card next" data-act="tab" data-tab="cal" style="--i:5">
      <div class="ms-top"><span class="chip gold">Ближайшая дата</span><span class="muted small">${esc(daysLeftText(h.next.daysLeft))}</span></div>
      <div class="ms-title">${esc(h.next.emoji)} ${esc(itemTitle(h.next))}</div>
      ${h.next.progress != null ? `<div class="bar"><i style="width:${Math.round(h.next.progress * 100)}%"></i></div>` : ''}
      <div class="muted small" style="margin-top:8px">${esc(fmtDate(h.next.date))}</div>
    </button>`;
  }
  return html;
}

const bar = (icon, v) => `<span class="mbar"><i>${icon}</i><b><u style="width:${v}%"></u></b></span>`;
const moodText = (m) => ({ egg: 'Ждёт тепла', hungry: 'Голоден', sad: 'Скучает', happy: 'Счастлив', ok: 'Всё хорошо' })[m] || '';

/* ====================== календарь ====================== */

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const monthName = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
  return s[0].toUpperCase() + s.slice(1);
};
const shiftMonth = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function calendarView() {
  const c = S.cal;
  if (!S.calMonth) S.calMonth = S.data.today.slice(0, 7);
  const month = S.calMonth;
  let html = `<div class="card cal-card" style="--i:0">
    <div class="cal-head">
      <button class="icon-btn" data-act="month" data-d="-1" aria-label="Предыдущий месяц">‹</button>
      <div class="cal-title">${esc(monthName(month))}</div>
      <button class="icon-btn" data-act="month" data-d="1" aria-label="Следующий месяц">›</button>
    </div>
    <div class="cal-week">${WEEK.map((w) => `<span>${w}</span>`).join('')}</div>`;

  if (!c || c.month !== month) {
    html += `<div class="cal-loading muted">Загружаем…</div></div>`;
    return html;
  }

  const byDay = {};
  c.items.forEach((i) => (byDay[i.date] ||= []).push(i));
  const [y, m] = month.split('-').map(Number);
  const first = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const len = new Date(y, m, 0).getDate();
  let cells = '';
  for (let i = 0; i < first; i += 1) cells += '<span class="cell empty"></span>';
  for (let d = 1; d <= len; d += 1) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const list = byDay[date] || [];
    const cls = ['cell', date === c.today ? 'today' : '', date === S.calDay ? 'sel' : '', list.length ? 'has' : ''].join(' ');
    cells += `<button class="${cls}" data-act="day" data-date="${date}"><b>${d}</b><i>${list.slice(0, 2).map((x) => esc(x.emoji)).join('')}</i></button>`;
  }
  html += `<div class="cal-grid">${cells}</div></div>`;

  // выбранный день
  if (S.calDay && S.calDay.startsWith(month)) {
    const list = byDay[S.calDay] || [];
    html += `<div class="card" style="--i:1"><div class="sec-title">${esc(fmtDate(S.calDay))}</div>
      ${list.length ? `<ul class="evs">${list.map(eventRow).join('')}</ul>` : '<p class="muted small" style="margin:4px 0 10px">В этот день пока ничего нет</p>'}
      <button class="btn ghost" data-act="add" data-date="${S.calDay}">＋ Добавить на этот день</button></div>`;
  }

  // быстрые шаблоны
  html += `<div class="card" style="--i:2"><div class="sec-title">Добавить памятную дату</div>
    <div class="quick">${QUICK_TEMPLATES.map((id) => {
      const t = TEMPLATES.find((x) => x.id === id);
      return `<button class="qchip" data-act="tpl" data-id="${t.id}">${t.emoji} ${esc(t.title)}</button>`;
    }).join('')}<button class="qchip more" data-act="add">Все шаблоны…</button></div></div>`;

  // ближайшие
  html += `<div class="card" style="--i:3"><div class="sec-title">Ближайшие даты</div>
    ${c.upcoming.length ? `<ul class="evs">${c.upcoming.map((i) => eventRow(i, true)).join('')}</ul>` : '<p class="muted small" style="margin:4px 0 0">Пока пусто — добавьте первую дату выше ✨</p>'}</div>`;
  return html;
}

function eventRow(i, withLeft = false) {
  const sub = withLeft ? `${fmtDate(i.date)} · ${daysLeftText(i.daysLeft)}` : i.note || (i.repeat === 'yearly' ? 'Каждый год' : i.kind === 'auto' ? 'Автоматически' : '');
  const edit = i.editable ? `<button class="icon-btn sm" data-act="edit" data-key="${esc(i.key)}" aria-label="Изменить">✎</button>` : '';
  return `<li class="ev"><span class="ev-e">${esc(i.emoji)}</span><span class="ev-t"><b>${esc(itemTitle(i))}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${edit}</li>`;
}

/* ---- нижнее окно (шаблоны и форма даты) ---- */
function sheetHtml() {
  const sh = S.sheet;
  if (!sh) return '';
  const d = S.data;
  let body = '';
  if (sh.mode === 'pick') {
    body = `<h3>Выбери шаблон</h3><div class="tpl-grid">${TEMPLATES.map(
      (t) => `<button class="tpl" data-act="tpl" data-id="${t.id}"><span>${t.emoji}</span>${esc(t.custom ? t.label : fill(t.title))}</button>`,
    ).join('')}</div>`;
  } else {
    const it = sh.item;
    body = `<h3>${it.id ? 'Изменить дату' : 'Новая дата'}</h3>
    <form class="form" data-form="event">
      <label>Название<input name="title" maxlength="40" required value="${esc(it.title)}" placeholder="Например, Первый поцелуй" /></label>
      <label>Дата<input type="date" name="date" required min="1950-01-01" value="${esc(it.date)}" /></label>
      <div class="field">Значок<div class="emojis">${EMOJIS.map(
        (e) => `<label class="${e === it.emoji ? 'on' : ''}"><input type="radio" name="emoji" value="${e}" ${e === it.emoji ? 'checked' : ''} />${e}</label>`,
      ).join('')}</div></div>
      <label class="check"><input type="checkbox" name="yearly" ${it.repeat === 'yearly' ? 'checked' : ''} /> Повторять каждый год</label>
      <label class="check"><input type="checkbox" name="remind" ${it.remind ? 'checked' : ''} /> Напомнить нам обоим</label>
      <label>Заметка <span class="opt">необязательно</span><input name="note" maxlength="140" value="${esc(it.note || '')}" placeholder="Что вспомнить в этот день" /></label>
      <button class="btn primary" type="submit">Сохранить</button>
      ${it.id ? '<button class="btn ghost danger" type="button" data-act="del-event">Удалить дату</button>' : ''}
    </form>`;
  }
  return `<div class="sheet-bg" data-act="close-sheet"></div><div class="sheet" role="dialog"><button class="sheet-x" data-act="close-sheet" aria-label="Закрыть">✕</button>${body}</div>`;
}

const fill = (s) => s.replace('{me}', S.data.me.name).replace('{partner}', S.data.partner?.name || '');

function renderSheet() {
  const el = $('#sheet');
  el.innerHTML = sheetHtml();
  el.classList.toggle('open', Boolean(S.sheet));
  el.setAttribute('aria-hidden', S.sheet ? 'false' : 'true');
  document.body.classList.toggle('lock', Boolean(S.sheet));
}

/* ====================== питомец ====================== */

function petView() {
  const p = S.pet;
  if (!p) return `<div class="card waiting"><div class="dots"><span>●</span><span>●</span><span>●</span></div><div>Загружаем питомца…</div></div>`;
  if (!p.exists) return adoptView(p);

  const egg = p.stage.id === 'egg';
  const mood = egg ? 'ok' : p.mood;
  const cds = p.cooldowns;
  const hugLeft = Math.max(0, cds.hug - Math.floor((Date.now() - S.petAt) / 1000));
  const warmLeft = Math.max(0, cds.warm - Math.floor((Date.now() - S.petAt) / 1000));
  const crack = p.stage.progress > 0.66 ? 2 : p.stage.progress > 0.33 ? 1 : 0;

  let html = `<div class="card pet-card m-${p.mood}" style="--i:0">
    <div class="pet-top"><div><div class="eyebrow">${esc(p.stage.title)} · ${p.ageDays} ${plural(p.ageDays, DAYS)}</div>
      <h2 class="pet-name">${esc(p.name)} <button class="icon-btn sm" data-act="rename" aria-label="Переименовать">✎</button></h2></div>
      <span class="chip ${p.mood === 'hungry' || p.mood === 'sad' ? 'gold' : ''}">${esc(moodText(p.mood))}</span></div>
    <div class="pet-stage" id="pet-stage">${petSvg({ type: p.type, stage: p.stage.id, mood, crack, uid: 'pt' })}<div id="pet-fx"></div></div>
    ${egg ? '' : `<div class="stats">${stat('🍓', 'Сытость', p.stats.fullness)}${stat('💗', 'Настроение', p.stats.joy)}</div>`}
    <div class="grow"><div class="muted small">${p.stage.nextFrom ? `Любовь: ${p.xp} / ${p.stage.nextFrom} до стадии «${esc(p.stage.nextTitle)}»` : `Любовь: ${p.xp} — вы вырастили взрослого питомца 🎉`}</div>
      <div class="bar"><i style="width:${Math.round(p.stage.progress * 100)}%"></i></div></div>
  </div>`;

  if (egg) {
    html += `<div class="card" style="--i:1"><p class="muted" style="margin:0 0 12px">Яйцо проснётся, когда вы согреете его вместе. Каждый может греть раз в 10 минут.</p>
      <button class="btn primary" data-act="care" data-kind="warm" ${warmLeft > 0 ? 'disabled' : ''}>${warmLeft > 0 ? `Согреть через ${fmtCool(warmLeft)}` : 'Согреть яйцо 🔥'}</button></div>`;
  } else {
    html += `<div class="card" style="--i:1"><div class="acts">
      <button class="act" data-act="food-toggle"><span>🍓</span>Покормить</button>
      <button class="act" data-act="care" data-kind="play"><span>🎾</span>Поиграть</button>
      <button class="act" data-act="care" data-kind="hug" ${hugLeft > 0 ? 'disabled' : ''}><span>🤗</span>${hugLeft > 0 ? fmtCool(hugLeft) : 'Обнять'}</button></div>
      ${S.petFood ? `<div class="foods">${p.foods.map((f) => `<button class="food" data-act="care" data-kind="feed" data-food="${f.id}"><span>${f.emoji}</span>${esc(f.title)}</button>`).join('')}</div>` : ''}</div>`;
  }

  const meDone = p.care.me;
  const pDone = p.care.partner;
  html += `<div class="card" style="--i:2"><div class="sec-title">Забота сегодня</div>
    <div class="care-row"><span class="${meDone ? 'ok' : ''}">${meDone ? '✅' : '⚪'} Ты</span><span class="${pDone ? 'ok' : ''}">${pDone ? '✅' : '⚪'} ${esc(S.data.partner.name)}</span></div>
    <p class="muted small" style="margin:8px 0 0">Если сегодня позаботитесь оба — питомец получит бонус любви 💞</p>
    ${p.last ? `<p class="small" style="margin:10px 0 0">${esc(p.last.text)} · ${esc(ago(p.last.agoSec))}</p>` : ''}</div>`;
  return html;
}

const stat = (icon, label, v) => `<div class="stat"><span>${icon} ${label}</span><div class="bar"><i class="${v < 25 ? 'low' : ''}" style="width:${v}%"></i></div></div>`;

function adoptView(p) {
  const pick = S.petType || p.types[0].id;
  return `<div class="card adopt-card" style="--i:0"><div class="eyebrow">Новый друг</div><h2>Заведите питомца</h2>
    <p class="muted" style="margin:0 0 14px">Один на двоих. Он начнёт с яйца — согревайте его вместе, потом кормите и играйте.</p>
    <div class="types">${p.types.map((t) => `<button class="type ${t.id === pick ? 'on' : ''}" data-act="pick-type" data-id="${t.id}">${petSvg({ type: t.id, stage: 'kid', mood: 'happy', uid: 'ad' + t.id })}<span>${esc(t.title)}</span></button>`).join('')}</div>
    <form class="form" data-form="adopt" style="margin-top:14px">
      <label>Имя питомца<input name="name" maxlength="16" placeholder="${esc(p.types.find((t) => t.id === pick).defaultName)}" /></label>
      <button class="btn primary" type="submit">Завести 🥚</button></form></div>`;
}

/* ====================== вкладка «Мы» ====================== */

function usView() {
  const d = S.data;
  const m = d.me;
  const pr = d.partner;
  const gl = (g) => (g === 'male' ? '👨' : g === 'female' ? '👩' : '');
  return `<div class="card" style="--i:0">
      <div class="sec-title">Вы двое</div>
      <div class="who-row"><span>${gl(m.gender)} ${esc(m.name)}${m.age ? `, ${m.age}` : ''}</span><span class="muted small">это ты</span></div>
      <div class="who-row"><span>${gl(pr.gender)} ${esc(pr.name)}${pr.age ? `, ${pr.age}` : ''}</span></div>
    </div>
    <div class="card" style="--i:1">
      <div class="sec-title">Мой профиль</div>
      <form class="form" data-form="profile">${profileFields({ name: m.name, gender: m.gender, age: m.age })}
        <button class="btn ghost" type="submit">Сохранить</button></form>
    </div>
    <div class="card" style="--i:2">
      <div class="sec-title">Наши даты</div>
      ${
        m.isOwner
          ? `<form class="form" data-form="dates">
        <label>Начало отношений<input type="date" name="date" required min="1950-01-01" max="${localToday()}" value="${esc(d.pair.startDate)}" /></label>
        <label>Дата свадьбы <span class="opt">необязательно</span><input type="date" name="wedding" min="1950-01-01" value="${esc(d.pair.weddingDate || '')}" /></label>
        <button class="btn ghost" type="submit">Сохранить даты</button></form>`
          : `<p class="muted" style="margin:6px 0 0">Начало: ${esc(fmtDate(d.pair.startDate))}${d.pair.weddingDate ? `<br>Свадьба: ${esc(fmtDate(d.pair.weddingDate))}` : ''}</p>
        <p class="muted small">Даты меняет создатель пары.</p>`
      }
    </div>
    ${d.me.canNotify ? '' : '<button class="btn ghost" data-act="allow" style="margin-bottom:14px">🔔 Разрешить уведомления</button>'}
    <p class="hint">Двое · сделано с любовью ❤️</p>`;
}

/* ====================== админ-режим ====================== */

function adminPairCard(p) {
  const active = p.status === 'active';
  const names = p.members.map((m) => esc(m.name)).join(' <span class="amp">♥</span> ') || '—';
  const people = p.members
    .map(
      (m) => `<div class="who"><span>${m.isOwner ? '👑 ' : ''}${esc(m.name)} <i>#${m.id}</i></span>
        <span>${m.canNotify ? '🔔' : '🔕'} в сети: ${esc(agoIso(m.lastSeen))}</span></div>`,
    )
    .join('');
  return `<div class="card pair">
    <div class="pair-h"><div class="pair-names">${names}${active ? '' : ' <span class="muted">· ждёт партнёра</span>'}</div>
      <span class="chip${active ? '' : ' gold'}">${active ? 'Вместе' : 'Ждёт'}</span></div>
    <div class="pair-meta">с ${esc(fmtDate(p.startDate))} · ${p.days} ${plural(p.days, DAYS)}</div>
    <div class="pair-stats"><span>📅 ${p.events} дат</span><span>${p.pet ? '🐾 ' + esc(p.pet.name) : '🐾 —'}</span><span>💌 ${p.thoughts} «думаю»</span><span>⏱ ${esc(agoIso(p.lastActivity))}</span></div>
    <div class="pair-people">${people}</div>
    <div class="pair-foot">создана ${esc(agoIso(p.createdAt))} · код <code>${esc(p.code)}</code></div>
  </div>`;
}

function adminView() {
  const a = S.adminData;
  let html = `<div class="topbar"><span class="nm">Админ</span><span class="amp">⚙</span></div>`;
  if (S.adminError) {
    html += `<div class="notice"><span>Не удалось загрузить данные</span><button class="btn primary small" data-act="admin-refresh">Повторить</button></div>`;
  }
  if (!a) return `<section class="screen">${html}${S.adminError ? '' : '<p class="hint">Загружаем данные…</p>'}</section>`;

  const t = a.totals;
  const tile = (n, label, sub) =>
    `<div class="tile"><div class="n">${n}</div><div class="l">${label}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  html += `<div class="stat-grid">
    ${tile(t.activePairs, 'Активных пар', `ждут партнёра: ${t.pairs - t.activePairs}`)}
    ${tile(t.users, 'Пользователей', `за 7 дней: +${t.new7d}`)}
    ${tile(t.active24h, 'Заходили за 24 ч')}
    ${tile(t.thoughts, '«Думаю о тебе»', `за 24 ч: ${t.thoughts24h}`)}
    ${tile(t.events, 'Памятных дат')}
    ${tile(t.pets, 'Питомцев')}
    ${tile(t.notifiable, 'Можно писать', `без пары: ${t.noPair}`)}
  </div>`;

  html += `<h2 class="adm-h">Все пары <span class="muted">(${a.pairs.length})</span></h2>`;
  html += a.pairs.length ? a.pairs.map(adminPairCard).join('') : `<div class="card"><p class="muted" style="margin:0">Пока нет ни одной пары.</p></div>`;

  if (a.lonely.length) {
    html += `<h2 class="adm-h">Без пары <span class="muted">(${a.lonely.length})</span></h2><div class="card">${a.lonely
      .map((m) => `<div class="who"><span>${esc(m.name)} <i>#${m.id}</i></span><span>${m.canNotify ? '🔔' : '🔕'} в сети: ${esc(agoIso(m.lastSeen))}</span></div>`)
      .join('')}</div>`;
  }

  const time = new Date(a.generatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  html += `<button class="btn ghost" data-act="admin-refresh" style="margin-top:6px">Обновить · данные на ${esc(time)}</button>
    <p class="hint">Тексты ответов не показываются — это личное пар.</p>`;
  return `<section class="screen">${html}</section>`;
}

async function loadAdmin() {
  try {
    S.adminData = await api('/admin/overview');
    S.adminError = false;
  } catch {
    S.adminError = true;
  }
  S.adminAt = Date.now();
  if (adminOn()) render();
}

/* ====================== отрисовка ====================== */

const TABS = [
  ['home', 'Главная', ICON.heart],
  ['cal', 'Календарь', ICON.cal],
  ['pet', 'Питомец', ICON.paw],
  ['us', 'Мы', ICON.us],
];
const navHtml = () =>
  `<nav class="tabs">${TABS.map(([k, label, icon]) => `<button data-act="tab" data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${icon}<span>${label}</span></button>`).join('')}</nav>`;

const modeBtn = () =>
  S.data?.isAdmin ? `<button class="mode-switch${S.adminMode ? ' on' : ''}" data-act="mode">${S.adminMode ? '👤 Обычный режим' : '⚙️ Админ-режим'}</button>` : '';

function render() {
  const d = S.data;
  app.classList.toggle('has-admin', Boolean(d.isAdmin));

  if (adminOn()) {
    app.classList.add('no-nav');
    app.innerHTML = adminView() + modeBtn();
    return;
  }
  const needProfile = d.status !== 'none' && !d.me.profileComplete;
  app.classList.toggle('no-nav', d.status !== 'active' || needProfile);

  if (d.status === 'none') {
    app.innerHTML = (S.invite ? joinView() : createView()) + modeBtn();
    return;
  }
  if (needProfile) {
    app.innerHTML = profileView() + modeBtn();
    return;
  }
  if (d.status === 'waiting') {
    app.innerHTML = waitingView() + modeBtn();
    runCountUp();
    return;
  }
  app.innerHTML = `${modeBtn()}${topbar(d.me.name, d.partner.name)}<div id="view"></div>${navHtml()}`;
  renderTab();
  loadTab();
}

function renderTab(soft = false) {
  const view = $('#view');
  if (!view) return;
  const html = { home: homeView, cal: calendarView, pet: petView, us: usView }[S.tab]();
  view.className = soft ? 'noanim' : '';
  view.innerHTML = `<div class="screen">${html}</div>`;
  if (S.tab === 'home') runCountUp();
}

function runCountUp() {
  const el = $('#days');
  if (el && !S.countedUp) {
    S.countedUp = true;
    countUp(el, Number(el.dataset.n));
  }
}

function updateNav() {
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
}

function updateCooldownUI() {
  const sub = $('#t-sub');
  const btn = $('#heart');
  if (!sub || !btn) return;
  btn.classList.toggle('cool', cooldownLeft() > 0);
  sub.textContent = thoughtSub();
}

/* ====================== загрузки ====================== */

async function loadCalendar() {
  if (!S.calMonth) S.calMonth = S.data.today.slice(0, 7);
  const month = S.calMonth;
  try {
    const c = await api(`/calendar?month=${month}`);
    if (month !== S.calMonth) return;
    S.cal = c;
    if (!S.calDay) S.calDay = c.today.startsWith(month) ? c.today : null;
  } catch (e) {
    toast(errText(e));
  }
  if (S.tab === 'cal') renderTab(true);
}

async function loadPet() {
  try {
    S.pet = await api('/pet');
    S.petAt = Date.now();
  } catch (e) {
    toast(errText(e));
  }
  if (S.tab === 'pet') renderTab(true);
}

function loadTab() {
  if (S.tab === 'cal') loadCalendar();
  if (S.tab === 'pet') loadPet();
}

async function softRefresh() {
  try {
    const prev = S.data?.status;
    await refresh();
    if (prev && prev !== S.data.status) {
      render();
      if (S.data.status === 'active') {
        burst();
        haptic('success');
        toast('🎉 Вы теперь вдвоём в «Двое»!');
      }
      return;
    }
    if (S.data.status === 'active' && (S.tab === 'home' || S.tab === 'us') && !S.sheet) renderTab(true);
  } catch (e) {
    if (e.status === 401) app.innerHTML = errorView(e);
  }
}

/* ====================== действия ====================== */

const todayIso = () => S.data?.today || localToday();

function openTemplate(id) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  S.sheet = {
    mode: 'form',
    item: { id: null, title: t.custom ? '' : fill(t.title), emoji: t.emoji, date: S.calDay || todayIso(), repeat: t.yearly ? 'yearly' : 'none', remind: true, note: '' },
  };
  renderSheet();
}

function findItem(key) {
  return [...(S.cal?.items || []), ...(S.cal?.upcoming || [])].find((i) => i.key === key);
}

/** Мини-анимация над питомцем (сердечки, еда). */
function petFx(emoji) {
  const box = $('#pet-fx');
  if (!box) return;
  for (let i = 0; i < 5; i += 1) {
    const s = document.createElement('span');
    s.textContent = emoji;
    s.style.left = `${20 + Math.random() * 60}%`;
    s.style.animationDelay = `${i * 90}ms`;
    box.appendChild(s);
    setTimeout(() => s.remove(), 1600);
  }
}

const ACTIONS = {
  mode() {
    if (!S.data?.isAdmin) return;
    S.adminMode = !S.adminMode;
    store.set('dvoe_admin', S.adminMode ? '1' : '0');
    haptic('light');
    window.scrollTo(0, 0);
    render();
    if (S.adminMode) loadAdmin();
    else softRefresh();
  },

  'admin-refresh'() {
    haptic('light');
    loadAdmin();
  },

  tab(el) {
    const tab = el.dataset.tab;
    if (S.tab === tab && $('#view')) return;
    S.tab = tab;
    haptic('light');
    window.scrollTo(0, 0);
    updateNav();
    renderTab();
    loadTab();
    if (tab === 'home') softRefresh();
  },

  async thought(btn) {
    if (S.busy) return;
    const left = cooldownLeft();
    if (left > 0) {
      haptic('warning');
      toast(`Снова можно через ${fmtCool(left)} ⏳`);
      return;
    }
    S.busy = true;
    try {
      const r = await api('/thought', { method: 'POST' });
      S.lastSent = r.phrase;
      S.cooldownEnd = Date.now() + r.cooldownSec * 1000;
      burst(btn);
      haptic('success');
      const sent = $('#sent');
      if (sent) sent.textContent = `«${r.phrase}»`;
      updateCooldownUI();
      toast(r.delivered ? 'Отправлено 💌' : 'Сохранено 💌 Бот пока не может написать, но в приложении это будет видно');
    } catch (e) {
      if (e.status === 429) {
        S.cooldownEnd = Date.now() + (e.data.cooldownSec || 0) * 1000;
        updateCooldownUI();
      }
      haptic('error');
      toast(errText(e));
    } finally {
      S.busy = false;
    }
  },

  share() {
    const url = S.data.pair.shareUrl;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, '_blank');
  },

  async copy() {
    const link = S.data.pair.inviteLink;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    haptic('success');
    toast('Ссылка скопирована 💞');
  },

  allow() {
    requestNotifyAccess({ explain: true });
  },

  own() {
    S.inviteCode = null;
    S.invite = null;
    render();
  },

  retry() {
    boot();
  },

  /* календарь */
  month(el) {
    S.calMonth = shiftMonth(S.calMonth, Number(el.dataset.d));
    S.calDay = S.calMonth === todayIso().slice(0, 7) ? todayIso() : null;
    haptic('light');
    renderTab(true);
    loadCalendar();
  },
  day(el) {
    S.calDay = el.dataset.date;
    haptic('light');
    renderTab(true);
  },
  add(el) {
    if (el.dataset.date) S.calDay = el.dataset.date;
    S.sheet = { mode: 'pick' };
    renderSheet();
  },
  tpl(el) {
    openTemplate(el.dataset.id);
  },
  edit(el) {
    const i = findItem(el.dataset.key);
    if (!i) return;
    S.sheet = { mode: 'form', item: { id: i.id, title: i.title, emoji: i.emoji, date: i.base, repeat: i.repeat, remind: i.remind, note: i.note } };
    renderSheet();
  },
  'close-sheet'() {
    S.sheet = null;
    renderSheet();
  },
  async 'del-event'() {
    const id = S.sheet?.item?.id;
    if (!id || S.busy) return;
    if (!confirm('Удалить эту дату?')) return;
    S.busy = true;
    try {
      await api(`/events/${id}`, { method: 'DELETE' });
      S.sheet = null;
      renderSheet();
      toast('Дата удалена');
      await loadCalendar();
    } catch (e) {
      toast(errText(e));
    } finally {
      S.busy = false;
    }
  },

  /* питомец */
  'pick-type'(el) {
    S.petType = el.dataset.id;
    renderTab(true);
  },
  'food-toggle'() {
    S.petFood = !S.petFood;
    renderTab(true);
  },
  async rename() {
    const name = prompt('Как назвать питомца?', S.pet.name);
    if (name === null) return;
    try {
      S.pet = await api('/pet', { method: 'PATCH', body: { name } });
      S.petAt = Date.now();
      renderTab(true);
    } catch (e) {
      toast(errText(e));
    }
  },
  async care(el) {
    if (S.busy || el.disabled) return;
    S.busy = true;
    const kind = el.dataset.kind;
    try {
      const r = await api('/pet/action', { method: 'POST', body: { kind, food: el.dataset.food } });
      S.pet = r.pet;
      S.petAt = Date.now();
      S.petFood = false;
      haptic('success');
      renderTab(true);
      petFx({ feed: '🍓', play: '🎾', hug: '💗', warm: '🔥' }[kind]);
      const res = r.result || {};
      if (res.hatched) {
        burst($('#pet-stage'));
        toast(`🎉 ${S.pet.name} вылупился! Знакомьтесь`);
      } else if (res.grew) {
        burst($('#pet-stage'));
        toast(`✨ ${S.pet.name} вырос — теперь «${S.pet.stage.title}»`);
      } else if (res.bonus) {
        toast('💞 Вы оба сегодня позаботились — бонус любви!');
      } else {
        toast(`+${res.gained ?? 0} любви`);
      }
    } catch (e) {
      haptic('error');
      if (e.status === 429) loadPet();
      toast(errText(e));
    } finally {
      S.busy = false;
    }
  },
};

/** Выполнить действие формы: блокирует кнопку на время запроса, показывает ошибку тостом. */
async function withBusy(form, fn) {
  const btn = form.querySelector('button[type=submit]');
  if (btn) btn.disabled = true;
  try {
    await fn();
  } catch (e) {
    haptic('error');
    toast(errText(e));
    if (e?.status === 401) app.innerHTML = errorView(e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

const profileBody = (form) => ({ name: form.name.value, age: Number(form.age.value), gender: form.gender.value });

const FORMS = {
  create: (form) =>
    withBusy(form, async () => {
      await api('/pair/create', { method: 'POST', body: { ...profileBody(form), startDate: form.date.value, weddingDate: form.wedding.value || null } });
      await refresh();
      S.countedUp = false;
      render();
      haptic('success');
      if (!S.data.me.canNotify) requestNotifyAccess();
    }),

  join: (form) =>
    withBusy(form, async () => {
      await api('/pair/join', { method: 'POST', body: { code: S.inviteCode, ...profileBody(form) } });
      S.inviteCode = null;
      S.invite = null;
      await refresh();
      S.countedUp = false;
      S.tab = 'home';
      render();
      burst();
      haptic('success');
      toast('Добро пожаловать в «Двое» 💞');
      if (!S.data.me.canNotify) requestNotifyAccess();
    }),

  profile: (form) =>
    withBusy(form, async () => {
      await api('/me', { method: 'PATCH', body: profileBody(form) });
      await refresh();
      render();
      toast('Сохранено');
    }),

  dates: (form) =>
    withBusy(form, async () => {
      await api('/pair', { method: 'PATCH', body: { startDate: form.date.value, weddingDate: form.wedding.value || null } });
      await refresh();
      S.countedUp = false;
      S.cal = null;
      renderTab(true);
      toast('Даты сохранены');
    }),

  event: (form) =>
    withBusy(form, async () => {
      const it = S.sheet.item;
      const body = {
        title: form.title.value,
        date: form.date.value,
        emoji: form.emoji.value || '💞',
        repeat: form.yearly.checked ? 'yearly' : 'none',
        remind: form.remind.checked,
        note: form.note.value,
      };
      if (it.id) await api(`/events/${it.id}`, { method: 'PUT', body });
      else await api('/events', { method: 'POST', body });
      S.sheet = null;
      renderSheet();
      haptic('success');
      toast('Дата сохранена 📅');
      S.calMonth = body.date.slice(0, 7) === S.calMonth || body.repeat === 'yearly' ? S.calMonth : body.date.slice(0, 7);
      await loadCalendar();
    }),

  adopt: (form) =>
    withBusy(form, async () => {
      const p = S.pet;
      S.pet = await api('/pet/adopt', { method: 'POST', body: { type: S.petType || p.types[0].id, name: form.name.value } });
      S.petAt = Date.now();
      haptic('success');
      burst();
      renderTab(true);
      toast('Яйцо у вас! Согрейте его 🥚');
    }),
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el) ACTIONS[el.dataset.act]?.(el, e);
});
$('#sheet').addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el) ACTIONS[el.dataset.act]?.(el, e);
});
for (const root of [app, $('#sheet')]) {
  root.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    FORMS[form.dataset.form]?.(form);
  });
  // подсветка выбранного пола / значка
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.type === 'radio') {
      if (t.name === 'gender') S.gender = t.value;
      t.closest('.seg, .emojis')?.querySelectorAll('label').forEach((l) => l.classList.toggle('on', l.contains(t)));
    }
  });
}

/* ====================== запуск ====================== */

async function boot() {
  app.innerHTML = splashView();
  try {
    await refresh();
    render();
    if (adminOn()) loadAdmin();
  } catch (e) {
    app.innerHTML = errorView(e);
  }
}

// Таймер кулдаунов — раз в секунду обновляем только подписи.
setInterval(() => {
  updateCooldownUI();
  if (S.tab === 'pet' && S.pet?.exists && !S.sheet) {
    const left = S.pet.cooldowns.hug - Math.floor((Date.now() - S.petAt) / 1000);
    const warm = S.pet.cooldowns.warm - Math.floor((Date.now() - S.petAt) / 1000);
    if ((S.pet.cooldowns.hug > 0 && left <= 0) || (S.pet.cooldowns.warm > 0 && warm <= 0)) {
      S.pet.cooldowns = { hug: Math.max(0, left), warm: Math.max(0, warm) };
      renderTab(true);
    }
  }
}, 1000);

// Фоновое обновление.
setInterval(async () => {
  if (document.hidden || !S.data || S.sheet) return;
  if (adminOn()) return Date.now() - S.adminAt > 60_000 ? loadAdmin() : undefined;
  if (S.data.status === 'waiting') return softRefresh();
  if (S.data.status !== 'active') return;
  if (S.tab === 'home' && Date.now() - S.lastRefresh > 45_000) return softRefresh();
  if (S.tab === 'pet' && S.pet && Date.now() - S.petAt > 30_000) return loadPet();
}, 12_000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !S.data || adminOn() || S.data.status === 'none') return;
  softRefresh();
  if (S.data.status === 'active') loadTab();
});

S.inviteCode = inviteFromStart();
initTelegram();
mountBackground();
boot();
