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

      {/* Speed Info */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
        <p className="text-sm text-blue-300">
          ℹ️ <Text id="settings.speedInfo">Speed varies by voice. Adjust playback speed in the audio player.</Text>
        </p>
      </div>

      {/* TTS Threads */}
      <Slider
        label="settings.ttsThreads"
        value={settings.ttsThreads.value}
        min={1}
        max={20}
        onChange={(v) => settings.setTtsThreads(v)}
      />

      {/* LLM Threads */}
      <Slider
        label="settings.llmThreads"
        value={settings.llmThreads.value}
        min={1}
        max={10}
        onChange={(v) => settings.setLlmThreads(v)}
      />

      {/* Save */}
      <Button variant="primary" onClick={() => settings.save()} className="w-full">
        💾 <Text id="settings.save">Save Settings</Text>
      </Button>
    </div>
  );
}
