import { useState, useMemo } from 'preact/hooks';
import { signal, computed } from '@preact/signals';
import { Text } from 'preact-i18n';
import { Button, Toggle } from '@/components/common';
import voices from '@/components/VoiceSelector/voices';
import { useSettings } from '@/stores';
import { useService, ServiceTypes } from '@/di';
import type { IReusableTTSService } from '@/services/interfaces';

const isPlaying = signal<string | null>(null);
const sampleText = signal<string>('Hello, this is a sample of my voice.');

export function VoicePoolTab() {
  const settings = useSettings();
  const ttsService = useService<IReusableTTSService>(ServiceTypes.TTSPreviewService);
  const [filter, setFilter] = useState('');
  const [localeFilter, setLocaleFilter] = useState('all');

  // Get enabled voices from settings (empty array means all enabled)
  const enabledVoices = computed(() => {
    const saved = settings.enabledVoices.value;
    if (saved.length === 0) {
      return new Set(voices.map(v => v.fullValue));
    }
    return new Set(saved);
  });

  // Get unique locales
  const locales = useMemo(() => {
    const unique = new Set(voices.map(v => v.locale.split('-')[0]));
    return Array.from(unique).sort();
  }, []);

  // Filter voices for narrator selection based on detected language
  const narratorVoices = useMemo(() => {
    return voices.filter(v =>
      v.locale.startsWith('ru') || v.name.includes('Multilingual')
    );
  }, []);

  // Filter voices for pool list
  const filteredVoices = useMemo(() => {
    return voices.filter(v => {
      const matchesSearch = filter === '' ||
        v.fullValue.toLowerCase().includes(filter.toLowerCase()) ||
        v.name.toLowerCase().includes(filter.toLowerCase());
      const matchesLocale = localeFilter === 'all' ||
        v.locale.startsWith(localeFilter);
      return matchesSearch && matchesLocale;
    });
  }, [filter, localeFilter]);

  const toggleVoice = (voiceId: string) => {
    const current = new Set(enabledVoices.value);
    if (current.has(voiceId)) {
      current.delete(voiceId);
    } else {
      current.add(voiceId);
    }
    settings.setEnabledVoices(Array.from(current));
  };

  const enableAll = () => {
    settings.setEnabledVoices(voices.map(v => v.fullValue));
  };

  const disableAll = () => {
    settings.setEnabledVoices([]);
  };

  const playVoice = async (voiceId: string) => {
    if (isPlaying.value || !sampleText.value.trim()) return;
    isPlaying.value = voiceId;

    try {
      // Use singleton TTS service to avoid rate limiting
      const audioData = await ttsService.send({
        text: sampleText.value,
        config: {
          voice: `Microsoft Server Speech Text to Speech Voice (${voiceId})`,
          rate: '+0%',
          pitch: '+0Hz',
          volume: '+0%'
        }
      });

      const blob = new Blob([(audioData.buffer as ArrayBuffer).slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength)], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      audio.onended = () => {
        URL.revokeObjectURL(url);
        isPlaying.value = null;
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        isPlaying.value = null;
      };

      await audio.play();
    } catch (e) {
      isPlaying.value = null;
    }
  };

  const enabledCount = enabledVoices.value.size;
  const totalCount = voices.length;

  return (
    <div className="space-y-4">
      {/* Narrator Voice Selection */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          <Text id="settings.narratorVoice">Narrator Voice</Text>
        </label>
        <div className="flex gap-2">
          <select
            className="select-field flex-1"
            value={settings.narratorVoice.value}
            onChange={(e) => settings.setNarratorVoice((e.target as HTMLSelectElement).value)}
          >
            {narratorVoices.map((v) => (
              <option key={v.fullValue} value={v.fullValue}>
                {v.fullValue} ({v.gender})
              </option>
            ))}
          </select>
          <button
            onClick={() => playVoice(settings.narratorVoice.value)}
            disabled={isPlaying.value !== null}
            className="btn btn-icon"
            aria-label="Play voice sample"
          >
            {isPlaying.value === settings.narratorVoice.value ? '...' : '▶'}
          </button>
        </div>
      </div>

      <hr className="border-border" />

      {/* Voice Pool Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">
          {enabledCount} / {totalCount} <Text id="settings.voicesEnabled">voices enabled</Text>
        </span>
        <div className="flex gap-2">
          <Button size="sm" onClick={enableAll}>
            <Text id="settings.enableAll">Enable All</Text>
          </Button>
          <Button size="sm" onClick={disableAll}>
            <Text id="settings.disableAll">Disable All</Text>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <select
          className="select-field w-32"
          value={localeFilter}
          onChange={(e) => setLocaleFilter((e.target as HTMLSelectElement).value)}
        >
          <option value="all">All</option>
          {locales.map(locale => (
            <option key={locale} value={locale}>{locale.toUpperCase()}</option>
          ))}
        </select>
        <input
          type="text"
          className="input-field flex-1"
          placeholder="Search voices..."
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        />
      </div>

      {/* Sample Text */}
      <div>
        <label className="text-sm text-gray-400 mb-1 block">
          <Text id="settings.sampleText">Sample text</Text>
        </label>
        <input
          type="text"
          className="input-field w-full"
          placeholder="Enter text to test voices..."
          value={sampleText.value}
          onInput={(e) => sampleText.value = (e.target as HTMLInputElement).value}
        />
      </div>

      {/* Voice List */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
        {filteredVoices.map(voice => (
          <div
            key={voice.fullValue}
            className="flex items-center gap-3 p-3 bg-primary rounded-lg border border-border hover:border-gray-500 transition-colors"
          >
            <Toggle
              checked={enabledVoices.value.has(voice.fullValue)}
              onChange={() => toggleVoice(voice.fullValue)}
            />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{voice.name}</div>
              <div className="text-xs text-gray-500">
                {voice.locale} • {voice.gender}
              </div>
            </div>
            <button
              onClick={() => playVoice(voice.fullValue)}
              disabled={isPlaying.value !== null}
              className="btn btn-sm btn-icon"
            >
              {isPlaying.value === voice.fullValue ? '...' : '▶'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
