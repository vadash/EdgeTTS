import { render } from 'preact';
import { IntlProvider } from 'preact-i18n';
import { App } from './App';
import en from './i18n/en.json';
import ru from './i18n/ru.json';
import { getLogger } from './services';
import type { Logger } from './services/Logger';
import { createStores, initializeStores, StoreProvider } from './stores';
import type { SupportedLocale } from './stores/LanguageStore';
import './styles/tailwind.css';

// i18n definitions map
const definitions: Record<SupportedLocale, Record<string, unknown>> = { en, ru };

// Create stores and initialize logger
const stores = createStores();
const logger: Logger = getLogger(stores.logs);

// Initialize app
async function init() {
  // Load persisted state
  await initializeStores(stores);

  const root = document.getElementById('root');
  if (root) {
    // Reactive render based on language
    const renderApp = () => {
      const locale = stores.language.locale.value;
      render(
        <StoreProvider stores={stores}>
          <IntlProvider definition={definitions[locale]}>
            <App />
          </IntlProvider>
        </StoreProvider>,
        root,
      );
    };

    // Initial render
    renderApp();

    // Re-render on language change
    stores.language.locale.subscribe(renderApp);
  }
}

init().catch((error) => {
  logger.error('Application initialization failed', error instanceof Error ? error : undefined);
});
