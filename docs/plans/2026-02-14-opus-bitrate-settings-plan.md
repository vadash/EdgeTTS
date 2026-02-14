# Implementation Plan - Opus Bitrate Settings UI

> **Reference:** `docs/designs/2026-02-14-opus-bitrate-settings-design.md`
> **Execution:** Use `executing-plans` skill.

---

## Task 1: Add AudioPreset Enum and AUDIO_PRESETS Constant

**Goal:** Add the preset enum and configuration constant to types file.

**Step 1: Write the Failing Test**
- File: `src/state/types.test.ts` (create new file)
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { AudioPreset, AUDIO_PRESETS } from '@/state/types';

  describe('AudioPreset', () => {
    it('should have all preset values', () => {
      expect(AudioPreset.MAX_QUALITY).toBe('max_quality');
      expect(AudioPreset.BALANCED).toBe('balanced');
      expect(AudioPreset.FAST).toBe('fast');
      expect(AudioPreset.MOBILE).toBe('mobile');
      expect(AudioPreset.CUSTOM).toBe('custom');
    });

    it('AUDIO_PRESETS should have correct configuration', () => {
      const maxQuality = AUDIO_PRESETS.find(p => p.name === AudioPreset.MAX_QUALITY);
      expect(maxQuality?.minBitrate).toBe(128);
      expect(maxQuality?.maxBitrate).toBe(128);
      expect(maxQuality?.compressionLevel).toBe(10);

      const balanced = AUDIO_PRESETS.find(p => p.name === AudioPreset.BALANCED);
      expect(balanced?.minBitrate).toBe(64);
      expect(balanced?.maxBitrate).toBe(96);
      expect(balanced?.compressionLevel).toBe(10);

      const fast = AUDIO_PRESETS.find(p => p.name === AudioPreset.FAST);
      expect(fast?.minBitrate).toBe(48);
      expect(fast?.maxBitrate).toBe(64);
      expect(fast?.compressionLevel).toBe(5);

      const mobile = AUDIO_PRESETS.find(p => p.name === AudioPreset.MOBILE);
      expect(mobile?.minBitrate).toBe(32);
      expect(mobile?.maxBitrate).toBe(48);
      expect(mobile?.compressionLevel).toBe(3);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/state/types.test.ts`
- Expect: "Cannot find module '@/state/types' or 'AudioPreset is not defined'"

**Step 3: Implementation (Green)**
- File: `src/state/types.ts`
- Action: Add at the TOP of file (after imports, before first interface):
  ```typescript
  // Audio Presets for Opus encoding
  export enum AudioPreset {
    MAX_QUALITY = 'max_quality',
    BALANCED = 'balanced',
    FAST = 'fast',
    MOBILE = 'mobile',
    CUSTOM = 'custom'
  }

  export interface AudioPresetConfig {
    name: AudioPreset;
    labelId: string;
    descriptionId: string;
    minBitrate: number;
    maxBitrate: number;
    compressionLevel: number;
  }

  export const AUDIO_PRESETS: AudioPresetConfig[] = [
    {
      name: AudioPreset.MAX_QUALITY,
      labelId: 'settings.preset.maxQuality',
      descriptionId: 'settings.preset.maxQualityDesc',
      minBitrate: 128,
      maxBitrate: 128,
      compressionLevel: 10,
    },
    {
      name: AudioPreset.BALANCED,
      labelId: 'settings.preset.balanced',
      descriptionId: 'settings.preset.balancedDesc',
      minBitrate: 64,
      maxBitrate: 96,
      compressionLevel: 10,
    },
    {
      name: AudioPreset.FAST,
      labelId: 'settings.preset.fast',
      descriptionId: 'settings.preset.fastDesc',
      minBitrate: 48,
      maxBitrate: 64,
      compressionLevel: 5,
    },
    {
      name: AudioPreset.MOBILE,
      labelId: 'settings.preset.mobile',
      descriptionId: 'settings.preset.mobileDesc',
      minBitrate: 32,
      maxBitrate: 48,
      compressionLevel: 3,
    },
  ];
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/state/types.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add AudioPreset enum and AUDIO_PRESETS constant"`

---

## Task 2: Extend AppSettings Interface

**Goal:** Add Opus settings to AppSettings interface.

**Step 1: Write the Failing Test**
- File: `src/state/types.test.ts`
- Code (append to file):
  ```typescript
  import type { AppSettings } from '@/state/types';

  describe('AppSettings interface', () => {
    it('should accept Opus encoding settings', () => {
      const settings: AppSettings = {
        // Required existing fields (minimal subset for type check)
        voice: 'ru-RU, DmitryNeural',
        narratorVoice: 'ru-RU, DmitryNeural',
        voicePoolLocale: 'ru-RU',
        enabledVoices: [],
        rate: 0,
        pitch: 0,
        ttsThreads: 15,
        llmThreads: 2,
        lexxRegister: true,
        showDopSettings: false,
        isLiteMode: true,
        statusAreaWidth: 450,
        outputFormat: 'opus',
        silenceRemovalEnabled: true,
        normalizationEnabled: true,
        deEssEnabled: true,
        silenceGapMs: 100,
        eqEnabled: true,
        compressorEnabled: true,
        fadeInEnabled: true,
        stereoWidthEnabled: true,
        // New Opus settings
        opusPreset: AudioPreset.BALANCED,
        opusMinBitrate: 64,
        opusMaxBitrate: 96,
        opusCompressionLevel: 10,
      };
      expect(settings.opusPreset).toBe(AudioPreset.BALANCED);
      expect(settings.opusMinBitrate).toBe(64);
      expect(settings.opusMaxBitrate).toBe(96);
      expect(settings.opusCompressionLevel).toBe(10);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/state/types.test.ts`
- Expect: "Type error: Object literal may only specify known properties"

**Step 3: Implementation (Green)**
- File: `src/state/types.ts`
- Action: In the `AppSettings` interface (around line 10-34), add after `stereoWidthEnabled: boolean;`:
  ```typescript
  // Opus encoding settings
  opusPreset: AudioPreset;
  opusMinBitrate: number;
  opusMaxBitrate: number;
  opusCompressionLevel: number;
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/state/types.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: extend AppSettings with Opus encoding fields"`

---

## Task 3: Add Opus Settings to SettingsStore Defaults

**Goal:** Add default values for new Opus settings in SettingsStore.

**Step 1: Write the Failing Test**
- File: `src/stores/SettingsStore.test.ts`
- Code (append to describe('initial state')):
  ```typescript
  it('should have Opus encoding defaults', () => {
    expect(store.opusPreset.value).toBe('balanced');
    expect(store.opusMinBitrate.value).toBe(64);
    expect(store.opusMaxBitrate.value).toBe(96);
    expect(store.opusCompressionLevel.value).toBe(10);
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/stores/SettingsStore.test.ts`
- Expect: "Cannot read property 'value' of undefined"

**Step 3: Implementation (Green)**
- File: `src/stores/SettingsStore.ts`
- Action 1: Add import at top:
  ```typescript
  import { AudioPreset, AUDIO_PRESETS } from '@/state/types';
  ```
- Action 2: In `defaultSettings` object (after line 34), add:
  ```typescript
  // Opus encoding settings
  opusPreset: AudioPreset.BALANCED,
  opusMinBitrate: 64,
  opusMaxBitrate: 96,
  opusCompressionLevel: 10,
  ```
- Action 3: In `SettingsStore` class (after line 64), add signals:
  ```typescript
  // Opus encoding settings
  readonly opusPreset = signal<AudioPreset>(defaultSettings.opusPreset);
  readonly opusMinBitrate = signal<number>(defaultSettings.opusMinBitrate);
  readonly opusMaxBitrate = signal<number>(defaultSettings.opusMaxBitrate);
  readonly opusCompressionLevel = signal<number>(defaultSettings.opusCompressionLevel);
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/stores/SettingsStore.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add Opus settings defaults and signals to SettingsStore"`

---

## Task 4: Add Opus Setters to SettingsStore

**Goal:** Add setter methods for Opus settings with preset switching logic.

**Step 1: Write the Failing Test**
- File: `src/stores/SettingsStore.test.ts`
- Code (append new describe block):
  ```typescript
  import { AudioPreset, AUDIO_PRESETS } from '@/state/types';

  describe('Opus encoding setters', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('setOpusPreset should update all values to preset config', () => {
      store.setOpusPreset(AudioPreset.MAX_QUALITY);
      expect(store.opusPreset.value).toBe(AudioPreset.MAX_QUALITY);
      expect(store.opusMinBitrate.value).toBe(128);
      expect(store.opusMaxBitrate.value).toBe(128);
      expect(store.opusCompressionLevel.value).toBe(10);
    });

    it('setOpusPreset(BALANCED) should use balanced config', () => {
      store.setOpusPreset(AudioPreset.BALANCED);
      expect(store.opusPreset.value).toBe(AudioPreset.BALANCED);
      expect(store.opusMinBitrate.value).toBe(64);
      expect(store.opusMaxBitrate.value).toBe(96);
      expect(store.opusCompressionLevel.value).toBe(10);
    });

    it('setOpusPreset(FAST) should use fast config', () => {
      store.setOpusPreset(AudioPreset.FAST);
      expect(store.opusPreset.value).toBe(AudioPreset.FAST);
      expect(store.opusMinBitrate.value).toBe(48);
      expect(store.opusMaxBitrate.value).toBe(64);
      expect(store.opusCompressionLevel.value).toBe(5);
    });

    it('setOpusPreset(MOBILE) should use mobile config', () => {
      store.setOpusPreset(AudioPreset.MOBILE);
      expect(store.opusPreset.value).toBe(AudioPreset.MOBILE);
      expect(store.opusMinBitrate.value).toBe(32);
      expect(store.opusMaxBitrate.value).toBe(48);
      expect(store.opusCompressionLevel.value).toBe(3);
    });

    it('setOpusMinBitrate should switch preset to CUSTOM', () => {
      store.setOpusPreset(AudioPreset.BALANCED);
      store.setOpusMinBitrate(72);
      expect(store.opusPreset.value).toBe(AudioPreset.CUSTOM);
      expect(store.opusMinBitrate.value).toBe(72);
    });

    it('setOpusMaxBitrate should switch preset to CUSTOM', () => {
      store.setOpusPreset(AudioPreset.BALANCED);
      store.setOpusMaxBitrate(128);
      expect(store.opusPreset.value).toBe(AudioPreset.CUSTOM);
      expect(store.opusMaxBitrate.value).toBe(128);
    });

    it('setOpusCompressionLevel should switch preset to CUSTOM', () => {
      store.setOpusPreset(AudioPreset.BALANCED);
      store.setOpusCompressionLevel(7);
      expect(store.opusPreset.value).toBe(AudioPreset.CUSTOM);
      expect(store.opusCompressionLevel.value).toBe(7);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/stores/SettingsStore.test.ts`
- Expect: "store.setOpusPreset is not a function"

**Step 3: Implementation (Green)**
- File: `src/stores/SettingsStore.ts`
- Action: Add after `setStereoWidthEnabled` method (around line 211):
  ```typescript
  // ========== Opus Encoding Setters ==========

  setOpusPreset(value: AudioPreset): void {
    const config = AUDIO_PRESETS.find(p => p.name === value);
    if (!config) return;

    this.opusPreset.value = value;
    this.opusMinBitrate.value = config.minBitrate;
    this.opusMaxBitrate.value = config.maxBitrate;
    this.opusCompressionLevel.value = config.compressionLevel;
    this.save();
  }

  setOpusMinBitrate(value: number): void {
    this.opusMinBitrate.value = value;
    this.opusPreset.value = AudioPreset.CUSTOM;
    this.save();
  }

  setOpusMaxBitrate(value: number): void {
    this.opusMaxBitrate.value = value;
    this.opusPreset.value = AudioPreset.CUSTOM;
    this.save();
  }

  setOpusCompressionLevel(value: number): void {
    this.opusCompressionLevel.value = value;
    this.opusPreset.value = AudioPreset.CUSTOM;
    this.save();
  }
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/stores/SettingsStore.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add Opus encoding setters to SettingsStore"`

---

## Task 5: Update SettingsStore Persistence (save/load/reset/toObject)

**Goal:** Ensure Opus settings persist to localStorage and load correctly.

**Step 1: Write the Failing Test**
- File: `src/stores/SettingsStore.test.ts`
- Code (append to describe('persistence')):
  ```typescript
  it('save should include Opus settings', () => {
    store.setOpusPreset(AudioPreset.FAST);
    store.setOpusMinBitrate(56);
    store.save();

    const savedData = JSON.parse((localStorage.setItem as any).mock.calls[0][1]);
    expect(savedData.opusPreset).toBe('fast');
    expect(savedData.opusMinBitrate).toBe(56);
  });

  it('load should restore Opus settings from localStorage', () => {
    const savedState = {
      opusPreset: AudioPreset.MOBILE,
      opusMinBitrate: 40,
      opusMaxBitrate: 56,
      opusCompressionLevel: 5,
    };
    localStorage.getItem = vi.fn(() => JSON.stringify(savedState));

    store.load();

    expect(store.opusPreset.value).toBe(AudioPreset.MOBILE);
    expect(store.opusMinBitrate.value).toBe(40);
    expect(store.opusMaxBitrate.value).toBe(56);
    expect(store.opusCompressionLevel.value).toBe(5);
  });

  it('load should use defaults when Opus settings missing', () => {
    localStorage.getItem = vi.fn(() => JSON.stringify({ rate: 50 }));
    store.load();

    expect(store.opusPreset.value).toBe(AudioPreset.BALANCED);
    expect(store.opusMinBitrate.value).toBe(64);
    expect(store.opusMaxBitrate.value).toBe(96);
    expect(store.opusCompressionLevel.value).toBe(10);
  });

  it('reset should restore Opus defaults', () => {
    store.setOpusPreset(AudioPreset.CUSTOM);
    store.setOpusMinBitrate(100);
    store.reset();

    expect(store.opusPreset.value).toBe(AudioPreset.BALANCED);
    expect(store.opusMinBitrate.value).toBe(64);
  });

  it('toObject should include Opus settings', () => {
    store.setOpusPreset(AudioPreset.MAX_QUALITY);
    const obj = store.toObject();

    expect(obj.opusPreset).toBe(AudioPreset.MAX_QUALITY);
    expect(obj.opusMinBitrate).toBe(128);
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/stores/SettingsStore.test.ts`
- Expect: Various failures about undefined values

**Step 3: Implementation (Green)**
- File: `src/stores/SettingsStore.ts`
- Action 1: In `save()` method (around line 252-275), add to settings object:
  ```typescript
  // After line 274 (stereoWidthEnabled), add:
  opusPreset: this.opusPreset.value,
  opusMinBitrate: this.opusMinBitrate.value,
  opusMaxBitrate: this.opusMaxBitrate.value,
  opusCompressionLevel: this.opusCompressionLevel.value,
  ```
- Action 2: In `load()` method (around line 282-317), add after line 308:
  ```typescript
  this.opusPreset.value = settings.opusPreset ?? defaultSettings.opusPreset;
  this.opusMinBitrate.value = settings.opusMinBitrate ?? defaultSettings.opusMinBitrate;
  this.opusMaxBitrate.value = settings.opusMaxBitrate ?? defaultSettings.opusMaxBitrate;
  this.opusCompressionLevel.value = settings.opusCompressionLevel ?? defaultSettings.opusCompressionLevel;
  ```
- Action 3: In `reset()` method (around line 322-345), add after line 343:
  ```typescript
  this.opusPreset.value = defaultSettings.opusPreset;
  this.opusMinBitrate.value = defaultSettings.opusMinBitrate;
  this.opusMaxBitrate.value = defaultSettings.opusMaxBitrate;
  this.opusCompressionLevel.value = defaultSettings.opusCompressionLevel;
  ```
- Action 4: In `toObject()` method (around line 350-374), add after line 372:
  ```typescript
  opusPreset: this.opusPreset.value,
  opusMinBitrate: this.opusMinBitrate.value,
  opusMaxBitrate: this.opusMaxBitrate.value,
  opusCompressionLevel: this.opusCompressionLevel.value,
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/stores/SettingsStore.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add Opus settings to SettingsStore persistence"`

---

## Task 6: Add English i18n Strings

**Goal:** Add English translations for new UI elements.

**Step 1: Write the Failing Test**
- File: `src/i18n/en.test.ts` (create new file)
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import en from '@/i18n/en.json';

  describe('English i18n - Opus settings', () => {
    it('should have opusEncoding key', () => {
      expect(en.settings.opusEncoding).toBeDefined();
    });

    it('should have all preset labels', () => {
      expect(en.settings['preset.maxQuality']).toBe('Max Quality');
      expect(en.settings['preset.balanced']).toBe('Balanced');
      expect(en.settings['preset.fast']).toBe('Fast');
      expect(en.settings['preset.mobile']).toBe('Mobile');
      expect(en.settings['preset.custom']).toBe('Custom');
    });

    it('should have bitrate labels', () => {
      expect(en.settings.minBitrate).toBeDefined();
      expect(en.settings.maxBitrate).toBeDefined();
      expect(en.settings.compressionLevel).toBeDefined();
      expect(en.settings.kbps).toBe('kbps');
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/i18n/en.test.ts`
- Expect: "Cannot read property 'opusEncoding' of undefined"

**Step 3: Implementation (Green)**
- File: `src/i18n/en.json`
- Action: Add to `"settings"` object (after line 66, before `"dictionary"`):
  ```json
  "opusEncoding": "Opus Encoding",
  "opusEncodingHint": "Quality vs speed tradeoff for Opus output",
  "preset": "Preset",
  "preset.maxQuality": "Max Quality",
  "preset.maxQualityDesc": "128kbps, best quality, slowest encoding",
  "preset.balanced": "Balanced",
  "preset.balancedDesc": "64-96kbps VBR, good quality, reasonable speed",
  "preset.fast": "Fast",
  "preset.fastDesc": "48-64kbps, faster encoding, smaller files",
  "preset.mobile": "Mobile",
  "preset.mobileDesc": "32-48kbps, fastest, smallest files",
  "preset.custom": "Custom",
  "bitrateRange": "Bitrate Range",
  "bitrateRangeHint": "VBR allows encoder to adjust between min/max",
  "minBitrate": "Min Bitrate",
  "maxBitrate": "Max Bitrate",
  "compressionLevel": "Compression Level",
  "compressionLevelHint": "10 = best quality (slow), 0 = fastest",
  "kbps": "kbps"
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/i18n/en.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add English i18n for Opus settings"`

---

## Task 7: Add Russian i18n Strings

**Goal:** Add Russian translations for new UI elements.

**Step 1: Write the Failing Test**
- File: `src/i18n/ru.test.ts` (create new file)
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import ru from '@/i18n/ru.json';

  describe('Russian i18n - Opus settings', () => {
    it('should have opusEncoding key', () => {
      expect(ru.settings.opusEncoding).toBeDefined();
    });

    it('should have all preset labels', () => {
      expect(ru.settings['preset.maxQuality']).toBeDefined();
      expect(ru.settings['preset.balanced']).toBeDefined();
      expect(ru.settings['preset.fast']).toBeDefined();
      expect(ru.settings['preset.mobile']).toBeDefined();
    });

    it('should have bitrate labels', () => {
      expect(ru.settings.minBitrate).toBeDefined();
      expect(ru.settings.maxBitrate).toBeDefined();
      expect(ru.settings.compressionLevel).toBeDefined();
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/i18n/ru.test.ts`
- Expect: "Cannot read property 'opusEncoding' of undefined"

**Step 3: Implementation (Green)**
- File: `src/i18n/ru.json`
- Action: Find equivalent location to English file and add:
  ```json
  "opusEncoding": "Кодирование Opus",
  "opusEncodingHint": "Баланс между качеством и скоростью кодирования",
  "preset": "Пресет",
  "preset.maxQuality": "Макс. качество",
  "preset.maxQualityDesc": "128кбит/с, лучшее качество, медленное кодирование",
  "preset.balanced": "Баланс",
  "preset.balancedDesc": "64-96кбит/с VBR, хорошее качество, разумная скорость",
  "preset.fast": "Быстро",
  "preset.fastDesc": "48-64кбит/с, быстрое кодирование, меньше размер",
  "preset.mobile": "Мобильный",
  "preset.mobileDesc": "32-48кбит/с, самое быстрое, минимальный размер",
  "preset.custom": "Своё",
  "bitrateRange": "Диапазон битрейта",
  "bitrateRangeHint": "VBR позволяет кодировщику менять битрейт",
  "minBitrate": "Мин. битрейт",
  "maxBitrate": "Макс. битрейт",
  "compressionLevel": "Уровень сжатия",
  "compressionLevelHint": "10 = лучшее качество (медленно), 0 = быстрее",
  "kbps": "кбит/с"
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/i18n/ru.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: add Russian i18n for Opus settings"`

---

## Task 8: Add Opus Settings UI to AudioTab (Preset Buttons)

**Goal:** Add preset button UI to AudioTab component.

**Step 1: Write the Component**
- File: `src/components/settings/tabs/AudioTab.tsx`
- Action: After the Output Format section (after line 33), add:
  ```tsx
  {/* Opus Encoding Settings - Presets */}
  {settings.outputFormat.value === 'opus' && (
        <>
          <div className="space-y-4 p-4 bg-primary rounded-lg border border-border">
            <div className="font-medium">
              <Text id="settings.opusEncoding">Opus Encoding</Text>
            </div>
            <p className="text-xs text-gray-500">
              <Text id="settings.opusEncodingHint" />
            </p>

            {/* Preset Buttons */}
            <div className="grid grid-cols-4 gap-2">
              {AUDIO_PRESETS.map(preset => (
                <button
                  key={preset.name}
                  onClick={() => settings.setOpusPreset(preset.name)}
                  className={`text-xs p-2 rounded ${
                    settings.opusPreset.value === preset.name
                      ? 'bg-accent text-white'
                      : 'bg-primary-secondary'
                  }`}
                >
                  <Text id={preset.labelId} />
                </button>
              ))}
            </div>
          </div>
        </>
      )}
  ```

**Step 2: Add Import**
- File: `src/components/settings/tabs/AudioTab.tsx`
- Action: Add to imports at top:
  ```tsx
  import { AudioPreset, AUDIO_PRESETS } from '@/state/types';
  ```

**Step 3: Verify (Visual/Typecheck)**
- Command: `npm run typecheck`
- Expect: PASS

**Step 4: Git Commit**
- Command: `git add . && git commit -m "feat: add Opus preset buttons to AudioTab UI"`

---

## Task 9: Add Sliders to AudioTab UI

**Goal:** Add min/max bitrate and compression level sliders.

**Step 1: Write the Component**
- File: `src/components/settings/tabs/AudioTab.tsx`
- Action: In the Opus section (inside the div after preset buttons), add after the buttons grid:
  ```tsx
    {/* Min Bitrate Slider */}
    <div>
      <div className="flex justify-between text-sm">
        <Text id="settings.minBitrate">Min Bitrate</Text>
        <span className="font-mono">{settings.opusMinBitrate.value} <Text id="settings.kbps">kbps</Text></span>
      </div>
      <input
        type="range"
        min="6"
        max="256"
        step="2"
        value={settings.opusMinBitrate.value}
        onChange={(e) => settings.setOpusMinBitrate(Number((e.target as HTMLInputElement).value))}
        className="w-full"
      />
    </div>

    {/* Max Bitrate Slider */}
    <div>
      <div className="flex justify-between text-sm">
        <Text id="settings.maxBitrate">Max Bitrate</Text>
        <span className="font-mono">{settings.opusMaxBitrate.value} <Text id="settings.kbps">kbps</Text></span>
      </div>
      <input
        type="range"
        min="6"
        max="256"
        step="2"
        value={settings.opusMaxBitrate.value}
        onChange={(e) => settings.setOpusMaxBitrate(Number((e.target as HTMLInputElement).value))}
        className="w-full"
      />
    </div>

    {/* Compression Level Slider */}
    <div>
      <div className="flex justify-between text-sm">
        <Text id="settings.compressionLevel">Compression Level</Text>
        <span className="font-mono">{settings.opusCompressionLevel.value}</span>
      </div>
      <input
        type="range"
        min="0"
        max="10"
        step="1"
        value={settings.opusCompressionLevel.value}
        onChange={(e) => settings.setOpusCompressionLevel(Number((e.target as HTMLInputElement).value))}
        className="w-full"
      />
      <p className="text-xs text-gray-500 mt-1">
        <Text id="settings.compressionLevelHint" />
      </p>
    </div>
  ```

**Step 2: Verify (Typecheck)**
- Command: `npm run typecheck`
- Expect: PASS

**Step 3: Git Commit**
- Command: `git add . && git commit -m "feat: add Opus bitrate and compression sliders to AudioTab"`

---

## Task 10: Extend AudioProcessingConfig Interface

**Goal:** Add Opus settings to AudioProcessingConfig for FFmpeg.

**Step 1: Write the Failing Test**
- File: `src/services/FFmpegService.test.ts` (create new file)
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import type { AudioProcessingConfig } from '@/services/FFmpegService';

  describe('AudioProcessingConfig', () => {
    it('should accept Opus encoding parameters', () => {
      const config: AudioProcessingConfig = {
        silenceRemoval: true,
        normalization: true,
        deEss: true,
        silenceGapMs: 100,
        eq: true,
        compressor: true,
        fadeIn: true,
        stereoWidth: false,
        opusMinBitrate: 48,
        opusMaxBitrate: 64,
        opusCompressionLevel: 5,
      };
      expect(config.opusMinBitrate).toBe(48);
      expect(config.opusMaxBitrate).toBe(64);
      expect(config.opusCompressionLevel).toBe(5);
    });

    it('should work without Opus parameters (backward compat)', () => {
      const config: AudioProcessingConfig = {
        silenceRemoval: false,
        normalization: false,
        deEss: false,
        silenceGapMs: 0,
        eq: false,
        compressor: false,
        fadeIn: false,
        stereoWidth: false,
      };
      expect(config.opusMinBitrate).toBeUndefined();
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/FFmpegService.test.ts`
- Expect: Type error about unknown properties

**Step 3: Implementation (Green)**
- File: `src/services/FFmpegService.ts`
- Action: In `AudioProcessingConfig` interface (around line 9-18), add after `stereoWidth: boolean;`:
  ```typescript
  // Opus encoding settings (optional, uses defaults if not provided)
  opusMinBitrate?: number;
  opusMaxBitrate?: number;
  opusCompressionLevel?: number;
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/FFmpegService.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: extend AudioProcessingConfig with Opus parameters"`

---

## Task 11: Update FFmpegService to Use Opus Settings

**Goal:** Use dynamic Opus settings instead of hardcoded values.

**Step 1: Write the Failing Test**
- File: `src/services/FFmpegService.test.ts`
- Code (append):
  ```typescript
  import { FFmpegService } from '@/services/FFmpegService';
  import { LogStore } from '@/stores/LogStore';
  import { AudioPreset } from '@/state/types';

  describe('FFmpegService Opus integration', () => {
    let service: FFmpegService;
    let logStore: LogStore;

    beforeEach(() => {
      logStore = new LogStore();
      service = new FFmpegService(logStore);
    });

    it('should use custom Opus settings when provided', async () => {
      // Mock FFmpeg for testing
      const mockArgs: string[] = [];
      (service as any).ffmpeg = {
        exec: async (...args: string[]) => {
          mockArgs.push(...args);
          // Find the index of output.opus
          const outputIdx = args.indexOf('output.opus');
          if (outputIdx > 0) {
            // Check that bitrate args are present
            const bitrateIdx = args.indexOf('-b:a');
            expect(bitrateIdx).toBeGreaterThan(-1);
            expect(args[bitrateIdx + 1]).toBe('48k');
          }
        },
        writeFile: () => {},
        readFile: () => new Uint8Array(),
        deleteFile: () => {},
      };
      (service as any).loaded = true;

      const config: AudioProcessingConfig = {
        silenceRemoval: false,
        normalization: false,
        deEss: false,
        silenceGapMs: 0,
        eq: false,
        compressor: false,
        fadeIn: false,
        stereoWidth: false,
        opusMinBitrate: 48,
        opusMaxBitrate: 64,
        opusCompressionLevel: 5,
      };

      await service.processAudio([new Uint8Array()], config);
      // Assertion inside mock checks bitrate
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/FFmpegService.test.ts`
- Expect: Test fails because hardcoded values are used

**Step 3: Implementation (Green)**
- File: `src/services/FFmpegService.ts`
- Action: In `processAudio()` method, replace lines 200-207 with:
  ```typescript
  // Determine Opus encoding settings
  const minBitrate = config.opusMinBitrate ?? defaultConfig.audio.opusBitrate;
  const maxBitrate = config.opusMaxBitrate ?? minBitrate;
  const compression = config.opusCompressionLevel ?? defaultConfig.audio.opusCompression;

  args.push(
    '-c:a', 'libopus',
    '-b:a', `${minBitrate}k`,
    '-compression_level', String(compression),
    '-vbr', 'on',
    ...(maxBitrate > minBitrate ? ['-maxrate', `${maxBitrate}k`] : []),
    '-ar', String(defaultConfig.audio.sampleRate),
    '-ac', config.stereoWidth ? '2' : '1',
    'output.opus'
  );
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/FFmpegService.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: use dynamic Opus settings in FFmpegService"`

---

## Task 12: Update AudioMerger to Pass Opus Settings

**Goal:** Pass Opus settings from SettingsStore through to FFmpegService.

**Step 1: Update MergerConfig Interface**
- File: `src/services/AudioMerger.ts`
- Action: In `MergerConfig` interface (around line 26-36), add after `stereoWidth: boolean;`:
  ```typescript
  // Opus encoding settings
  opusMinBitrate?: number;
  opusMaxBitrate?: number;
  opusCompressionLevel?: number;
  ```

**Step 2: Update mergeAudioGroupAsync**
- File: `src/services/AudioMerger.ts`
- Action: In `mergeAudioGroupAsync()` method, find the `ffmpegService.processAudio` call (around line 311), and add to the config object:
  ```typescript
  const processedAudio = await this.ffmpegService.processAudio(
    chunks,
    {
      silenceRemoval: this.config.silenceRemoval,
      normalization: this.config.normalization,
      deEss: this.config.deEss,
      silenceGapMs: this.config.silenceGapMs,
      eq: this.config.eq,
      compressor: this.config.compressor,
      fadeIn: this.config.fadeIn,
      stereoWidth: this.config.stereoWidth,
      opusMinBitrate: this.config.opusMinBitrate,
      opusMaxBitrate: this.config.opusMaxBitrate,
      opusCompressionLevel: this.config.opusCompressionLevel,
    },
    onProgress
  );
  ```

**Step 3: Find Where MergerConfig is Created**
- File: `src/services/pipeline/steps/AudioMergeStep.ts`
- Action: Find where `MergerConfig` is created and add Opus settings:
  ```typescript
  // This will need to read from SettingsStore
  const mergerConfig: MergerConfig = {
    // ... existing fields ...
    opusMinBitrate: settings.opusMinBitrate.value,
    opusMaxBitrate: settings.opusMaxBitrate.value,
    opusCompressionLevel: settings.opusCompressionLevel.value,
  };
  ```

**Step 4: Verify (Typecheck)**
- Command: `npm run typecheck`
- Expect: PASS

**Step 5: Git Commit**
- Command: `git add . && git commit -m "feat: pass Opus settings through AudioMerger pipeline"`

---

## Task 13: End-to-End Testing

**Goal:** Verify the full flow works.

**Step 1: Manual Verification**
- Start dev server: `npm run dev`
- Open browser to http://localhost:5173
- Navigate to Settings tab
- Change Output Format to Opus
- Verify preset buttons appear and work
- Verify sliders update when presets are clicked
- Verify sliders switch preset to "Custom"

**Step 2: Verify FFmpeg Args**
- Check browser console for FFmpeg logs
- Verify `-b:a` and `-compression_level` values match settings

**Step 3: Git Commit**
- Command: `git add . && git commit -m "test: add e2e verification for Opus settings"`

---

## Summary

This plan implements the Opus Bitrate Settings UI feature in 13 tasks:

1. Types and Config (Tasks 1-2)
2. SettingsStore (Tasks 3-5)
3. i18n (Tasks 6-7)
4. UI Components (Tasks 8-9)
5. FFmpeg Integration (Tasks 10-12)
6. E2E Testing (Task 13)

Each task follows TDD: Write failing test → Implement → Verify → Commit.
