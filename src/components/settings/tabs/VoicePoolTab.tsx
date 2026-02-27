import { computed, signal } from '@preact/signals';
import { useMemo, useState } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { Button, Toggle } from '@/components/common';
import voices from '@/components/VoiceSelector/voices';
import { useVoicePreview } from '@/hooks/useVoicePreview';
import { useSettings } from '@/stores';

// Language code to full name mapping
const LANGUAGE_NAMES: Record<string, string> = {
  multilingual: 'Multilingual',
  en: 'English',
  ru: 'Russian',
  es: 'Spanish',
  zh: 'Chinese',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
  it: 'Italian',
  ar: 'Arabic',
  hi: 'Hindi',
  tr: 'Turkish',
  pl: 'Polish',
  nl: 'Dutch',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  uk: 'Ukrainian',
  cs: 'Czech',
  sv: 'Swedish',
  da: 'Danish',
  fi: 'Finnish',
  nb: 'Norwegian',
  he: 'Hebrew',
  el: 'Greek',
  ro: 'Romanian',
  hu: 'Hungarian',
  sk: 'Slovak',
  bg: 'Bulgarian',
  hr: 'Croatian',
  sl: 'Slovenian',
  sr: 'Serbian',
  lt: 'Lithuanian',
  lv: 'Latvian',
  et: 'Estonian',
  ms: 'Malay',
  fil: 'Filipino',
  ta: 'Tamil',
  te: 'Telugu',
  bn: 'Bengali',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
  mr: 'Marathi',
  ur: 'Urdu',
  fa: 'Persian',
  af: 'Afrikaans',
  am: 'Amharic',
  az: 'Azerbaijani',
  bs: 'Bosnian',
  ca: 'Catalan',
  cy: 'Welsh',
  ga: 'Irish',
  gl: 'Galician',
  is: 'Icelandic',
  iu: 'Inuktitut',
  jv: 'Javanese',
  ka: 'Georgian',
  kk: 'Kazakh',
  km: 'Khmer',
  lo: 'Lao',
  mk: 'Macedonian',
  mn: 'Mongolian',
  mt: 'Maltese',
  my: 'Burmese',
  ne: 'Nepali',
  ps: 'Pashto',
  si: 'Sinhala',
  so: 'Somali',
  sq: 'Albanian',
  su: 'Sundanese',
  sw: 'Swahili',
  uz: 'Uzbek',
  zu: 'Zulu',
};

// Priority order for languages (most popular first)
const LANGUAGE_ORDER = [
  'multilingual',
  'en',
  'ru',
  'es',
  'zh',
  'fr',
  'de',
  'pt',
  'ja',
  'ko',
  'it',
  'ar',
  'hi',
  'tr',
  'pl',
  'nl',
  'vi',
  'th',
  'id',
  'uk',
];

const sampleText = signal<string>('Hello, this is a sample of my voice.');

