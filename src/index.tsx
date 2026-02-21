import { render } from 'preact';
import { IntlProvider } from 'preact-i18n';
import { App } from './App';
import { StoreProvider, createStores, initializeStores } from './stores';
import { ServiceProvider, createProductionContainer } from './di';
import { ServiceTypes } from './di';
import type { SupportedLocale } from './stores/LanguageStore';
import type { ILogger } from './services/LoggerService';
import en from './i18n/en.json';
import ru from './i18n/ru.json';
import './styles/tailwind.css';

// i18n definitions map
const definitions: Record<SupportedLocale, Record<string, unknown>> = { en, ru };

// Create stores and container
const stores = createStores();
const container = createProductionContainer(stores.logs);

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
        <ServiceProvider container={container}>
          <StoreProvider stores={stores}>
            <IntlProvider definition={definitions[locale]}>
              <App />
            </IntlProvider>
          </StoreProvider>
        </ServiceProvider>,
        root
      );
    };

    // Initial render
    renderApp();

    // Re-render on language change
    stores.language.locale.subscribe(renderApp);
  }
}

// Get logger for error handling
const logger = container.get<ILogger>(ServiceTypes.Logger);

init().catch((error) => {
  logger.error('Application initialization failed', error instanceof Error ? error : undefined);
});
