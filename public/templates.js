// Шаблоны памятных дат: выбрал шаблон — название, значок и повтор подставятся сами.
// {me} и {partner} заменяются на имена. yearly: true — дата повторяется каждый год (годовщина).
// Хотите добавить свой шаблон — допишите строку в массив.

export const TEMPLATES = [
  { id: 'first_date', emoji: '💞', title: 'Первое свидание', yearly: true },
  { id: 'first_kiss', emoji: '💋', title: 'Первый поцелуй', yearly: true },
  { id: 'first_meet', emoji: '👀', title: 'Первая встреча', yearly: true },
  { id: 'first_love', emoji: '💌', title: 'Первое «люблю»', yearly: true },
  { id: 'first_trip', emoji: '✈️', title: 'Первая поездка', yearly: true },
  { id: 'move_in', emoji: '🏠', title: 'Стали жить вместе', yearly: true },
  { id: 'parents', emoji: '🫶', title: 'Знакомство с родителями', yearly: true },
  { id: 'proposal', emoji: '💍', title: 'Предложение', yearly: true },
  { id: 'pet', emoji: '🐾', title: 'Появился питомец', yearly: true },
  { id: 'bday_me', emoji: '🎂', title: 'День рождения · {me}', yearly: true },
  { id: 'bday_partner', emoji: '🎂', title: 'День рождения · {partner}', yearly: true },
  { id: 'custom', emoji: '✨', title: '', yearly: false, custom: true, label: 'Своя дата' },
];

/** Какие шаблоны показывать быстрыми кнопками на странице календаря. */
export const QUICK_TEMPLATES = ['first_date', 'first_kiss', 'first_meet', 'first_love', 'first_trip', 'move_in'];

export const EMOJIS = ['💞', '💋', '💍', '🎂', '✈️', '🏠', '🎁', '🌹', '🍷', '🎬', '🎵', '🏖️', '📸', '🐾', '⭐', '✨'];
