# Design: Broadcast Voice Audio Enhancement

## 1. Problem Statement

Synthesized TTS speech sounds thin, has unnatural dynamic range, and can have jarring transitions between concatenated chunks. The current filter chain (silence removal → de-ess → loudnorm) lacks warmth, compression, and professional polish that broadcast-quality voice processing provides.

## 2. Goals & Non-Goals

### Must Do
- Add 4 new audio filters: **EQ (Broadcast Voice)**, **Compressor**, **Limiter**, **Fade-In**
- Add 1 new output mode: **Stereo Width** (pseudo-stereo via aecho)
- Reorder the filter chain to: EQ → De-Ess → Silence Removal → Compressor → Loudnorm → Limiter → Fade-In
- **All features enabled by default** (including De-Ess, Normalization, Stereo Width)
- Limiter auto-applied when Normalization is enabled (no separate toggle)
- Show live filter chain order in UI
- Update existing defaults: `silenceThreshold=-55`, `normTruePeak=-1.0`, `silenceStopDuration=0.3`
- Expose individual toggles in AudioTab UI

### Won't Do
- No user-adjustable EQ parameters (fixed "warm radio" preset)
- No user-adjustable compressor parameters (fixed gentle vocal preset)
- No crossfade between chunks (too complex for concat demuxer)
- No multi-band processing

## 3. Proposed Architecture

### Filter Chain Order (New)

```
1. EQ (Broadcast Voice)     [toggle, ON by default]
   ├─ highpass=f=60          (remove rumble)
   ├─ lowshelf=f=120:g=2    (add warmth)
   └─ equalizer=f=3000:t=q:w=1:g=-2  (cut harshness)

2. De-Ess                    [toggle, ON by default]  (existing)
   └─ deesser=i=0.4:m=0.5:f=0.5:s=0.5

3. Silence Removal           [toggle, ON by default]  (existing)
   └─ silenceremove=...

4. Compressor                [toggle, ON by default]
   └─ compand=attacks=0.1:decays=0.8:points=-90/-90|-50/-50|-30/-30|-20/-20:soft-knee=6:gain=0

5. Normalization             [toggle, ON by default] (existing)
   └─ loudnorm=I=-18:LRA=6:TP=-1.0:dual_mono=true

6. Limiter                   [auto when normalization ON, no toggle]
   └─ alimiter=level_in=1:level_out=1:limit=0.95:attack=5:release=50:asc=0:asc_level=0

7. Fade-In                   [toggle, ON by default]
   └─ afade=t=in:ss=0:d=0.1

8. Stereo Width              [toggle, ON by default]
   └─ aecho=0.8:0.88:10:0.3  (+ switch -ac 1 → -ac 2)
```

### Component Changes

```
src/state/types.ts           → Add 4 new fields to AppSettings
src/config/index.ts          → Update 3 default values
src/stores/SettingsStore.ts  → Add 4 new signals + setters + persistence
src/services/interfaces.ts   → Add 4 new fields to AudioProcessingOptions
src/services/FFmpegService.ts→ Rewrite buildFilterChain, add -ac toggle
src/services/AudioMerger.ts  → Add 4 new fields to MergerConfig
src/components/settings/tabs/AudioTab.tsx → Add 4 new toggles + filter order display
src/i18n/en.json             → Add i18n strings
src/i18n/ru.json             → Add i18n strings
```

## 4. Data Models / Schema

### AppSettings (additions to `src/state/types.ts`)

```typescript
export interface AppSettings {
  // ... existing fields ...

  // NEW audio processing toggles
  eqEnabled: boolean;           // Broadcast Voice EQ
  compressorEnabled: boolean;   // Dynamic range compression
  fadeInEnabled: boolean;       // 100ms fade-in on final output
  stereoWidthEnabled: boolean;  // Pseudo-stereo via aecho
}
```

### AudioProcessingConfig (update in `src/services/FFmpegService.ts`)

```typescript
export interface AudioProcessingConfig {
  silenceRemoval: boolean;
  normalization: boolean;
  deEss: boolean;
  silenceGapMs: number;
  // NEW
  eq: boolean;
  compressor: boolean;
  fadeIn: boolean;
  stereoWidth: boolean;
}
```

### AudioProcessingOptions (update in `src/services/interfaces.ts`)

```typescript
export interface AudioProcessingOptions {
  silenceRemoval: boolean;
  normalization: boolean;
  deEss: boolean;
  silenceGapMs: number;
  // NEW
  eq: boolean;
  compressor: boolean;
  fadeIn: boolean;
  stereoWidth: boolean;
}
```

### MergerConfig (update in `src/services/AudioMerger.ts`)

