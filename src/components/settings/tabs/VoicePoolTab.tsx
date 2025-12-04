import { useState, useMemo } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Text } from 'preact-i18n';
import { Button, Toggle } from '@/components/common';
import voices from '@/components/VoiceSelector/voices';
import { EdgeTTSService } from '@/services/EdgeTTSService';

// Voice pool state - which voices are enabled
const enabledVoices = signal<Set<string>>(new Set(voices.map(v => v.fullValue)));
const isPlaying = signal<string | null>(null);

export function VoicePoolTab() {
  const [filter, setFilter] = useState('');
  const [localeFilter, setLocaleFilter] = useState('all');

  // Get unique locales
  const locales = useMemo(() => {
    const unique = new Set(voices.map(v => v.locale.split('-')[0]));
    return Array.from(unique).sort();
  }, []);

  // Filter voices
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
    enabledVoices.value = current;
  };

  const enableAll = () => {
    enabledVoices.value = new Set(voices.map(v => v.fullValue));
  };

  const disableAll = () => {
    enabledVoices.value = new Set();
  };

  const playVoice = async (voiceId: string) => {
    if (isPlaying.value) return;
    isPlaying.value = voiceId;

    try {
      const audioData = await new Promise<Uint8Array>((resolve, reject) => {
        const tts = new EdgeTTSService({
          indexPart: 0,
          filename: 'sample',
          filenum: '0',
          config: {
            voice: `Microsoft Server Speech Text to Speech Voice (${voiceId})`,
            rate: '+0%',
            pitch: '+0Hz',
            volume: '+0%'
          },
          text: 'Hello, this is a sample of my voice.',
          onComplete: resolve,
          onError: reject
        });
        tts.start();
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
      {/* Header */}
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
