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
          {/* Silence Removal */}
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

          {/* Normalization */}
          <div className="flex items-center justify-between p-4 bg-primary rounded-lg border border-border">
            <div>
              <div className="font-medium">
                <Text id="settings.normalization">Normalize Audio</Text>
              </div>
              <div className="text-sm text-gray-400">
                <Text id="settings.normalizationHint">Balance audio levels</Text>
              </div>
            </div>
            <Toggle
              checked={settings.normalizationEnabled.value}
              onChange={(v) => settings.setNormalizationEnabled(v)}
            />
          </div>

          {/* De-Ess */}
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
