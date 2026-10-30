// Participant-facing Ukrainian texts, all in one place. Drafts are written and
// edited in docs/12-app-texts.md of the private research repo (decision 72);
// this file mirrors the approved versions. Labels seen only in dev mode live
// next to the code that uses them.

export const texts = {
  common: {
    pageTitle: 'Онлайн-дослідження',
    next: 'Далі',
    sessionEnd: 'Дякуємо! Цю сторінку можна закрити.',
  },
  data: {
    sending: 'Зберігаємо ваші відповіді. Будь ласка, не закривайте сторінку.',
    offline:
      'Не вдається надіслати відповіді: схоже, зникло з’єднання з інтернетом. Не закривайте сторінку — відповіді надішлються, щойно з’єднання відновиться.',
  },
  errors: {
    badLink: 'Посилання некоректне. Перевірте, чи ви скопіювали його повністю.',
    loadFailed:
      'Не вдалося завантажити сторінку. Перевірте з’єднання з інтернетом і оновіть сторінку.',
  },
};
