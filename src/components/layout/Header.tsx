import { Text } from 'preact-i18n';
import { navigate, isConvertRoute, isSettingsRoute, isLogsRoute } from '@/router';
import { useLanguage } from '@/stores';
import type { SupportedLocale } from '@/stores/LanguageStore';

export function Header() {
  const language = useLanguage();
  const current = language.locale.value;

  const setLocale = (locale: SupportedLocale) => {
    language.setLocale(locale);
  };

  return (
    <header className="bg-primary-secondary border-b border-border px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Logo / Title */}
        <h1 className="text-lg font-semibold text-white">
          Edge TTS
        </h1>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          <button
            onClick={() => navigate('convert')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${isConvertRoute.value
                ? 'bg-accent text-white'
                : 'text-gray-400 hover:text-white hover:bg-primary-tertiary'
              }`}
          >
            <Text id="nav.convert">Convert</Text>
          </button>
          <button
            onClick={() => navigate('settings')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${isSettingsRoute.value
                ? 'bg-accent text-white'
                : 'text-gray-400 hover:text-white hover:bg-primary-tertiary'
              }`}
          >
            <Text id="nav.settings">Settings</Text>
          </button>
        </nav>

        {/* Language Selector */}
        <div className="flex items-center gap-1 bg-primary rounded-lg p-1">
          <button
            onClick={() => setLocale('en')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors
              ${current === 'en'
                ? 'bg-accent text-white'
                : 'text-gray-400 hover:text-white'
              }`}
            aria-label="English"
          >
            EN
          </button>
          <button
            onClick={() => setLocale('ru')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors
              ${current === 'ru'
                ? 'bg-accent text-white'
                : 'text-gray-400 hover:text-white'
              }`}
            aria-label="Russian"
          >
            RU
          </button>
        </div>
      </div>
    </header>
  );
}
