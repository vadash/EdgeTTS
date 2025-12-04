import { Text } from 'preact-i18n';
import { useSettings, useLanguage } from '@/stores';
import { Slider, Button } from '@/components/common';

export function GeneralTab() {
  const settings = useSettings();
  const language = useLanguage();

  return (
    <div className="space-y-6">
      {/* Language */}
      <div>
        <label className="input-label">
          <Text id="settings.language">Language</Text>
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => language.setLocale('en')}
            className={`flex-1 btn ${language.locale.value === 'en' ? 'btn-primary' : ''}`}
          >
            English
          </button>
          <button
            onClick={() => language.setLocale('ru')}
            className={`flex-1 btn ${language.locale.value === 'ru' ? 'btn-primary' : ''}`}
          >
            Русский
          </button>
        </div>
      </div>

      {/* Speed */}
      <Slider
        label="Speed"
        value={settings.rate.value}
        min={-50}
        max={100}
        onChange={(v) => settings.setRate(v)}
        formatValue={(v) => v >= 0 ? `+${v}%` : `${v}%`}
      />

      {/* Pitch */}
      <Slider
        label="Pitch"
        value={settings.pitch.value}
        min={-50}
        max={50}
        onChange={(v) => settings.setPitch(v)}
        formatValue={(v) => v >= 0 ? `+${v}Hz` : `${v}Hz`}
      />

      {/* Threads */}
      <Slider
        label="Threads"
        value={settings.maxThreads.value}
        min={1}
        max={30}
        onChange={(v) => settings.setMaxThreads(v)}
      />

      {/* Save */}
      <Button variant="primary" onClick={() => settings.save()} className="w-full">
        💾 <Text id="settings.save">Save Settings</Text>
      </Button>
    </div>
  );
}
