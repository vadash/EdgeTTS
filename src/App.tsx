import { AppShell } from './components/layout';
import { Router } from './router';
import { ConvertView } from './components/convert';
import { SettingsView } from './components/settings';
import { StatusView } from './components/status';
import { AboutView } from './components/info';

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
