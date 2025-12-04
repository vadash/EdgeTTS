import { signal, computed } from '@preact/signals';

export const routes = {
  convert: '#/',
  settings: '#/settings',
  logs: '#/logs',
} as const;

export type RouteKey = keyof typeof routes;
export type RouteHash = typeof routes[RouteKey];

// Current hash signal
const currentHash = signal(window.location.hash || routes.convert);

// Listen to hash changes
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    currentHash.value = window.location.hash || routes.convert;
  });
}

// Navigate function
export function navigate(route: RouteKey | RouteHash): void {
  const hash = route.startsWith('#') ? route : routes[route as RouteKey];
  window.location.hash = hash;
}

// Computed route helpers
export const isConvertRoute = computed(() =>
  currentHash.value === routes.convert || currentHash.value === '' || currentHash.value === '#'
);
export const isSettingsRoute = computed(() => currentHash.value === routes.settings);
export const isLogsRoute = computed(() => currentHash.value === routes.logs);

// Hook for current route
export function useRoute() {
  return {
    hash: currentHash.value,
    isConvert: isConvertRoute.value,
    isSettings: isSettingsRoute.value,
    isLogs: isLogsRoute.value,
    navigate,
  };
}
