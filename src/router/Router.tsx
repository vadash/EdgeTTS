import type { FunctionalComponent, ComponentChildren } from 'preact';
import { isConvertRoute, isSettingsRoute, isLogsRoute, isAboutRoute } from './useRoute';

interface RouterProps {
  convertView: ComponentChildren;
  settingsView: ComponentChildren;
  logsView: ComponentChildren;
  aboutView: ComponentChildren;
}

export function Router({ convertView, settingsView, logsView, aboutView }: RouterProps) {
  if (isSettingsRoute.value) {
    return <>{settingsView}</>;
  }
  if (isLogsRoute.value) {
    return <>{logsView}</>;
  }
  if (isAboutRoute.value) {
    return <>{aboutView}</>;
  }
  return <>{convertView}</>;
}
