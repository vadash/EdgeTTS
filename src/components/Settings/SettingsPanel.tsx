import { Text } from 'preact-i18n';
import { useSettings, useConversion, useLLM } from '../../stores';
import { Slider } from './Slider';
import { PointsSelector } from './PointsSelector';
import { LLMSettingsPanel } from './LLMSettingsPanel';

export function SettingsPanel() {
  const settings = useSettings();
  const conversion = useConversion();
  const llm = useLLM();

  const handleSave = async () => {
    settings.save();
    await llm.saveSettings();
  };

  return (
    <div class="settings-panel">
      <LLMSettingsPanel />

      <div class="settings-section">
        <PointsSelector />

      <Slider
        label={<Text id="settings.rate">Speed</Text>}
        value={settings.rate.value}
        min={-50}
        max={100}
        display={settings.rateDisplay.value}
        onChange={(v) => settings.setRate(v)}
      />

      <div
        class="dop-settings-toggle"
        onClick={() => settings.toggleDopSettings()}
      >
        <label>
          {settings.showDopSettings.value ? '▲' : '▼'} <Text id="settings.additional">Additional</Text>
        </label>
      </div>

      {settings.showDopSettings.value && (
        <div class="dop-settings">
          <Slider
            label={<Text id="settings.pitch">Pitch</Text>}
            value={settings.pitch.value}
            min={-50}
            max={50}
            display={settings.pitchDisplay.value}
            onChange={(v) => settings.setPitch(v)}
          />

          <Slider
            label={<Text id="settings.threads">Threads</Text>}
            value={settings.maxThreads.value}
            min={1}
            max={30}
            display={`${settings.maxThreads.value}`}
            onChange={(v) => settings.setMaxThreads(v)}
          />

          <label class="toggle-wrapper">
            <span><Text id="settings.outputFormat">Output Format</Text></span>
            <select
              value={settings.outputFormat.value}
              onChange={(e) => settings.setOutputFormat((e.target as HTMLSelectElement).value as 'mp3' | 'opus')}
            >
              <option value="opus">Opus</option>
              <option value="mp3">MP3</option>
            </select>
          </label>

          {settings.outputFormat.value === 'opus' && (
            <>
              <label class="toggle-wrapper">
                <span><Text id="settings.silenceRemoval">Remove Silence</Text></span>
                <input
                  type="checkbox"
                  class="toggle"
                  checked={settings.silenceRemovalEnabled.value}
                  onChange={(e) => settings.setSilenceRemovalEnabled((e.target as HTMLInputElement).checked)}
                />
              </label>

              <label class="toggle-wrapper">
                <span><Text id="settings.normalization">Normalize Audio</Text></span>
                <input
                  type="checkbox"
                  class="toggle"
                  checked={settings.normalizationEnabled.value}
                  onChange={(e) => settings.setNormalizationEnabled((e.target as HTMLInputElement).checked)}
                />
              </label>

              {conversion.ffmpegError.value && (
                <div class="warning-message">
                  ⚠️ {conversion.ffmpegError.value}
                </div>
              )}
            </>
          )}

          <label class="toggle-wrapper">
            <span><Text id="settings.dictionary.caseSensitive">Dictionary case</Text></span>
            <input
              type="checkbox"
              class="toggle"
              checked={settings.lexxRegister.value}
              onChange={(e) => settings.setLexxRegister((e.target as HTMLInputElement).checked)}
            />
          </label>
        </div>
      )}

      <button
        onClick={handleSave}
        class="w-full mb-1"
      >
        💾 <Text id="settings.save">Save Settings</Text>
      </button>
      </div>
    </div>
  );
}