export function VoicePoolTab() {
  const settings = useSettings();
  const preview = useVoicePreview();
  const [filter, setFilter] = useState('');
  const [localeFilter, setLocaleFilter] = useState('all');

  // Get enabled voices from settings (empty array means all enabled)
  const enabledVoices = computed(() => {
    const saved = settings.enabledVoices.value;
    if (saved.length === 0) {
      return new Set(voices.map((v) => v.fullValue));
    }
    return new Set(saved);
  });

  // Get unique locales with multilingual category, custom sorting, and separators
  const locales = useMemo(() => {
    const unique = new Set(voices.map((v) => v.locale.split('-')[0]));
    // Add multilingual category if there are multilingual voices
    const hasMultilingual = voices.some((v) => v.name.includes('Multilingual'));
    if (hasMultilingual) {
      unique.add('multilingual');
    }

    const sorted = Array.from(unique).sort((a, b) => {
      const aIndex = LANGUAGE_ORDER.indexOf(a);
      const bIndex = LANGUAGE_ORDER.indexOf(b);
      // If both in priority list, use priority order
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      // If only one in priority list, it comes first
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      // Otherwise sort alphabetically by full name
      const aName = LANGUAGE_NAMES[a] || a.toUpperCase();
      const bName = LANGUAGE_NAMES[b] || b.toUpperCase();
      return aName.localeCompare(bName);
    });

    // Insert separators after 'ru' and after the last popular language (before alphabetical)
    const result: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
      result.push(sorted[i]);
      // Add separator after 'ru' (index 2 in LANGUAGE_ORDER)
      if (sorted[i] === 'ru') {
        result.push('---1');
      }
      // Add separator after last popular language (before alphabetical section)
      const currentInOrder = LANGUAGE_ORDER.indexOf(sorted[i]) !== -1;
      const nextExists = i + 1 < sorted.length;
      const nextInOrder = nextExists && LANGUAGE_ORDER.indexOf(sorted[i + 1]) !== -1;
      if (currentInOrder && nextExists && !nextInOrder) {
        result.push('---2');
      }
    }
    return result;
  }, []);

  // Filter voices for narrator selection based on detected language, with separator
  const narratorVoices = useMemo(() => {
    const multilingual = voices.filter((v) => v.name.includes('Multilingual'));
    const russian = voices.filter(
      (v) => v.locale.startsWith('ru') && !v.name.includes('Multilingual'),
    );
    // Return with separator marker between groups
    return [
      ...multilingual.map((v) => ({ ...v, isSeparator: false })),
      { fullValue: '---', name: '---', locale: '---', gender: 'male' as const, isSeparator: true },
      ...russian.map((v) => ({ ...v, isSeparator: false })),
    ];
  }, []);

  // Filter voices for pool list
  const filteredVoices = useMemo(() => {
    return voices.filter((v) => {
      const matchesSearch =
        filter === '' ||
        v.fullValue.toLowerCase().includes(filter.toLowerCase()) ||
        v.name.toLowerCase().includes(filter.toLowerCase());

      let matchesLocale = localeFilter === 'all';
      if (localeFilter === 'multilingual') {
        matchesLocale = v.name.includes('Multilingual');
      } else if (localeFilter !== 'all') {
        // For regular locales, exclude multilingual voices
        matchesLocale = v.locale.startsWith(localeFilter) && !v.name.includes('Multilingual');
      }

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
    settings.setEnabledVoices(voices.map((v) => v.fullValue));
  };

  const disableAll = () => {
    settings.setEnabledVoices([]);
  };

  const playVoice = (voiceId: string) => {
    preview.play(sampleText.value, voiceId);
  };

  const enabledCount = enabledVoices.value.size;
  const totalCount = voices.length;

  return (
    <div className="space-y-4">
      {/* Narrator Voice Selection */}
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="narrator-voice-select">
          <Text id="settings.narratorVoice">Narrator Voice</Text>
        </label>
        <div className="flex gap-2">
          <select
            id="narrator-voice-select"
            className="select-field flex-1"
            value={settings.narratorVoice.value}
            onChange={(e) => settings.setNarratorVoice((e.target as HTMLSelectElement).value)}
          >
            {narratorVoices.map((v) =>
              v.isSeparator ? (
                <option key="separator" disabled>
                  ────────────
                </option>
              ) : (
                <option key={v.fullValue} value={v.fullValue}>
                  {v.fullValue} ({v.gender})
                </option>
              ),
            )}
          </select>
          <button
            type="button"
            onClick={() => playVoice(settings.narratorVoice.value)}
            disabled={preview.isPlaying}
            className="btn btn-icon"
            aria-label="Play voice sample"
          >
            {preview.isPlaying && preview.currentVoiceId === settings.narratorVoice.value
              ? '...'
              : '▶'}
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
          {locales.map((locale) =>
            locale.startsWith('---') ? (
              <option key={locale} disabled>
                ────────────
              </option>
            ) : (
              <option key={locale} value={locale}>
                {LANGUAGE_NAMES[locale] || locale.toUpperCase()}
              </option>
            ),
          )}
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
        <label className="text-sm text-gray-400 mb-1 block" htmlFor="sample-text-input-pool">
          <Text id="settings.sampleText">Sample text</Text>
        </label>
        <input
          id="sample-text-input-pool"
          type="text"
          className="input-field w-full"
          placeholder="Enter text to test voices..."
          value={sampleText.value}
          onInput={(e) => (sampleText.value = (e.target as HTMLInputElement).value)}
        />
      </div>

      {/* Voice List */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
        {filteredVoices.map((voice) => (
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
              type="button"
              onClick={() => playVoice(voice.fullValue)}
              disabled={preview.isPlaying}
              className="btn btn-sm btn-icon"
            >
              {preview.isPlaying && preview.currentVoiceId === voice.fullValue ? '...' : '▶'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
