# Implementation Plan - Broadcast Voice Audio Enhancement

> **Reference:** `docs/designs/2026-02-13-broadcast-voice-enhancement-design.md`
> **Execution:** Use `executing-plans` skill.

---

### Task 1: Add 4 new fields to AppSettings type

**Goal:** Extend the `AppSettings` interface with `eqEnabled`, `compressorEnabled`, `fadeInEnabled`, `stereoWidthEnabled`.

**Step 1: Write the Failing Test**
- File: `src/stores/SettingsStore.test.ts`
- Add inside `describe('initial state')`:
  ```typescript
  it('should have broadcast voice defaults', () => {
    expect(store.eqEnabled.value).toBe(true);
    expect(store.compressorEnabled.value).toBe(true);
    expect(store.fadeInEnabled.value).toBe(true);
    expect(store.stereoWidthEnabled.value).toBe(true);
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/stores/SettingsStore.test.ts`
- Expect: TypeScript error — `eqEnabled` does not exist on `SettingsStore`

**Step 3: Implementation (Green)**

- File: `src/state/types.ts`
- Action: Add 4 fields to `AppSettings` interface after `silenceGapMs: number;`:
  ```typescript
  // Broadcast voice audio enhancement
  eqEnabled: boolean;
  compressorEnabled: boolean;
  fadeInEnabled: boolean;
  stereoWidthEnabled: boolean;
  ```

- File: `src/stores/SettingsStore.ts`
- Action 1: Add to `defaultSettings` (after `silenceGapMs: 100`):
  ```typescript
  eqEnabled: true,
  compressorEnabled: true,
  fadeInEnabled: true,
  stereoWidthEnabled: true,
  ```
- Action 2: Change existing defaults:
  ```typescript
  normalizationEnabled: true,   // was false
  deEssEnabled: true,           // was false
  ```
- Action 3: Add 4 signals after `readonly silenceGapMs`:
  ```typescript
  readonly eqEnabled = signal<boolean>(defaultSettings.eqEnabled);
  readonly compressorEnabled = signal<boolean>(defaultSettings.compressorEnabled);
  readonly fadeInEnabled = signal<boolean>(defaultSettings.fadeInEnabled);
  readonly stereoWidthEnabled = signal<boolean>(defaultSettings.stereoWidthEnabled);
  ```
- Action 4: Add setters after `setSilenceGapMs` (follow existing toggle/set pattern):
  ```typescript
  toggleEq(): void {
    this.eqEnabled.value = !this.eqEnabled.value;
    this.save();
  }

  setEqEnabled(value: boolean): void {
    this.eqEnabled.value = value;
    this.save();
  }

  toggleCompressor(): void {
    this.compressorEnabled.value = !this.compressorEnabled.value;
    this.save();
  }

  setCompressorEnabled(value: boolean): void {
    this.compressorEnabled.value = value;
    this.save();
  }

  toggleFadeIn(): void {
    this.fadeInEnabled.value = !this.fadeInEnabled.value;
    this.save();
  }

  setFadeInEnabled(value: boolean): void {
    this.fadeInEnabled.value = value;
    this.save();
  }

  toggleStereoWidth(): void {
    this.stereoWidthEnabled.value = !this.stereoWidthEnabled.value;
    this.save();
  }

  setStereoWidthEnabled(value: boolean): void {
    this.stereoWidthEnabled.value = value;
    this.save();
  }
  ```
- Action 5: Add to `save()` method's `settings` object (after `silenceGapMs`):
  ```typescript
  eqEnabled: this.eqEnabled.value,
  compressorEnabled: this.compressorEnabled.value,
  fadeInEnabled: this.fadeInEnabled.value,
  stereoWidthEnabled: this.stereoWidthEnabled.value,
  ```
- Action 6: Add to `load()` method (after `silenceGapMs` line):
  ```typescript
  this.eqEnabled.value = settings.eqEnabled ?? defaultSettings.eqEnabled;
  this.compressorEnabled.value = settings.compressorEnabled ?? defaultSettings.compressorEnabled;
  this.fadeInEnabled.value = settings.fadeInEnabled ?? defaultSettings.fadeInEnabled;
  this.stereoWidthEnabled.value = settings.stereoWidthEnabled ?? defaultSettings.stereoWidthEnabled;
  ```
