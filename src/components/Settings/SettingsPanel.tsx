import { Text } from 'preact-i18n';
import {
  rate, pitch, maxThreads, mergeFiles,
  rateDisplay, pitchDisplay, mergeDisplay,
  showDopSettings, lexxRegister,
  saveSettings
} from '../../state/appState';
import { Slider } from './Slider';
import { PointsSelector } from './PointsSelector';
import { LLMSettingsPanel } from './LLMSettingsPanel';

export function SettingsPanel() {
  return (
    <div class="settings-panel">
      <LLMSettingsPanel />

      <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color, #444)' }}>
        <PointsSelector />

      <Slider
        label={<Text id="settings.rate">Скорость</Text>}
        value={rate.value}
        min={-50}
        max={100}
        display={rateDisplay.value}
        onChange={(v) => rate.value = v}
      />

      <div
        class="dop-settings-toggle"
        onClick={() => showDopSettings.value = !showDopSettings.value}
        style={{ cursor: 'pointer', textAlign: 'center', marginBottom: '0.5rem' }}
      >
        <label style={{ cursor: 'pointer' }}>
          {showDopSettings.value ? '▲' : '▼'} <Text id="settings.toggle">Дополнительно</Text>
        </label>
      </div>

      {showDopSettings.value && (
        <div class="dop-settings">
          <Slider
            label={<Text id="settings.pitch">Высота</Text>}
            value={pitch.value}
            min={-50}
            max={50}
            display={pitchDisplay.value}
            onChange={(v) => pitch.value = v}
          />

          <Slider
            label={<Text id="settings.threads">Потоков</Text>}
            value={maxThreads.value}
            min={1}
            max={30}
            display={`${maxThreads.value}`}
            onChange={(v) => maxThreads.value = v}
          />

          <Slider
            label={<Text id="settings.merge">Объединять</Text>}
            value={mergeFiles.value}
            min={1}
            max={100}
            display={mergeDisplay.value}
            onChange={(v) => mergeFiles.value = v}
          />

          <label class="toggle-wrapper">
            <span><Text id="settings.dictionary.caseSensitive">Регистр словаря</Text></span>
            <input
              type="checkbox"
              class="toggle"
              checked={lexxRegister.value}
              onChange={(e) => lexxRegister.value = (e.target as HTMLInputElement).checked}
            />
          </label>
        </div>
      )}

      <button
        onClick={saveSettings}
        style={{ width: '100%', marginBottom: '1rem' }}
      >
        💾 <Text id="settings.save">Сохранить настройки</Text>
      </button>
      </div>
    </div>
  );
}
