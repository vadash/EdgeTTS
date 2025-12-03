import { Text } from 'preact-i18n';
import { useLanguage } from '../../stores';
import type { SupportedLocale } from '../../stores/LanguageStore';

export function LanguageSelector() {
  const language = useLanguage();
  const current = language.locale.value;

  const setLocale = (locale: SupportedLocale) => {
    language.setLocale(locale);
  };

  return (
    <div class="language-selector">
      <button
        class={`language-btn ${current === 'en' ? 'active' : ''}`}
        onClick={() => setLocale('en')}
        aria-label="English"
      >
        <Text id="language.en">EN</Text>
      </button>
      <button
        class={`language-btn ${current === 'ru' ? 'active' : ''}`}
        onClick={() => setLocale('ru')}
        aria-label="Russian"
      >
        <Text id="language.ru">RU</Text>
      </button>
    </div>
  );
}
