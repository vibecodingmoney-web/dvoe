// «Двое» — клиентская часть Mini App. Чистый JS без сборки: открываешь и читаешь сверху вниз.
// Порядок файла: помощники → API → экраны (HTML-шаблоны) → действия → запуск.

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
  chat: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3.5 20.5l1.4-4.9A8.5 8.5 0 1 1 21 11.5z"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>',
};

const ERR = {
  bad_name: 'Введи имя — до 30 символов',
  bad_date: 'Проверь дату: она не может быть в будущем',
  already_in_pair: 'Ты уже в паре',
  invite_used: 'Это приглашение уже использовано',
  invite_not_found: 'Приглашение не найдено',
  own_invite: 'Это твоя собственная ссылка — отправь её любимому человеку',
  empty: 'Напиши хотя бы пару слов',
  too_long: 'Слишком длинно — максимум 600 символов',
  already_answered: 'Ответ на сегодняшний вопрос уже сохранён',
  rate_limited: 'Слишком часто. Подожди минутку',
  unauthorized: 'Открой приложение из Telegram',
  owner_only: 'Дату может менять только создатель пары',
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
  tab: 'home',
  inviteCode: null,
  invite: null, // ответ /api/invite/:code
  question: null,
  history: null,
  draft: '',
  cooldownEnd: 0,
  lastSent: null,
  lastRefresh: 0,
  countedUp: false,
  busy: false,
};

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

/* ---- онбординг: участник А ---- */
function createView() {
  return `<section class="screen center">
    <div class="logo" style="--i:0">❦</div>
    <h1 class="brand" style="--i:1">Двое</h1>
    <p class="lead" style="--i:2">Маленький тёплый мир для вас двоих: счётчик ваших дней, вопрос дня и нежные послания.</p>
    <form class="card form" data-form="create" style="--i:3">
      <label>Как тебя зовут?
        <input name="name" maxlength="30" required autocomplete="off" placeholder="Например, Аня" value="${esc(S.data.prefillName)}" />
      </label>
      <label>Когда начались ваши отношения?
        <input type="date" name="date" required min="1950-01-01" max="${localToday()}" />
      </label>
      <button class="btn primary" type="submit">Создать наш мир</button>
    </form>
    <p class="hint" style="--i:4">Потом ты получишь ссылку-приглашение для любимого человека.</p>
  </section>`;
}

