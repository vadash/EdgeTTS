import type { FunctionalComponent, ComponentChildren } from 'preact';
import { isConvertRoute, isSettingsRoute, isLogsRoute } from './useRoute';

interface RouterProps {
  convertView: ComponentChildren;
  settingsView: ComponentChildren;
  logsView: ComponentChildren;
}

export function Router({ convertView, settingsView, logsView }: RouterProps) {
  if (isSettingsRoute.value) {
    return <>{settingsView}</>;
  }
  if (isLogsRoute.value) {
    return <>{logsView}</>;
  }
  return <>{convertView}</>;
}
