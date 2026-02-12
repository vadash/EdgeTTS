import { Text } from 'preact-i18n';
import { useSettings, useConversion } from '@/stores';
import { Toggle, Button } from '@/components/common';

export function AudioTab() {
  const settings = useSettings();
  const conversion = useConversion();

  return (
    <div className="space-y-6">
      {/* Output Format */}
      <div className="space-y-2">
        <label className="input-label">
          <Text id="settings.outputFormat">Output Format</Text>
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => settings.setOutputFormat('opus')}
            className={`flex-1 btn ${settings.outputFormat.value === 'opus' ? 'btn-primary' : ''}`}
          >
            Opus (Recommended)
          </button>
          <button
            onClick={() => settings.setOutputFormat('mp3')}
            className={`flex-1 btn ${settings.outputFormat.value === 'mp3' ? 'btn-primary' : ''}`}
          >
            MP3
          </button>
        </div>
        <p className="text-xs text-gray-500">
          <Text id="settings.outputFormatHint">Opus offers better quality at smaller file sizes</Text>
        </p>
      </div>

      {/* Opus-only settings */}
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

      {/* FFmpeg Status */}
      <div className="p-4 bg-primary rounded-lg border border-border">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⚙️</span>
          <div>
            <div className="font-medium">FFmpeg</div>
            <div className="text-sm text-gray-400">
              {settings.outputFormat.value === 'opus'
                ? 'Required for Opus encoding and audio processing'
                : 'Not required for MP3 output'}
            </div>
          </div>
        </div>
      </div>

      {/* Save */}
      <Button variant="primary" onClick={() => settings.save()} className="w-full">
        💾 <Text id="settings.save">Save Settings</Text>
      </Button>
    </div>
  );
}
