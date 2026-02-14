# Design: Opus Bitrate Settings UI

## 1. Problem Statement

Currently, Opus encoding settings (bitrate, compression level) are hardcoded in `defaultConfig`. Users cannot control:
- **Bitrate range** for VBR encoding (currently fixed at 64k)
- **Compression level** (currently fixed at 10, max quality)
- **Quality vs speed tradeoff** (important for mobile/older devices)

This limits users who may want:
- Smaller file sizes for mobile playback
- Faster encoding on lower-end devices
- Maximum quality for archival/master copies

## 2. Goals & Non-Goals

### Must Do
- Add UI controls for Opus bitrate (min, max) and compression level
- Provide named presets for common use cases (Max Quality, Balanced, Fast, Mobile)
- Allow manual override of preset values
- Persist settings in `SettingsStore` and localStorage
- Pass values to FFmpegService for Opus encoding

### Won't Do
- MP3 bitrate settings (MP3 uses Edge TTS default 96kbps)
- Sample rate control (keep at 24kHz for voice content)
- Channel count (already controlled by Stereo Width toggle)
- Custom preset creation/save by users

## 3. Proposed Architecture

### 3.1 High-Level Approach

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   AudioTab.tsx  │────>│   SettingsStore      │────>│  localStorage    │
│                 │     │                      │     │                 │
│ - Preset buttons│     │ - opusPreset         │     │ - All values    │
│ - Sliders      │     │ - opusMinBitrate     │     │                 │
└─────────────────┘     │ - opusMaxBitrate     │     └─────────────────┘
                       │ - opusCompression     │
                       └──────────────────────┘
                                      │
                                      ▼
                       ┌──────────────────────┐
                       │   AudioMerger        │
                       │   FFmpegService      │
                       │   (reads settings)   │
                       └──────────────────────┘
```

### 3.2 Key Components

1. **AudioPreset Type** - Enum of preset names with associated values
2. **SettingsStore Extensions** - New signals and setters for Opus settings
3. **AudioTab Extensions** - New UI section for bitrate/compression controls
4. **FFmpegService Integration** - Read settings from config instead of hardcoded values

## 4. Data Models / Schema

### 4.1 AudioPreset Enum

```typescript
export enum AudioPreset {
  MAX_QUALITY = 'max_quality',   // 128-128k, comp=10 (slowest)
  BALANCED = 'balanced',         // 64-96k, comp=10 (default)
  FAST = 'fast',                 // 48-64k, comp=5
  MOBILE = 'mobile',             // 32-48k, comp=3 (fastest)
  CUSTOM = 'custom'              // User manually adjusted
}
```

### 4.2 Preset Configuration

```typescript
interface AudioPresetConfig {
  name: AudioPreset;
  labelId: string;              // i18n key for display name
  descriptionId: string;        // i18n key for description
  minBitrate: number;           // kbps
  maxBitrate: number;           // kbps
  compressionLevel: number;     // 0-10 (10 = max quality, slowest)
}

