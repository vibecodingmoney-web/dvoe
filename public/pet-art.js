// Нарисованные питомцы (SVG). Ничего не грузится из сети: картинка собирается строкой.
//
//   petSvg({ type, stage, mood, uid })  — питомец: type cat | bunny | bear | dog,
//                                         stage baby | kid | adult | egg, mood hungry | sad | happy | ok
//   Для яйца: petSvg({ type, stage: 'egg', crack: 0..2 })
//
// uid нужен, чтобы у нескольких картинок на странице не совпадали id градиентов.
// Анимации (покачивание, моргание, жевание) описаны в style.css по классам .bob .eyes .chew .egg-wob.

const COLORS = {
  cat: { body: '#ffcf99', light: '#ffe8cc', belly: '#fff1de', inner: '#ff9fb6', dark: '#e9a766' },
  bunny: { body: '#f6e6ec', light: '#ffffff', belly: '#ffffff', inner: '#ffb8cb', dark: '#e3c4cf' },
  bear: { body: '#d49a62', light: '#e8b585', belly: '#f1d3ad', inner: '#b9773f', dark: '#b9773f' },
  dog: { body: '#f1d09b', light: '#fae6c3', belly: '#fff2dc', inner: '#c88a52', dark: '#c88a52' },
};
const INK = '#3b1f2c';
const SCALE = { baby: 0.6, kid: 0.8, adult: 1 };

function ears(type, c) {
  if (type === 'cat') {
    return `<path d="M50 92 L54 38 L96 70 Z" fill="${c.body}" stroke="${c.body}" stroke-width="10" stroke-linejoin="round"/>
      <path d="M150 92 L146 38 L104 70 Z" fill="${c.body}" stroke="${c.body}" stroke-width="10" stroke-linejoin="round"/>
      <path d="M60 80 L62 54 L84 69 Z" fill="${c.inner}" stroke="${c.inner}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M140 80 L138 54 L116 69 Z" fill="${c.inner}" stroke="${c.inner}" stroke-width="4" stroke-linejoin="round"/>`;
  }
  if (type === 'bunny') {
    return `<g transform="rotate(-10 78 70)"><ellipse cx="78" cy="42" rx="17" ry="38" fill="${c.body}"/><ellipse cx="78" cy="46" rx="8.5" ry="27" fill="${c.inner}"/></g>
      <g transform="rotate(10 122 70)"><ellipse cx="122" cy="42" rx="17" ry="38" fill="${c.body}"/><ellipse cx="122" cy="46" rx="8.5" ry="27" fill="${c.inner}"/></g>`;
  }
  if (type === 'bear') {
    return `<circle cx="58" cy="76" r="21" fill="${c.body}"/><circle cx="58" cy="76" r="11" fill="${c.inner}"/>
      <circle cx="142" cy="76" r="21" fill="${c.body}"/><circle cx="142" cy="76" r="11" fill="${c.inner}"/>`;
  }
  return `<path d="M56 76 C28 82 22 130 42 144 C60 138 72 108 72 84 Z" fill="${c.dark}"/>
    <path d="M144 76 C172 82 178 130 158 144 C140 138 128 108 128 84 Z" fill="${c.dark}"/>`;
}

function tail(type, c) {
  if (type === 'cat') return `<path d="M160 152 C198 148 198 106 176 100" fill="none" stroke="${c.body}" stroke-width="13" stroke-linecap="round"/>`;
  if (type === 'dog') return `<path d="M160 148 C180 140 186 120 176 108" fill="none" stroke="${c.body}" stroke-width="13" stroke-linecap="round"/>`;
  if (type === 'bunny') return `<circle cx="164" cy="152" r="13" fill="#fff"/>`;
  return `<circle cx="162" cy="150" r="10" fill="${c.body}"/>`;
}

function nose(type) {
  if (type === 'dog') return `<ellipse cx="100" cy="124" rx="8" ry="6" fill="${INK}"/>`;
  if (type === 'bear') return `<ellipse cx="100" cy="125" rx="7.5" ry="5.5" fill="${INK}"/>`;
  return `<path d="M94.5 122.5 Q100 128.5 105.5 122.5 Q100 118 94.5 122.5Z" fill="#e8708f"/>`;
}

