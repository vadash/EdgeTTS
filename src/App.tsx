import { ConvertView } from './components/convert';
import { AboutView } from './components/info';
import { AppShell } from './components/layout';
import { SettingsView } from './components/settings';
import { StatusView } from './components/status';
import { Router } from './router';

export function App() {
  return (
    <AppShell>
      <Router
        convertView={<ConvertView />}
        settingsView={<SettingsView />}
        logsView={<StatusView />}
        aboutView={<AboutView />}
      />
    </AppShell>
  );
}