const AUDIO_PRESETS: AudioPresetConfig[] = [
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

### 4.3 Updated AppSettings

```typescript
export interface AppSettings {
  // ... existing fields ...

  // Opus encoding settings
  opusPreset: AudioPreset;
  opusMinBitrate: number;      // kbps, range 6-256
  opusMaxBitrate: number;      // kbps, range 6-256, must be >= min
  opusCompressionLevel: number; // 0-10, 10=best quality
}
```

### 4.4 Default Settings (SettingsStore)

```typescript
const defaultSettings: AppSettings = {
  // ... existing defaults ...
  opusPreset: AudioPreset.BALANCED,
  opusMinBitrate: 64,
  opusMaxBitrate: 96,
  opusCompressionLevel: 10,
};
```

### 4.5 i18n Strings (en.json)

```json
{
  "settings": {
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
  }
}
```

## 5. Interface / API Design

### 5.1 SettingsStore Additions

```typescript
export class SettingsStore {
  // New signals
  readonly opusPreset = signal<AudioPreset>(defaultSettings.opusPreset);
  readonly opusMinBitrate = signal<number>(defaultSettings.opusMinBitrate);
  readonly opusMaxBitrate = signal<number>(defaultSettings.opusMaxBitrate);
  readonly opusCompressionLevel = signal<number>(defaultSettings.opusCompressionLevel);

  // Preset selection - updates all values
  setOpusPreset(preset: AudioPreset): void {
    const config = AUDIO_PRESETS.find(p => p.name === preset);
    if (!config) return;

    this.opusPreset.value = preset;
    this.opusMinBitrate.value = config.minBitrate;
    this.opusMaxBitrate.value = config.maxBitrate;
    this.opusCompressionLevel.value = config.compressionLevel;
    this.save();
  }

  // Manual overrides - switches to CUSTOM preset
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
}
```

### 5.2 AudioTab UI Component Structure

```tsx
// Position: After Output Format selector, before other toggles

{settings.outputFormat.value === 'opus' && (
  <div className="space-y-4 p-4 bg-primary rounded-lg border border-border">
    <div className="font-medium">
      <Text id="settings.opusEncoding">Opus Encoding</Text>
    </div>

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

    {/* Min Bitrate Slider */}
    <div>
      <div className="flex justify-between text-sm">
        <Text id="settings.minBitrate">Min Bitrate</Text>
        <span>{settings.opusMinBitrate.value} kbps</span>
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
        <span>{settings.opusMaxBitrate.value} kbps</span>
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
        <span>{settings.opusCompressionLevel.value}</span>
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
  </div>
)}
```

### 5.3 FFmpegService Integration

Currently hardcoded in `FFmpegService.ts:201-203`:
```typescript
'-c:a', 'libopus',
'-b:a', `${defaultConfig.audio.opusBitrate}k`,
'-compression_level', String(defaultConfig.audio.opusCompression),
```

**Change to:** Accept settings via `AudioProcessingConfig`:
```typescript
// AudioProcessingConfig extended
export interface AudioProcessingConfig {
  // ... existing ...
  opusMinBitrate?: number;
  opusMaxBitrate?: number;
  opusCompressionLevel?: number;
}

// In FFmpegService.processAudio(), build args with settings:
const minBitrate = config.opusMinBitrate ?? defaultConfig.audio.opusBitrate;
const maxBitrate = config.opusMaxBitrate ?? minBitrate;
const compression = config.opusCompressionLevel ?? defaultConfig.audio.opusCompression;

args.push(
  '-c:a', 'libopus',
  '-b:a', `${minBitrate}k`,
  '-compression_level', String(compression),
  '-vbr', 'on',
  // For VBR, we may also use -minrate and -maxrate if supported
  ...(maxBitrate > minBitrate ? ['-maxrate', `${maxBitrate}k`] : []),
  'output.opus'
);
```

## 6. Risks & Edge Cases

### 6.1 Validation

| Scenario | Handling |
|----------|----------|
| User sets min > max bitrate | Clamp max to min when changed |
| User sets bitrate < 6 or > 256 | Hard limits on sliders |
| Invalid values from old localStorage | Migration: validate on load, use defaults if invalid |
| FFmpeg doesn't support VBR options | Graceful fallback to target bitrate only |

### 6.2 Migration

Existing users won't have `opusPreset`, `opusMinBitrate`, etc. in localStorage:
```typescript
// In SettingsStore.load()
this.opusPreset.value = settings.opusPreset ?? defaultSettings.opusPreset;
this.opusMinBitrate.value = settings.opusMinBitrate ?? defaultSettings.opusMinBitrate;
this.opusMaxBitrate.value = settings.opusMaxBitrate ?? defaultSettings.opusMaxBitrate;
this.opusCompressionLevel.value = settings.opusCompressionLevel ?? defaultSettings.opusCompressionLevel;
```

### 6.3 Edge Cases

1. **Stereo Width + Low Bitrate**: 32kbps stereo sounds poor. Consider warning when stereo enabled and maxBitrate < 48.

2. **FFmpeg WASM Performance**: Higher compression levels (10) are slow in WASM. The "Fast" and "Mobile" presets address this.

3. **Opus VBR Behavior**: Opus libopus VBR is "constrained" VBR - may not strictly respect min/max. This is acceptable.

### 6.4 Testing

- Unit tests for SettingsStore setters
- Integration test: verify FFmpeg args match settings
- Visual test: UI updates when preset selected
- Migration test: loading from localStorage with missing keys

## 7. Implementation Order

1. **Phase 1**: Types and Config
   - Add `AudioPreset` enum to `types.ts`
   - Add `AUDIO_PRESETS` constant
   - Update `AppSettings` interface

2. **Phase 2**: SettingsStore
   - Add new signals
   - Add setter methods
   - Update `save()`, `load()`, `reset()`, `toObject()`

3. **Phase 3**: i18n
   - Add English strings
   - Add Russian strings

4. **Phase 4**: AudioTab UI
   - Add preset buttons
   - Add sliders
   - Position after Output Format

5. **Phase 5**: FFmpeg Integration
   - Extend `AudioProcessingConfig`
   - Update `processAudio()` to use settings
   - Update `AudioMerger` to pass settings through

6. **Phase 6**: Testing
   - Unit tests
   - Manual testing
   - Migration verification