function mouth(mood) {
  if (mood === 'happy') {
    return `<g class="chew"><path d="M88 131 Q100 154 112 131 Z" fill="#8f2d48"/><ellipse cx="100" cy="143" rx="6.5" ry="4" fill="#ff8fa8"/></g>`;
  }
  if (mood === 'hungry') return `<ellipse class="chew" cx="100" cy="139" rx="6.5" ry="8.5" fill="#8f2d48"/>`;
  if (mood === 'sad') return `<path d="M90 143 Q100 133 110 143" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>`;
  // ok: «ω»
  return `<g class="chew"><path d="M88 133 Q94 141 100 131 Q106 141 112 133" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

const face = (type, c, mood) => {
  const brows =
    mood === 'sad'
      ? `<path d="M63 99 L87 106" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/><path d="M137 99 L113 106" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>
         <path d="M69 125 q-6 10 0 14 q6 -4 0 -14z" fill="#8fd3ff"/>`
      : '';
  const sweat = mood === 'hungry' ? `<path d="M152 80 q-9 13 0 18 q9 -5 0 -18z" fill="#8fd3ff"/>` : '';
  const patch = type === 'dog' ? `<ellipse cx="127" cy="112" rx="18" ry="19" fill="${c.dark}" opacity=".9"/>` : '';
  const muzzle = type === 'bear' ? `<ellipse cx="100" cy="131" rx="23" ry="17" fill="${c.belly}"/>` : '';
  const stripes =
    type === 'cat'
      ? `<g stroke="${c.dark}" stroke-width="4" stroke-linecap="round"><path d="M92 76v10"/><path d="M100 73v14"/><path d="M108 76v10"/></g>`
      : '';
  const whiskers =
    type === 'cat'
      ? `<g stroke="#b98a76" stroke-width="2.2" stroke-linecap="round" opacity=".8"><path d="M58 124 L34 119"/><path d="M58 131 L34 135"/><path d="M142 124 L166 119"/><path d="M142 131 L166 135"/></g>`
      : '';
  return `${stripes}${patch}${muzzle}
    <ellipse cx="62" cy="130" rx="11" ry="7" fill="#ff8fab" opacity=".5"/><ellipse cx="138" cy="130" rx="11" ry="7" fill="#ff8fab" opacity=".5"/>
    <g class="eyes">
      <ellipse cx="76" cy="112" rx="7.5" ry="9.5" fill="${INK}"/><circle cx="78.6" cy="108" r="2.9" fill="#fff"/><circle cx="73.4" cy="116" r="1.5" fill="#fff" opacity=".85"/>
      <ellipse cx="124" cy="112" rx="7.5" ry="9.5" fill="${INK}"/><circle cx="126.6" cy="108" r="2.9" fill="#fff"/><circle cx="121.4" cy="116" r="1.5" fill="#fff" opacity=".85"/>
    </g>
    ${brows}${nose(type)}${mouth(mood)}${whiskers}${sweat}`;
};

const bow = `<g transform="translate(62 88)"><path d="M0 0 L-17 -10 L-17 10 Z M0 0 L17 -10 L17 10 Z" fill="#ff6f98" stroke="#ff6f98" stroke-width="3" stroke-linejoin="round"/><circle r="5.5" fill="#ff3f78"/></g>`;

function egg(type, uid, crack) {
  const c = COLORS[type] || COLORS.cat;
  const cracks = [
    crack >= 1 ? `<path d="M68 72 L82 84 L73 95 L89 104" fill="none" stroke="#6b3a4a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : '',
    crack >= 2
      ? `<path d="M134 66 L121 80 L131 90 L118 101" fill="none" stroke="#6b3a4a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
         <path d="M100 34 L95 52 L106 61" fill="none" stroke="#6b3a4a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
      : '',
  ].join('');
  return `<svg class="pet-svg m-egg" viewBox="0 0 200 200" role="img" aria-label="Яйцо">
    <defs><radialGradient id="${uid}-e" cx="35%" cy="28%" r="85%"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="${c.light}"/><stop offset="1" stop-color="${c.body}"/></radialGradient></defs>
    <ellipse cx="100" cy="184" rx="50" ry="8" fill="rgba(0,0,0,.12)"/>
    <g class="egg-wob">
      <path d="M100 24 C146 24 166 96 166 130 C166 164 138 184 100 184 C62 184 34 164 34 130 C34 96 54 24 100 24Z" fill="url(#${uid}-e)"/>
      <g fill="${c.dark}" opacity=".45"><circle cx="78" cy="78" r="9"/><circle cx="130" cy="104" r="12"/><circle cx="88" cy="150" r="10"/><circle cx="134" cy="150" r="7"/></g>
      <path d="M100 150 C80 136 76 126 76 120 A12 12 0 0 1 100 114 A12 12 0 0 1 124 120 C124 126 120 136 100 150 Z" fill="#ff7fa3" opacity=".92"/>
      <ellipse cx="78" cy="58" rx="9" ry="14" fill="#fff" opacity=".35" transform="rotate(-24 78 58)"/>
      ${cracks}
    </g>
  </svg>`;
}

/** Питомец (или яйцо, если stage === 'egg'). */
export function petSvg({ type = 'cat', stage = 'adult', mood = 'ok', crack = 0, uid = 'p' } = {}) {
  if (stage === 'egg') return egg(type, uid, crack);
  const c = COLORS[type] || COLORS.cat;
  const s = SCALE[stage] || 1;
  const names = { cat: 'Котик', bunny: 'Зайка', bear: 'Мишка', dog: 'Щенок' };
  return `<svg class="pet-svg m-${mood}" viewBox="0 0 200 200" role="img" aria-label="${names[type] || 'Питомец'}">
    <defs><radialGradient id="${uid}-b" cx="34%" cy="28%" r="85%"><stop offset="0" stop-color="${c.light}"/><stop offset="1" stop-color="${c.body}"/></radialGradient></defs>
    <ellipse cx="100" cy="182" rx="${54 * s}" ry="${8 * s}" fill="rgba(0,0,0,.13)"/>
    <g transform="translate(100 180) scale(${s}) translate(-100 -180)">
      <g class="bob">
        ${tail(type, c)}${ears(type, c)}
        <ellipse cx="70" cy="172" rx="17" ry="10" fill="${c.body}"/><ellipse cx="130" cy="172" rx="17" ry="10" fill="${c.body}"/>
        <ellipse cx="100" cy="120" rx="65" ry="57" fill="url(#${uid}-b)"/>
        <ellipse cx="100" cy="146" rx="36" ry="26" fill="${c.belly}" opacity=".8"/>
        ${face(type, c, mood)}
        ${stage === 'adult' ? bow : ''}
      </g>
    </g>
  </svg>`;
}