- Action 7: Add to `reset()` method (after `silenceGapMs` line):
  ```typescript
  this.eqEnabled.value = defaultSettings.eqEnabled;
  this.compressorEnabled.value = defaultSettings.compressorEnabled;
  this.fadeInEnabled.value = defaultSettings.fadeInEnabled;
  this.stereoWidthEnabled.value = defaultSettings.stereoWidthEnabled;
  ```
- Action 8: Add to `toObject()` return (after `silenceGapMs`):
  ```typescript
  eqEnabled: this.eqEnabled.value,
  compressorEnabled: this.compressorEnabled.value,
  fadeInEnabled: this.fadeInEnabled.value,
  stereoWidthEnabled: this.stereoWidthEnabled.value,
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/stores/SettingsStore.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- `git add src/state/types.ts src/stores/SettingsStore.ts src/stores/SettingsStore.test.ts && git commit -m "feat(audio): add 4 broadcast voice settings to AppSettings and SettingsStore"`

---

### Task 2: Update config defaults

**Goal:** Change 3 default values in `src/config/index.ts`: `silenceThreshold`, `silenceStopDuration`, `normTruePeak`.

**Step 1: Write the Failing Test**
- File: `src/config/index.test.ts` (new file)
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { defaultConfig } from '@/config';

  describe('defaultConfig.audio', () => {
    it('silenceThreshold should be -55', () => {
      expect(defaultConfig.audio.silenceThreshold).toBe(-55);
    });

    it('silenceStopDuration should be 0.3', () => {
      expect(defaultConfig.audio.silenceStopDuration).toBe(0.3);
    });

    it('normTruePeak should be -1.0', () => {
      expect(defaultConfig.audio.normTruePeak).toBe(-1.0);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/config/index.test.ts`
- Expect: Fail — values are -50, 0.25, -1.5

**Step 3: Implementation (Green)**
- File: `src/config/index.ts`
- Action: Change 3 values in `audio` block:
  - `normTruePeak: -1.5` → `normTruePeak: -1.0`
  - `silenceThreshold: -50` → `silenceThreshold: -55`
  - `silenceStopDuration: 0.25` → `silenceStopDuration: 0.3`

