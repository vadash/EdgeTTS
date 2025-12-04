import { Text } from 'preact-i18n';
import { navigate, isConvertRoute, isSettingsRoute, isLogsRoute } from '@/router';

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-primary-secondary border-t border-border md:hidden pb-safe">
      <div className="flex items-center justify-around">
        <button
          onClick={() => navigate('convert')}
          className={`flex-1 flex flex-col items-center gap-1 py-3 px-4 transition-colors
            ${isConvertRoute.value
              ? 'text-accent'
              : 'text-gray-400 active:text-white'
            }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
          <span className="text-xs font-medium">
            <Text id="nav.convert">Convert</Text>
          </span>
        </button>

        <button
          onClick={() => navigate('settings')}
          className={`flex-1 flex flex-col items-center gap-1 py-3 px-4 transition-colors
            ${isSettingsRoute.value
              ? 'text-accent'
              : 'text-gray-400 active:text-white'
            }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-xs font-medium">
            <Text id="nav.settings">Settings</Text>
          </span>
        </button>

        <button
          onClick={() => navigate('logs')}
          className={`flex-1 flex flex-col items-center gap-1 py-3 px-4 transition-colors
            ${isLogsRoute.value
              ? 'text-accent'
              : 'text-gray-400 active:text-white'
            }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-xs font-medium">
            <Text id="nav.logs">Logs</Text>
          </span>
        </button>
      </div>
    </nav>
  );
}
