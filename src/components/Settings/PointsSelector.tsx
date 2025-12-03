import { Text, useText } from 'preact-i18n';
import { useSettings } from '../../stores';

// Use keys for internal logic, i18n for display
const POINTS_OPTIONS = ['none', 'comma', 'semicolon', 'colon'] as const;

export function PointsSelector() {
  const { none, comma, semicolon, colon } = useText({
    none: 'settings.points.none',
    comma: 'settings.points.comma',
    semicolon: 'settings.points.semicolon',
    colon: 'settings.points.colon',
  });
  const settings = useSettings();

  const labels: Record<string, string> = { none, comma, semicolon, colon };

  const cyclePointsType = () => {
    const types: Array<'V1' | 'V2' | 'V3'> = ['V1', 'V2', 'V3'];
    const currentIndex = types.indexOf(settings.pointsType.value);
    settings.setPointsType(types[(currentIndex + 1) % 3]);
  };

  return (
    <div class="points-selector">
      <select
        class="pointsselect"
        value={settings.pointsSelect.value}
        onChange={(e) => settings.setPointsSelect((e.target as HTMLSelectElement).value)}
      >
        {POINTS_OPTIONS.map((key) => (
          <option key={key} value={key}>{labels[key]}</option>
        ))}
      </select>
      <button
        onClick={cyclePointsType}
        class="points-type-btn"
      >
        {settings.pointsType.value}
      </button>
    </div>
  );
}