**Step 4: Verify (Green)**
- Command: `npm test src/config/index.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- `git add src/config/index.ts src/config/index.test.ts && git commit -m "feat(audio): update config defaults for broadcast voice quality"`

---

### Task 3: Add 4 new fields to AudioProcessingOptions and MergerConfig interfaces

**Goal:** Extend `AudioProcessingOptions` in `interfaces.ts`, `AudioProcessingConfig` in `FFmpegService.ts`, and `MergerConfig` in both `interfaces.ts` and `AudioMerger.ts` with `eq`, `compressor`, `fadeIn`, `stereoWidth`.

**Step 1: Write the Failing Test**
- File: `src/services/pipeline/steps/AudioMergeStep.test.ts`
- Add inside `describe('audio processing options')`:
  ```typescript
  it('passes eq option', async () => {
    step = createAudioMergeStep({
      outputFormat: 'mp3',
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: true,
      compressor: false,
      fadeIn: false,
      stereoWidth: false,
      ffmpegService: mockFFmpegService,
      createAudioMerger: (config) => {
        capturedConfig = config;
        return mockAudioMerger;
      },
    });

    const context = createContextWithAudio(testAudioMap, {
      directoryHandle: createMockDirectoryHandle(),
    });
    await step.execute(context, createNeverAbortSignal());

    expect(capturedConfig?.eq).toBe(true);
  });

  it('passes compressor option', async () => {
    step = createAudioMergeStep({
      outputFormat: 'mp3',
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: true,
      fadeIn: false,
      stereoWidth: false,
      ffmpegService: mockFFmpegService,
      createAudioMerger: (config) => {
        capturedConfig = config;
        return mockAudioMerger;
      },
    });

    const context = createContextWithAudio(testAudioMap, {
      directoryHandle: createMockDirectoryHandle(),
    });
    await step.execute(context, createNeverAbortSignal());

    expect(capturedConfig?.compressor).toBe(true);
  });

  it('passes fadeIn option', async () => {
    step = createAudioMergeStep({
      outputFormat: 'mp3',
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: true,
      stereoWidth: false,
      ffmpegService: mockFFmpegService,
      createAudioMerger: (config) => {
        capturedConfig = config;
        return mockAudioMerger;
      },
    });

    const context = createContextWithAudio(testAudioMap, {
      directoryHandle: createMockDirectoryHandle(),
    });
    await step.execute(context, createNeverAbortSignal());

    expect(capturedConfig?.fadeIn).toBe(true);
  });

  it('passes stereoWidth option', async () => {
    step = createAudioMergeStep({
      outputFormat: 'mp3',
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      stereoWidth: true,
      ffmpegService: mockFFmpegService,
      createAudioMerger: (config) => {
        capturedConfig = config;
        return mockAudioMerger;
      },
    });

    const context = createContextWithAudio(testAudioMap, {
      directoryHandle: createMockDirectoryHandle(),
    });
    await step.execute(context, createNeverAbortSignal());

    expect(capturedConfig?.stereoWidth).toBe(true);
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/pipeline/steps/AudioMergeStep.test.ts`
- Expect: TypeScript errors — `eq`, `compressor`, `fadeIn`, `stereoWidth` not in types

**Step 3: Implementation (Green)**

- File: `src/services/interfaces.ts`
- Action 1: Add to `AudioProcessingOptions` (after `silenceGapMs: number;`):
  ```typescript
  eq: boolean;
  compressor: boolean;
  fadeIn: boolean;
  stereoWidth: boolean;
  ```
- Action 2: Add to `MergerConfig` (after `silenceGapMs: number;`):
  ```typescript
  eq: boolean;
  compressor: boolean;
  fadeIn: boolean;
  stereoWidth: boolean;
  ```

- File: `src/services/FFmpegService.ts`
- Action: Add to `AudioProcessingConfig` interface (after `silenceGapMs: number;`):
  ```typescript
  eq: boolean;
  compressor: boolean;
  fadeIn: boolean;
  stereoWidth: boolean;
  ```

- File: `src/services/AudioMerger.ts`
- Action 1: Add to local `MergerConfig` interface (after `silenceGapMs: number;`):
  ```typescript
  eq: boolean;
  compressor: boolean;
  fadeIn: boolean;
  stereoWidth: boolean;
  ```
- Action 2: In `mergeAudioGroupAsync`, update the `processAudio` call to pass new fields:
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
    },
    onProgress
  );
  ```

- File: `src/services/pipeline/steps/AudioMergeStep.ts`
- Action 1: Add to `AudioMergeStepOptions` (after `silenceGapMs: number;`):
  ```typescript
  eq: boolean;
  compressor: boolean;
  fadeIn: boolean;
  stereoWidth: boolean;
  ```
- Action 2: In `execute()`, add new fields to `createAudioMerger` call:
  ```typescript
  const merger = this.options.createAudioMerger({
    outputFormat: useOpus ? 'opus' : 'mp3',
    silenceRemoval: this.options.silenceRemoval,
    normalization: this.options.normalization,
    deEss: this.options.deEss,
    silenceGapMs: this.options.silenceGapMs,
    eq: this.options.eq,
    compressor: this.options.compressor,
    fadeIn: this.options.fadeIn,
    stereoWidth: this.options.stereoWidth,
  });
  ```

- File: `src/services/pipeline/steps/AudioMergeStep.test.ts`
- Action: Update ALL existing `createAudioMergeStep` calls in `beforeEach` and other tests to include the 4 new fields with default `false` values:
  ```typescript
  eq: false,
  compressor: false,
  fadeIn: false,
  stereoWidth: false,
  ```

- File: `src/test/mocks/MockFFmpegService.ts`
- Action: If the mock's `processAudio` type signature needs updating, update it to accept the new fields.

**Step 4: Verify (Green)**
- Command: `npm test src/services/pipeline/steps/AudioMergeStep.test.ts`
- Expect: PASS

**Step 5: Additional Verification**
- Command: `npm run type-check`
- Expect: PASS (no type errors across project)

**Step 6: Git Commit**
- `git add src/services/interfaces.ts src/services/FFmpegService.ts src/services/AudioMerger.ts src/services/pipeline/steps/AudioMergeStep.ts src/services/pipeline/steps/AudioMergeStep.test.ts src/test/mocks/MockFFmpegService.ts && git commit -m "feat(audio): add eq/compressor/fadeIn/stereoWidth to audio interfaces"`

---

### Task 4: Rewrite buildFilterChain in FFmpegService

**Goal:** Implement the new 8-step filter chain (EQ → De-Ess → Silence → Compressor → Loudnorm → Limiter → Fade-In → Stereo) and add `-ac` toggle for stereo width.

**Step 1: Write the Failing Test**
- File: `src/services/FFmpegService.test.ts` (new file)
- Code:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { FFmpegService } from './FFmpegService';

  // Access private method via prototype for testing filter chain logic
  function buildFilterChain(config: any): string {
    const service = new FFmpegService();
    return (service as any).buildFilterChain(config);
  }

  describe('FFmpegService.buildFilterChain', () => {
    const allOff = {
      silenceRemoval: false,
      normalization: false,
      deEss: false,
      silenceGapMs: 0,
      eq: false,
      compressor: false,
      fadeIn: false,
      stereoWidth: false,
    };

    it('returns empty string when all filters disabled', () => {
      expect(buildFilterChain(allOff)).toBe('');
    });

    it('includes EQ filters when eq enabled', () => {
      const chain = buildFilterChain({ ...allOff, eq: true });
      expect(chain).toContain('highpass=f=60');
      expect(chain).toContain('lowshelf=f=120:g=2');
      expect(chain).toContain('equalizer=f=3000:t=q:w=1:g=-2');
    });

    it('includes deesser when deEss enabled', () => {
      const chain = buildFilterChain({ ...allOff, deEss: true });
      expect(chain).toContain('deesser=');
    });

    it('includes silenceremove when silenceRemoval enabled', () => {
      const chain = buildFilterChain({ ...allOff, silenceRemoval: true });
      expect(chain).toContain('silenceremove=');
    });

    it('includes compand when compressor enabled', () => {
      const chain = buildFilterChain({ ...allOff, compressor: true });
      expect(chain).toContain('compand=');
    });

    it('includes loudnorm when normalization enabled', () => {
      const chain = buildFilterChain({ ...allOff, normalization: true });
      expect(chain).toContain('loudnorm=');
      expect(chain).toContain('dual_mono=true');
    });

    it('includes alimiter automatically when normalization enabled', () => {
      const chain = buildFilterChain({ ...allOff, normalization: true });
      expect(chain).toContain('alimiter=');
    });

    it('does NOT include alimiter when normalization disabled', () => {
      const chain = buildFilterChain({ ...allOff, compressor: true });
      expect(chain).not.toContain('alimiter=');
    });

    it('includes afade when fadeIn enabled', () => {
      const chain = buildFilterChain({ ...allOff, fadeIn: true });
      expect(chain).toContain('afade=t=in:ss=0:d=0.1');
    });

    it('includes aecho when stereoWidth enabled', () => {
      const chain = buildFilterChain({ ...allOff, stereoWidth: true });
      expect(chain).toContain('aecho=0.8:0.88:10:0.3');
    });

    it('maintains correct filter order: EQ before De-Ess before Silence before Compressor before Loudnorm before Limiter before FadeIn before Stereo', () => {
      const chain = buildFilterChain({
        silenceRemoval: true,
        normalization: true,
        deEss: true,
        silenceGapMs: 100,
        eq: true,
        compressor: true,
        fadeIn: true,
        stereoWidth: true,
      });
      const parts = chain.split(',');
      const eqIdx = parts.findIndex(p => p.includes('highpass'));
      const deEssIdx = parts.findIndex(p => p.includes('deesser'));
      const silenceIdx = parts.findIndex(p => p.includes('silenceremove'));
      const compIdx = parts.findIndex(p => p.includes('compand'));
      const normIdx = parts.findIndex(p => p.includes('loudnorm'));
      const limiterIdx = parts.findIndex(p => p.includes('alimiter'));
      const fadeIdx = parts.findIndex(p => p.includes('afade'));
      const stereoIdx = parts.findIndex(p => p.includes('aecho'));

      expect(eqIdx).toBeLessThan(deEssIdx);
      expect(deEssIdx).toBeLessThan(silenceIdx);
      expect(silenceIdx).toBeLessThan(compIdx);
      expect(compIdx).toBeLessThan(normIdx);
      expect(normIdx).toBeLessThan(limiterIdx);
      expect(limiterIdx).toBeLessThan(fadeIdx);
      expect(fadeIdx).toBeLessThan(stereoIdx);
    });
  });
  ```

**Step 2: Run Test (Red)**
- Command: `npm test src/services/FFmpegService.test.ts`
- Expect: Failures — no EQ/compressor/fadeIn/stereoWidth handling

**Step 3: Implementation (Green)**
- File: `src/services/FFmpegService.ts`
- Action 1: Rewrite `buildFilterChain` method:
  ```typescript
  private buildFilterChain(config: AudioProcessingConfig): string {
    const filters: string[] = [];
    const audio = defaultConfig.audio;

    // 1. EQ — Broadcast Voice warmth & clarity
    if (config.eq) {
      filters.push(
        'highpass=f=60',
        'lowshelf=f=120:g=2',
        'equalizer=f=3000:t=q:w=1:g=-2'
      );
    }

    // 2. De-Ess
    if (config.deEss) {
      filters.push('deesser=i=0.4:m=0.5:f=0.5:s=0.5');
    }

    // 3. Silence Removal
    if (config.silenceRemoval) {
      filters.push(
        `silenceremove=` +
        `start_periods=${audio.silenceStartPeriods}:` +
        `start_silence=${audio.silenceStartDuration}:` +
        `start_threshold=${audio.silenceThreshold}dB:` +
        `detection=peak:` +
        `stop_periods=${audio.silenceStopPeriods}:` +
        `stop_silence=${audio.silenceStopDuration}:` +
        `stop_threshold=${audio.silenceThreshold}dB`
      );
    }

    // 4. Compressor — gentle vocal compression
    if (config.compressor) {
      filters.push(
        'compand=attacks=0.1:decays=0.8:points=-90/-90|-50/-50|-30/-30|-20/-20:soft-knee=6:gain=0'
      );
    }

    // 5. Normalization + 6. Limiter (auto with normalization)
    if (config.normalization) {
      filters.push(
        `loudnorm=` +
        `I=${audio.normLufs}:` +
        `LRA=${audio.normLra}:` +
        `TP=${audio.normTruePeak}:` +
        `dual_mono=true`
      );
      // Limiter always follows normalization
      filters.push(
        'alimiter=level_in=1:level_out=1:limit=0.95:attack=5:release=50:asc=0:asc_level=0'
      );
    }

    // 7. Fade-In
    if (config.fadeIn) {
      filters.push('afade=t=in:ss=0:d=0.1');
    }

    // 8. Stereo Width (pseudo-stereo)
    if (config.stereoWidth) {
      filters.push('aecho=0.8:0.88:10:0.3');
    }

    return filters.join(',');
  }
  ```
- Action 2: In `processAudio` method, change the `-ac` argument to be dynamic based on `config.stereoWidth`. Find the line:
  ```typescript
  '-ac', '1',
  ```
  Replace with:
  ```typescript
  '-ac', config.stereoWidth ? '2' : '1',
  ```

**Step 4: Verify (Green)**
- Command: `npm test src/services/FFmpegService.test.ts`
- Expect: PASS

**Step 5: Git Commit**
- `git add src/services/FFmpegService.ts src/services/FFmpegService.test.ts && git commit -m "feat(audio): rewrite buildFilterChain with broadcast voice filters and stereo toggle"`

---

### Task 5: Wire new settings through PipelineBuilder and ConversionOrchestrator

**Goal:** Pass `eq`, `compressor`, `fadeIn`, `stereoWidth` from settings through `PipelineBuilderOptions` → `AudioMergeStep`.

**Step 1: Write the Failing Test**
- No new test file needed — this is a wiring task. Type-check will catch missing fields.
- Command: `npm run type-check`
- Expect: Type errors in `PipelineBuilder.ts` and `ConversionOrchestrator.ts` (missing new fields)

**Step 2: Implementation (Green)**

- File: `src/services/pipeline/PipelineBuilder.ts`
- Action 1: Add to `PipelineBuilderOptions` interface (after `silenceGapMs: number;`):
  ```typescript
  eq: boolean;
  compressor: boolean;
  fadeIn: boolean;
  stereoWidth: boolean;
  ```
- Action 2: In `build()` method, update the `.addStep(StepNames.AUDIO_MERGE, {...})` call to pass new fields:
  ```typescript
  .addStep(StepNames.AUDIO_MERGE, {
    outputFormat: options.outputFormat,
    silenceRemoval: options.silenceRemoval,
    normalization: options.normalization,
    deEss: options.deEss,
    silenceGapMs: options.silenceGapMs,
    eq: options.eq,
    compressor: options.compressor,
    fadeIn: options.fadeIn,
    stereoWidth: options.stereoWidth,
    ffmpegService: this.ffmpegService,
    createAudioMerger: (cfg: MergerConfig) => this.audioMergerFactory.create(cfg),
  })
  ```

- File: `src/services/ConversionOrchestrator.ts`
- Action: Add new fields where `PipelineBuilderOptions` is constructed (after `deEss:` line):
  ```typescript
  eq: this.stores.settings.eqEnabled.value,
  compressor: this.stores.settings.compressorEnabled.value,
  fadeIn: this.stores.settings.fadeInEnabled.value,
  stereoWidth: this.stores.settings.stereoWidthEnabled.value,
  ```

**Step 3: Verify (Green)**
- Command: `npm run type-check`
- Expect: PASS

**Step 4: Run all tests**
- Command: `npm test`
- Expect: PASS

**Step 5: Git Commit**
- `git add src/services/pipeline/PipelineBuilder.ts src/services/ConversionOrchestrator.ts && git commit -m "feat(audio): wire broadcast voice settings through pipeline builder"`

---

### Task 6: Add i18n strings

**Goal:** Add English and Russian translation keys for the 4 new audio settings.

**Step 1: Write the Failing Test**
- No dedicated test — this is a data-only change. Verify by visual inspection.

**Step 2: Implementation**

- File: `src/i18n/en.json`
- Action: Add after `"deEssHint"` entry in `settings`:
  ```json
  "eq": "EQ (Broadcast Voice)",
  "eqHint": "Add warmth and reduce digital harshness",
  "compressor": "Compressor",
  "compressorHint": "Smooth out volume differences for consistent listening",
  "fadeIn": "Fade-In",
  "fadeInHint": "Smooth 100ms fade-in to prevent clicks",
  "stereoWidth": "Stereo Width",
  "stereoWidthHint": "Pseudo-stereo for headphone comfort (doubles file size)",
  "filterChain": "Processing Chain",
  ```
- Action: Update existing hint:
  ```json
  "normalizationHint": "Balance audio levels (includes limiter)",
  ```

- File: `src/i18n/ru.json`
- Action: Add after `"deEssHint"` entry in `settings`:
  ```json
  "eq": "Эквалайзер (Радио)",
  "eqHint": "Добавить теплоту и убрать цифровую резкость",
  "compressor": "Компрессор",
  "compressorHint": "Сгладить перепады громкости для комфортного прослушивания",
  "fadeIn": "Плавное начало",
  "fadeInHint": "Плавное нарастание 100мс для предотвращения щелчков",
  "stereoWidth": "Стерео",
  "stereoWidthHint": "Псевдо-стерео для наушников (удваивает размер файла)",
  "filterChain": "Цепочка обработки",
  ```
- Action: Update existing hint:
  ```json
  "normalizationHint": "Выровнять уровни звука (включает лимитер)",
  ```

**Step 3: Verify**
- Command: `npm run type-check`
- Expect: PASS

**Step 4: Git Commit**
- `git add src/i18n/en.json src/i18n/ru.json && git commit -m "feat(audio): add i18n strings for broadcast voice settings"`

---

### Task 7: Update AudioTab UI with new toggles and filter chain display

**Goal:** Add 4 new toggle cards in filter chain order + live filter chain order display.

**Step 1: Write the Failing Test**
- No unit test for UI components in this codebase (Preact components tested manually). Verify via `npm run type-check`.

**Step 2: Implementation**

- File: `src/components/settings/tabs/AudioTab.tsx`
- Action: Replace the entire Opus-only settings section. New order within `{settings.outputFormat.value === 'opus' && (<>...</>)}`:

  1. **EQ (Broadcast Voice)** toggle — NEW
  2. **De-Ess** toggle — existing (moved up from position 3)
  3. **Remove Silence** toggle — existing (moved down from position 1)
  4. **Compressor** toggle — NEW
  5. **Normalize Audio** toggle — existing (moved from position 2, hint updated)
  6. **Fade-In** toggle — NEW
  7. **Stereo Width** toggle — NEW
  8. **Gap Between Chunks** slider — existing
  9. **Filter Chain Order** display — NEW
  10. **FFmpeg Warning** — existing

  Full replacement code for the Opus section:
  ```tsx
  {settings.outputFormat.value === 'opus' && (
    <>
      {/* 1. EQ (Broadcast Voice) */}
      <div className="flex items-center justify-between p-4 bg-primary rounded-lg border border-border">
        <div>
          <div className="font-medium">
            <Text id="settings.eq">EQ (Broadcast Voice)</Text>
          </div>
          <div className="text-sm text-gray-400">
            <Text id="settings.eqHint">Add warmth and reduce digital harshness</Text>
          </div>
        </div>
        <Toggle
          checked={settings.eqEnabled.value}
          onChange={(v) => settings.setEqEnabled(v)}
        />
      </div>

      {/* 2. De-Ess */}
      <div className="flex items-center justify-between p-4 bg-primary rounded-lg border border-border">
        <div>
          <div className="font-medium">
            <Text id="settings.deEss">De-Ess</Text>
          </div>
          <div className="text-sm text-gray-400">
            <Text id="settings.deEssHint">Reduce harsh sibilant sounds</Text>
          </div>
        </div>
        <Toggle
          checked={settings.deEssEnabled.value}
          onChange={(v) => settings.setDeEssEnabled(v)}
        />
      </div>

      {/* 3. Silence Removal */}
      <div className="flex items-center justify-between p-4 bg-primary rounded-lg border border-border">
        <div>
          <div className="font-medium">
            <Text id="settings.silenceRemoval">Remove Silence</Text>
          </div>
          <div className="text-sm text-gray-400">
            <Text id="settings.silenceRemovalHint">Remove long pauses from audio</Text>
          </div>
        </div>
        <Toggle
          checked={settings.silenceRemovalEnabled.value}
          onChange={(v) => settings.setSilenceRemovalEnabled(v)}
        />
      </div>

      {/* 4. Compressor */}
      <div className="flex items-center justify-between p-4 bg-primary rounded-lg border border-border">
        <div>
          <div className="font-medium">
            <Text id="settings.compressor">Compressor</Text>
          </div>
          <div className="text-sm text-gray-400">
            <Text id="settings.compressorHint">Smooth out volume differences for consistent listening</Text>
          </div>
        </div>
        <Toggle
          checked={settings.compressorEnabled.value}
          onChange={(v) => settings.setCompressorEnabled(v)}
        />
      </div>

      {/* 5. Normalization (includes Limiter) */}
      <div className="flex items-center justify-between p-4 bg-primary rounded-lg border border-border">
        <div>
          <div className="font-medium">
            <Text id="settings.normalization">Normalize Audio</Text>
          </div>
          <div className="text-sm text-gray-400">
            <Text id="settings.normalizationHint">Balance audio levels (includes limiter)</Text>
          </div>
        </div>
        <Toggle
          checked={settings.normalizationEnabled.value}
          onChange={(v) => settings.setNormalizationEnabled(v)}
        />
      </div>

      {/* 6. Fade-In */}
      <div className="flex items-center justify-between p-4 bg-primary rounded-lg border border-border">
        <div>
          <div className="font-medium">
            <Text id="settings.fadeIn">Fade-In</Text>
          </div>
          <div className="text-sm text-gray-400">
            <Text id="settings.fadeInHint">Smooth 100ms fade-in to prevent clicks</Text>
          </div>
        </div>
        <Toggle
          checked={settings.fadeInEnabled.value}
          onChange={(v) => settings.setFadeInEnabled(v)}
        />
      </div>

      {/* 7. Stereo Width */}
      <div className="flex items-center justify-between p-4 bg-primary rounded-lg border border-border">
        <div>
          <div className="font-medium">
            <Text id="settings.stereoWidth">Stereo Width</Text>
          </div>
          <div className="text-sm text-gray-400">
            <Text id="settings.stereoWidthHint">Pseudo-stereo for headphone comfort (doubles file size)</Text>
          </div>
        </div>
        <Toggle
          checked={settings.stereoWidthEnabled.value}
          onChange={(v) => settings.setStereoWidthEnabled(v)}
        />
      </div>

      {/* Silence Gap */}
      <div className="p-4 bg-primary rounded-lg border border-border">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="font-medium">
              <Text id="settings.silenceGap">Gap Between Chunks</Text>
            </div>
            <div className="text-sm text-gray-400">
              <Text id="settings.silenceGapHint">Add silence between audio segments</Text>
            </div>
          </div>
          <span className="text-sm font-mono">{settings.silenceGapMs.value}ms</span>
        </div>
        <input
          type="range"
          min="0"
          max="500"
          step="10"
          value={settings.silenceGapMs.value}
          onChange={(e) => settings.setSilenceGapMs(Number((e.target as HTMLInputElement).value))}
          className="w-full"
        />
      </div>

      {/* Filter Chain Order */}
      <div className="p-4 bg-primary rounded-lg border border-border">
        <div className="font-medium mb-2">
          <Text id="settings.filterChain">Processing Chain</Text>
        </div>
        <div className="flex flex-wrap gap-1">
          {settings.eqEnabled.value && (
            <span className="px-2 py-0.5 text-xs rounded bg-blue-500/20 text-blue-400">EQ</span>
          )}
          {settings.deEssEnabled.value && (
            <span className="px-2 py-0.5 text-xs rounded bg-purple-500/20 text-purple-400">De-Ess</span>
          )}
          {settings.silenceRemovalEnabled.value && (
            <span className="px-2 py-0.5 text-xs rounded bg-green-500/20 text-green-400">Silence</span>
          )}
          {settings.compressorEnabled.value && (
            <span className="px-2 py-0.5 text-xs rounded bg-yellow-500/20 text-yellow-400">Compress</span>
          )}
          {settings.normalizationEnabled.value && (
            <span className="px-2 py-0.5 text-xs rounded bg-orange-500/20 text-orange-400">Normalize</span>
          )}
          {settings.normalizationEnabled.value && (
            <span className="px-2 py-0.5 text-xs rounded bg-orange-500/20 text-orange-400">Limiter</span>
          )}
          {settings.fadeInEnabled.value && (
            <span className="px-2 py-0.5 text-xs rounded bg-cyan-500/20 text-cyan-400">Fade-In</span>
          )}
          {settings.stereoWidthEnabled.value && (
            <span className="px-2 py-0.5 text-xs rounded bg-pink-500/20 text-pink-400">Stereo</span>
          )}
        </div>
      </div>

      {/* FFmpeg Warning */}
      {conversion.ffmpegError.value && (
        <div className="p-3 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
          ⚠️ {conversion.ffmpegError.value}
        </div>
      )}
    </>
  )}
  ```

**Step 3: Verify**
- Command: `npm run type-check`
- Expect: PASS
- Command: `npm test`
- Expect: PASS

**Step 4: Git Commit**
- `git add src/components/settings/tabs/AudioTab.tsx && git commit -m "feat(audio): add broadcast voice toggles and filter chain display to AudioTab"`

---

### Task 8: Final verification

**Goal:** Ensure all tests pass and types check out.

**Step 1: Run type-check**
- Command: `npm run type-check`
- Expect: PASS

**Step 2: Run all tests**
- Command: `npm test`
- Expect: PASS

**Step 3: Git Commit (if any fixups needed)**
- Fix any remaining issues, then:
- `git add -A && git commit -m "fix(audio): address broadcast voice enhancement integration issues"`