```typescript
export interface MergerConfig {
  outputFormat: 'mp3' | 'opus';
  silenceRemoval: boolean;
  normalization: boolean;
  deEss: boolean;
  silenceGapMs: number;
  // NEW
  eq: boolean;
  compressor: boolean;
  fadeIn: boolean;
  stereoWidth: boolean;
}
```

### Default Settings (in `src/stores/SettingsStore.ts`)

```typescript
const defaultSettings: AppSettings = {
  // ... existing ...
  normalizationEnabled: true,   // CHANGED: was false
  deEssEnabled: true,           // CHANGED: was false
  // NEW
  eqEnabled: true,            // ON by default
  compressorEnabled: true,    // ON by default
  fadeInEnabled: true,         // ON by default
  stereoWidthEnabled: true,   // ON by default
};
```

### Config Defaults (changes to `src/config/index.ts`)

```typescript
audio: {
  // CHANGED values:
  silenceThreshold: -55,      // was -50 (catches softer breathy endings)
  silenceStopDuration: 0.3,   // was 0.25 (prevents cutting words)
  normTruePeak: -1.0,         // was -1.5 (more headroom)
  // All other values unchanged
}
```

## 5. Interface / API Design

### FFmpegService.buildFilterChain (rewrite)

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

### FFmpegService.processAudio — `-ac` toggle

In the args array, change the channel count based on stereo width:

```typescript
args.push(
  '-ac', config.stereoWidth ? '2' : '1',
);
```

### AudioTab UI — Filter Chain Order Display

A small visual indicator showing the active filter chain order, rendered below the toggles:

```tsx
{/* Filter Chain Order */}
<div className="p-4 bg-primary rounded-lg border border-border">
  <div className="font-medium mb-2">Processing Chain</div>
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
  {/* Arrow connectors between active filters */}
</div>
```

### AudioTab UI — New Toggle Layout

Each new feature gets the same toggle card pattern as existing ones (consistent with De-Ess/Silence/Norm). Order matches filter chain:

1. **EQ (Broadcast Voice)** — "Add warmth and reduce digital harshness"
2. **De-Ess** — existing
3. **Remove Silence** — existing
4. **Compressor** — "Smooth out volume differences for consistent listening"
5. **Normalize Audio** — existing (hint updated: "Balance audio levels (includes limiter)")
6. **Fade-In** — "Smooth 100ms fade-in to prevent clicks"
7. **Stereo Width** — "Pseudo-stereo for headphone comfort (doubles file size)"

Then: Gap slider, Filter Chain Order display, FFmpeg status.

## 6. Risks & Edge Cases

| Risk | Mitigation |
|------|------------|
| FFmpeg WASM may not support `alimiter` | Test at runtime. If `alimiter` fails, skip it silently (it's a polish filter, not critical). Log warning. |
| `lowshelf` / `equalizer` may not be in WASM build | Same — test and skip with warning. These are standard lavfi filters, so likely present. |
| `aecho` for stereo on mono source | The filter works on mono input; combined with `-ac 2` it produces stereo output. |
| Stereo + existing Opus settings | Opus supports stereo natively. Bitrate may need increase (64k mono → 96k stereo) for quality parity. For now keep 64k — Opus handles stereo well at low bitrates. |
| Existing users with saved settings | New boolean fields default via `??` fallback in `load()`. Existing localStorage missing new keys → picks up defaults (all ON). |
| Filter chain too long → FFmpeg WASM timeout/OOM | Unlikely for voice-length audio. The filters are lightweight (no FFT-based processing except loudnorm). Monitor via existing `MAX_OPERATIONS_BEFORE_REFRESH`. |
| `dual_mono=true` added to loudnorm | Correct behavior for mono streams. No-op for stereo when stereo width is enabled. |

## 7. Files to Modify (Checklist)

- [ ] `src/state/types.ts` — Add 4 fields to `AppSettings`
- [ ] `src/config/index.ts` — Change 3 default values
- [ ] `src/stores/SettingsStore.ts` — Add 4 signals, setters, save/load/reset/toObject
- [ ] `src/services/interfaces.ts` — Add 4 fields to `AudioProcessingOptions`
- [ ] `src/services/FFmpegService.ts` — Rewrite `buildFilterChain`, add `-ac` toggle, update `AudioProcessingConfig`
- [ ] `src/services/AudioMerger.ts` — Add 4 fields to `MergerConfig`, pass through to FFmpegService
- [ ] `src/components/settings/tabs/AudioTab.tsx` — Add 4 new toggles + filter chain order display
- [ ] `src/i18n/en.json` — Add i18n keys
- [ ] `src/i18n/ru.json` — Add i18n keys
- [ ] Wherever `MergerConfig` is constructed (pipeline step) — pass new fields from settings