/* ---- онбординг: участник Б (по приглашению) ---- */
function joinView() {
  const inv = S.invite;
  if (!inv.valid) {
    const msg =
      inv.reason === 'used'
        ? 'Это приглашение уже использовано.'
        : inv.reason === 'already_in_pair'
          ? 'Ты уже состоишь в паре.'
          : 'Ссылка недействительна или устарела.';
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
      <label>Как тебя зовут?
        <input name="name" maxlength="30" required autocomplete="off" placeholder="Твоё имя" value="${esc(S.data.prefillName)}" />
      </label>
      <button class="btn primary" type="submit">Присоединиться</button>
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

/* ---- ожидание второго участника ---- */
function waitingView() {
  const d = S.data;
  return `<section class="screen">
    ${topbar(d.me.name)}
    ${heroCard(d.home, 0)}
    <div class="card" style="--i:1">
      <h2>Позови любимого человека</h2>
      <p class="muted" style="margin:6px 0 0">Как только вы окажетесь тут вдвоём, откроются вопрос дня, «Думаю о тебе» и напоминания о ваших датах.</p>
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
function thoughtSub() {
  const left = cooldownLeft();
  return left > 0 ? `Снова можно через ${fmtCool(left)}` : `${S.data.partner.name} получит нежное сообщение от бота`;
}
const cooldownLeft = () => Math.max(0, Math.ceil((S.cooldownEnd - Date.now()) / 1000));

function homeView() {
  const d = S.data;
  const h = d.home;
  const t = h.thought;
  let html = '';

  if (!d.me.canNotify) {
    html += `<div class="notice" style="--i:0"><span>🔔 Разреши боту писать тебе, иначе уведомления не придут</span>
      <button class="btn primary small" data-act="allow">Разрешить</button></div>`;
  }
  if (h.today) {
    html += `<div class="card today-banner" style="--i:0"><div class="eyebrow">Сегодня особенный день</div><div class="big">🎉 ${esc(h.today.title)}</div></div>`;
  }

  html += heroCard(h, 1);

  html += `<div class="pill-wrap" style="--i:2"><span class="pill">${
    h.streak > 0
      ? `🔥 Серия: ${h.streak} ${plural(h.streak, DAYS)} подряд`
      : '✨ Ответьте на вопрос дня вместе — начнётся серия'
  }</span></div>`;

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
    html += `<div class="card" style="--i:5">
      <div class="ms-top"><span class="chip gold">Ближайшая дата</span><span class="muted small">${esc(daysLeftText(h.next.daysLeft))}</span></div>
      <div class="ms-title">${esc(h.next.title)}</div>
      <div class="bar"><i style="width:${Math.round(h.next.progress * 100)}%"></i></div>
      <div class="muted small" style="margin-top:8px">${esc(fmtDate(h.next.date))}</div>
    </div>`;
  }
  return html;
}

/* ---- вкладка «Вопрос» ---- */
function questionView() {
  const q = S.question;
  if (!q) return `<div class="card waiting"><div class="dots"><span>●</span><span>●</span><span>●</span></div><div>Загружаем вопрос дня…</div></div>`;
  const me = S.data.me.name;
  const partner = S.data.partner.name;

  let html = `<div class="card q-card" style="--i:0">
    <div class="eyebrow">Вопрос дня · №${q.number}</div>
    <div class="q-text">${esc(q.text)}</div>
  </div>`;

  if (q.mine === null) {
    html += `<form class="card form" data-form="answer" style="--i:1">
      <label>Твой ответ
        <textarea name="text" maxlength="600" placeholder="Напиши от души…">${esc(S.draft)}</textarea>
      </label>
      <div class="counter"><span id="cnt">${S.draft.length}</span>/600</div>
      <p class="small muted" style="margin:-6px 0 0">${
        q.partnerAnswered
          ? '🔒 Ответ любимого человека уже ждёт — он откроется, как только ты ответишь.'
          : 'Ответы откроются, когда ответите оба.'
      }</p>
      <button class="btn primary" type="submit">Ответить</button>
    </form>`;
  } else {
    html += `<div class="card" style="--i:1">
      <div class="bubble mine"><span class="nm">${esc(me)}</span>${esc(q.mine)}</div>
      ${
        q.theirs
          ? `<div class="bubble theirs"><span class="nm">${esc(partner)}</span>${esc(q.theirs)}</div>`
          : `<div class="waiting"><div class="dots"><span>●</span><span>●</span><span>●</span></div>${esc(partner)} ещё думает над ответом</div>`
      }
    </div>`;
  }

  if (S.history) {
    html += `<div class="card" style="--i:2"><div class="sec-title">Прошлые вопросы</div>`;
    if (!S.history.length) {
      html += `<p class="muted small" style="margin:6px 0 0">Здесь появятся вопросы, на которые ответили оба.</p>`;
    } else {
      html += S.history
        .map(
          (x) => `<details class="hist"><summary><span>№${x.number ?? '·'}</span><span class="dt">${esc(fmtDate(x.date))}</span></summary>
            <div class="qq">${esc(x.text)}</div>
            <div class="bubble mine"><span class="nm">${esc(me)}</span>${esc(x.mine)}</div>
            <div class="bubble theirs"><span class="nm">${esc(x.partnerName)}</span>${esc(x.theirs)}</div>
          </details>`,
        )
        .join('');
    }
    html += '</div>';
  }
  return html;
}

/* ---- вкладка «Даты» ---- */
function datesView() {
  const d = S.data;
  const h = d.home;
  const up = h.upcoming
    .map(
      (m, i) => `<li class="${i === 0 ? 'first' : ''}"><div class="t">${esc(m.title)}</div>
        <div class="s">${esc(fmtDate(m.date))} · ${esc(daysLeftText(m.daysLeft))}</div></li>`,
    )
    .join('');
  const past = h.past
    .map(
      (m) => `<li class="done"><div class="t">${esc(m.title)}</div>
        <div class="s">${esc(fmtDate(m.date))} · ${m.daysAgo === 0 ? 'сегодня' : `${m.daysAgo} ${plural(m.daysAgo, DAYS)} назад`}</div></li>`,
    )
    .join('');

  return `<div class="card" style="--i:0">
      <div class="sec-title">Впереди</div>
      <ul class="tl">${up || '<li><div class="s">Все ближайшие даты уже позади — скоро появятся новые ✨</div></li>'}</ul>
    </div>
    ${past ? `<div class="card" style="--i:1"><div class="sec-title">Уже было</div><ul class="tl">${past}</ul></div>` : ''}
    <div class="card" style="--i:2">
      <div class="sec-title">Настройки</div>
      <form class="form" data-form="name">
        <label>Моё имя<input name="name" maxlength="30" required value="${esc(d.me.name)}" /></label>
        <button class="btn ghost" type="submit">Сохранить имя</button>
      </form>
      ${
        d.me.isOwner
          ? `<form class="form" data-form="date" style="margin-top:18px">
              <label>Дата начала отношений<input type="date" name="date" required min="1950-01-01" max="${localToday()}" value="${esc(h.startDate)}" /></label>
              <button class="btn ghost" type="submit">Сохранить дату</button>
            </form>`
          : ''
      }
    </div>
    <p class="hint">Двое · сделано с любовью ❤️</p>`;
}

/* ====================== отрисовка ====================== */

const navHtml = () =>
  `<nav class="tabs">${[
    ['home', 'Главная', ICON.heart],
    ['question', 'Вопрос', ICON.chat],
    ['dates', 'Даты', ICON.cal],
  ]
    .map(([k, label, icon]) => `<button data-act="tab" data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${icon}<span>${label}</span></button>`)
    .join('')}</nav>`;

function render() {
  const d = S.data;
  app.classList.toggle('no-nav', d.status !== 'active');

  if (d.status === 'none') {
    app.innerHTML = S.invite ? joinView() : createView();
    return;
  }
  if (d.status === 'waiting') {
    app.innerHTML = waitingView();
    runCountUp();
    return;
  }
  app.innerHTML = `${topbar(d.me.name, d.partner.name)}<div id="view"></div>${navHtml()}`;
  renderTab();
  if (S.tab === 'question') loadQuestion();
}

/** Перерисовать только содержимое вкладки. soft = без анимации появления (для фоновых обновлений). */
function renderTab(soft = false) {
  const view = $('#view');
  if (!view) return;
  const html = S.tab === 'home' ? homeView() : S.tab === 'question' ? questionView() : datesView();
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
  const left = cooldownLeft();
  btn.classList.toggle('cool', left > 0);
  sub.textContent = thoughtSub();
}

/* ====================== загрузки ====================== */

async function loadQuestion() {
  try {
    const [q, hist] = await Promise.all([api('/question'), api('/question/history')]);
    S.question = q;
    S.history = hist;
  } catch (e) {
    toast(errText(e));
  }
  if (S.tab === 'question') renderTab(true);
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
    if (S.data.status === 'active' && S.tab === 'home') renderTab(true);
    if (S.data.status === 'active' && S.tab === 'dates') renderTab(true);
  } catch (e) {
    if (e.status === 401) app.innerHTML = errorView(e);
  }
}

/* ====================== действия ====================== */

const ACTIONS = {
  async tab(el) {
    const tab = el.dataset.tab;
    if (S.tab === tab) return;
    S.tab = tab;
    haptic('light');
    updateNav();
    renderTab();
    if (tab === 'question') loadQuestion();
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

  async retry() {
    boot();
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

const FORMS = {
  create: (form) =>
    withBusy(form, async () => {
      await api('/pair/create', { method: 'POST', body: { name: form.name.value, startDate: form.date.value } });
      await refresh();
      S.countedUp = false;
      render();
      haptic('success');
      if (!S.data.me.canNotify) requestNotifyAccess();
    }),

  join: (form) =>
    withBusy(form, async () => {
      await api('/pair/join', { method: 'POST', body: { code: S.inviteCode, name: form.name.value } });
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

  answer: (form) =>
    withBusy(form, async () => {
      const text = form.text.value.trim();
      if (!text) throw Object.assign(new Error('empty'), { data: { error: 'empty' } });
      S.question = await api('/question/answer', { method: 'POST', body: { text } });
      S.draft = '';
      haptic('success');
      renderTab(true);
      if (S.question.theirs) {
        burst();
        toast('Ответы открыты ✨');
      } else {
        toast('Ответ сохранён 💌');
      }
    }),

  name: (form) =>
    withBusy(form, async () => {
      await api('/me', { method: 'PATCH', body: { name: form.name.value } });
      await refresh();
      render();
      toast('Имя сохранено');
    }),

  date: (form) =>
    withBusy(form, async () => {
      await api('/pair', { method: 'PATCH', body: { startDate: form.date.value } });
      await refresh();
      S.countedUp = false;
      render();
      toast('Дата сохранена');
    }),
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el) ACTIONS[el.dataset.act]?.(el, e);
});
app.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  FORMS[form.dataset.form]?.(form);
});
app.addEventListener('input', (e) => {
  if (e.target.name === 'text' && e.target.closest('[data-form="answer"]')) {
    S.draft = e.target.value;
    const c = $('#cnt');
    if (c) c.textContent = String(S.draft.length);
  }
});

/* ====================== запуск ====================== */

async function boot() {
  app.innerHTML = splashView();
  try {
    await refresh();
    render();
    // Если бот ещё не может писать, на главной появится плашка «Разрешить» (без назойливых диалогов).
  } catch (e) {
    app.innerHTML = errorView(e);
  }
}

// Таймер кулдауна «Думаю о тебе» — раз в секунду обновляем только подпись.
setInterval(updateCooldownUI, 1000);

// Фоновое обновление: ждём партнёра / новые сообщения / ответ на вопрос.
setInterval(async () => {
  if (document.hidden || !S.data) return;
  if (S.data.status === 'waiting') return softRefresh();
  if (S.data.status !== 'active') return;
  if (S.tab === 'home' && Date.now() - S.lastRefresh > 45_000) return softRefresh();
  if (S.tab === 'question' && S.question && S.question.mine !== null && !S.question.theirs) {
    try {
      const q = await api('/question');
      if (JSON.stringify(q) !== JSON.stringify(S.question)) {
        S.question = q;
        if (S.tab === 'question') renderTab(true);
        if (q.theirs) {
          haptic('success');
          burst();
          toast('Ответы открыты ✨');
        }
      }
    } catch {
      /* попробуем в следующий раз */
    }
  }
}, 12_000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.data && S.data.status !== 'none') softRefresh();
});

S.inviteCode = inviteFromStart();
initTelegram();
mountBackground();
boot();
