import { Text } from 'preact-i18n';
import { Button, Callout, Slider, Toggle } from '@/components/common';
import { useAudioProcessingPreview } from '@/hooks/useAudioProcessingPreview';
import { AUDIO_PRESETS } from '@/state/types';
import { useSettings } from '@/stores';

export function AudioTab() {
  const settings = useSettings();
  const audioPreview = useAudioProcessingPreview();

  // Audio processing toggles: identical rows, differing only by signal and copy.
  const toggles = [
    {
      labelId: 'settings.eq',
      label: 'EQ (Broadcast Voice)',
      hintId: 'settings.eqHint',
      hint: 'Add warmth and reduce digital harshness',
      enabled: settings.eqEnabled,
      set: settings.setEqEnabled,
    },
    {
      labelId: 'settings.deEss',
      label: 'De-Ess',
      hintId: 'settings.deEssHint',
      hint: 'Reduce harsh sibilant sounds',
      enabled: settings.deEssEnabled,
      set: settings.setDeEssEnabled,
    },
    {
      labelId: 'settings.silenceRemoval',
      label: 'Remove Silence',
      hintId: 'settings.silenceRemovalHint',
      hint: 'Remove long pauses from audio',
      enabled: settings.silenceRemovalEnabled,
      set: settings.setSilenceRemovalEnabled,
    },
    {
      labelId: 'settings.compressor',
      label: 'Compressor',
      hintId: 'settings.compressorHint',
      hint: 'Smooth out volume differences for consistent listening',
      enabled: settings.compressorEnabled,
      set: settings.setCompressorEnabled,
    },
    {
      labelId: 'settings.normalization',
      label: 'Normalize Audio',
      hintId: 'settings.normalizationHint',
      hint: 'Balance audio levels (includes limiter)',
      enabled: settings.normalizationEnabled,
      set: settings.setNormalizationEnabled,
    },
    {
      labelId: 'settings.fadeIn',
      label: 'Fade-In',
      hintId: 'settings.fadeInHint',
      hint: 'Smooth 100ms fade-in to prevent clicks',
      enabled: settings.fadeInEnabled,
      set: settings.setFadeInEnabled,
    },
  ];

  // Filter chain chips: identical spans, differing only by signal, color, and label.
  const chips = [
    { enabled: settings.eqEnabled.value, className: 'bg-blue-500/20 text-blue-400', label: 'EQ' },
    {
      enabled: settings.deEssEnabled.value,
      className: 'bg-purple-500/20 text-purple-400',
      label: 'De-Ess',
    },
    {
      enabled: settings.compressorEnabled.value,
      className: 'bg-yellow-500/20 text-yellow-400',
      label: 'Compress',
    },
    {
      enabled: settings.silenceRemovalEnabled.value,
      className: 'bg-green-500/20 text-green-400',
      label: 'Silence',
    },
    {
      enabled: settings.normalizationEnabled.value,
      className: 'bg-orange-500/20 text-orange-400',
      label: 'Normalize',
    },
    {
      enabled: settings.fadeInEnabled.value,
      className: 'bg-cyan-500/20 text-cyan-400',
      label: 'Fade-In',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Opus Encoding Settings - Presets */}
      <div className="space-y-4 p-4 bg-primary rounded-lg border border-border">
        <div className="font-medium">
          <Text id="settings.opusEncoding">Opus Encoding</Text>
        </div>
        <p className="text-xs text-gray-500">
          <Text id="settings.opusEncodingHint" />
        </p>

        {/* Preset Buttons */}
        <div className="grid grid-cols-2 gap-2">
          {AUDIO_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.name}
              onClick={() => settings.applyOpusPreset(preset.name)}
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
            <span className="font-mono">
              {settings.opusMinBitrate.value} <Text id="settings.kbps">kbps</Text>
            </span>
          </div>
          <Slider
            value={settings.opusMinBitrate.value}
            min={16}
            max={96}
            onChange={(v) => settings.setOpusMinBitrate(v)}
          />
        </div>

        {/* Max Bitrate Slider */}
        <div>
          <div className="flex justify-between text-sm">
            <Text id="settings.maxBitrate">Max Bitrate</Text>
            <span className="font-mono">
              {settings.opusMaxBitrate.value} <Text id="settings.kbps">kbps</Text>
            </span>
          </div>
          <Slider
            value={settings.opusMaxBitrate.value}
            min={24}
            max={96}
            onChange={(v) => settings.setOpusMaxBitrate(v)}
          />
        </div>

        {/* Compression Level Slider */}
        <div>
          <Slider
            label="settings.compressionLevel"
            value={settings.opusCompressionLevel.value}
            min={0}
            max={10}
            onChange={(v) => settings.setOpusCompressionLevel(v)}
          />
          <p className="text-xs text-gray-500 mt-1">
            <Text id="settings.compressionLevelHint" />
          </p>
        </div>

        {/* Parallel Encoding Slider */}
        <div>
          <Slider
            label="settings.mergeConcurrency"
            value={settings.mergeConcurrency.value}
            min={1}
            max={4}
            onChange={(v) => settings.setMergeConcurrency(v)}
          />
          <p className="text-xs text-gray-500 mt-1">
            <Text id="settings.mergeConcurrencyHint" />
          </p>
        </div>
      </div>

      {/* Audio processing settings */}
      {toggles.map((t) => (
        <div
          key={t.labelId}
          className="flex items-center justify-between p-4 bg-primary rounded-lg border border-border"
        >
          <div>
            <div className="font-medium">
              <Text id={t.labelId}>{t.label}</Text>
            </div>
            <div className="text-sm text-gray-400">
              <Text id={t.hintId}>{t.hint}</Text>
            </div>
          </div>
          <Toggle checked={t.enabled.value} onChange={t.set} />
        </div>
      ))}

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
        <Slider
          value={settings.silenceGapMs.value}
          min={0}
          max={500}
          step={10}
          onChange={(v) => settings.setSilenceGapMs(v)}
        />
      </div>

      {/* Filter Chain Order */}
      <div className="p-4 bg-primary rounded-lg border border-border">
        <div className="font-medium mb-2">
          <Text id="settings.filterChain">Processing Chain</Text>
        </div>
        <div className="flex flex-wrap gap-1">
          {chips
            .filter((c) => c.enabled)
            .map((c) => (
              <span key={c.label} className={`px-2 py-0.5 text-xs rounded ${c.className}`}>
                {c.label}
              </span>
            ))}
        </div>
        <div className="mt-3 space-y-2">
          <Button
            className="w-full"
            disabled={audioPreview.isPlaying || audioPreview.stage !== null}
            onClick={() =>
              audioPreview.play({
                narratorVoice: settings.narratorVoice.value,
                rate: settings.rate.value,
                pitch: settings.pitch.value,
                config: {
                  eq: settings.eqEnabled.value,
                  deEss: settings.deEssEnabled.value,
                  silenceRemoval: settings.silenceRemovalEnabled.value,
                  compressor: settings.compressorEnabled.value,
                  normalization: settings.normalizationEnabled.value,
                  fadeIn: settings.fadeInEnabled.value,
                  silenceGapMs: 0,
                  opusMinBitrate: settings.opusMinBitrate.value,
                  opusMaxBitrate: settings.opusMaxBitrate.value,
                  opusCompressionLevel: settings.opusCompressionLevel.value,
                  mergeConcurrency: settings.mergeConcurrency.value,
                },
              })
            }
          >
            {audioPreview.stage === null ? (
              <>
                🔊 <Text id="settings.previewProcessing">Preview Audio Processing</Text>
              </>
            ) : audioPreview.stage === 'tts' ? (
              'Generating voice…'
            ) : (
              'Processing…'
            )}
          </Button>
          {audioPreview.error && <Callout tone="warning">⚠️ {audioPreview.error}</Callout>}
        </div>
      </div>

      {/* FFmpeg Status */}
      <div className="p-4 bg-primary rounded-lg border border-border">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⚙️</span>
          <div>
            <div className="font-medium">FFmpeg</div>
            <div className="text-sm text-gray-400">
              Required for Opus encoding and audio processing
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
