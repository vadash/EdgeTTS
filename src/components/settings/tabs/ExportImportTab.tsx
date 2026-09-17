import { useRef, useState } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { Button, Callout } from '@/components/common';
import {
  STAGE_EXPORT_FIELDS,
  type AppSettings,
  type AudioSettings,
  type StageConfig,
} from '@/state/types';
import { useData, useLLM, useLogs, useSettings } from '@/stores';
import { downloadFile } from '@/utils/file';
import type { LLMStage } from '@/stores/LLMStore';

type StageExportConfig = Pick<StageConfig, (typeof STAGE_EXPORT_FIELDS)[number]>;

interface ExportData {
  version: number;
  settings: AppSettings;
  llm: {
    extract: StageExportConfig;
    merge: StageExportConfig;
    assign: StageExportConfig;
    backup: StageExportConfig;
    useVoting: boolean;
  };
  dictionary: string[];
}

export function ExportImportTab() {
  const settings = useSettings();
  const llm = useLLM();
  const data = useData();
  const logs = useLogs();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastAction, setLastAction] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const exportStageConfig = (stage: LLMStage): StageExportConfig => {
    const config = llm[stage].value;
    return {
      apiUrl: config.apiUrl,
      model: config.model,
      streaming: config.streaming,
      reasoning: config.reasoning,
      temperature: config.temperature,
      maxRetries: config.maxRetries,
      topP: config.topP,
    };
  };

  const handleExport = () => {
    const exportData: ExportData = {
      version: 2, // Bumped version for new format
      settings: settings.toObject(),
      llm: {
        extract: exportStageConfig('extract'),
        merge: exportStageConfig('merge'),
        assign: exportStageConfig('assign'),
        backup: exportStageConfig('backup'),
        useVoting: llm.useVoting.value,
      },
      dictionary: data.dictionaryRaw.value,
    };

    downloadFile(
      JSON.stringify(exportData, null, 2),
      `edgetts-settings-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    );

    setLastAction({ type: 'success', message: 'Settings exported successfully' });
    logs.info('Settings exported');
  };

  const importStageConfig = (stage: LLMStage, config: StageExportConfig | undefined) => {
    if (!config) return;
    for (const field of STAGE_EXPORT_FIELDS) {
      const value = config[field];
      if (value !== undefined) llm.setStageField(stage, field, value);
    }
  };

  const handleImport = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      if (!importData.version || !importData.settings) {
        throw new Error('Invalid settings file format');
      }

      // Import settings
      const s = importData.settings;
      if (s.narratorVoice) settings.setNarratorVoice(s.narratorVoice as string);
      if (s.enabledVoices) settings.setEnabledVoices(s.enabledVoices as string[]);
      if (s.rate !== undefined) settings.setRate(s.rate as number);
      if (s.pitch !== undefined) settings.setPitch(s.pitch as number);
      if (s.ttsThreads !== undefined) settings.setTtsThreads(s.ttsThreads as number);
      if (s.llmThreads !== undefined) settings.setLlmThreads(s.llmThreads as number);
      // outputFormat is always 'opus' now, skip importing

      // Audio settings: accept both the nested `audio` shape and the legacy
      // flat keys from pre-nesting exports.
      const nested = (s.audio ?? {}) as Record<string, unknown>;
      const flat = s as Record<string, unknown>;
      const audioPatch: Partial<AudioSettings> = {};
      const pickAudio = (key: keyof AudioSettings, flatKey: string): void => {
        const value = nested[key] ?? flat[flatKey];
        if (value !== undefined) (audioPatch as Record<string, unknown>)[key] = value;
      };
      pickAudio('silenceRemoval', 'silenceRemovalEnabled');
      pickAudio('normalization', 'normalizationEnabled');
      pickAudio('deEss', 'deEssEnabled');
      pickAudio('silenceGapMs', 'silenceGapMs');
      pickAudio('eq', 'eqEnabled');
      pickAudio('compressor', 'compressorEnabled');
      pickAudio('fadeIn', 'fadeInEnabled');
      pickAudio('opusMinBitrate', 'opusMinBitrate');
      pickAudio('opusMaxBitrate', 'opusMaxBitrate');
      pickAudio('opusCompressionLevel', 'opusCompressionLevel');
      pickAudio('mergeConcurrency', 'mergeConcurrency');
      if (Object.keys(audioPatch).length > 0) settings.patchAudio(audioPatch);

      if (s.lexxRegister !== undefined) settings.setLexxRegister(s.lexxRegister as boolean);

      // Import LLM settings (excluding API key)
      if (importData.llm?.extract) {
        importStageConfig('extract', importData.llm.extract);
        importStageConfig('merge', importData.llm.merge);
        importStageConfig('assign', importData.llm.assign);
        importStageConfig('backup', importData.llm.backup);
        if (importData.llm.useVoting !== undefined) {
          llm.setUseVoting(importData.llm.useVoting);
        }
      }

      // Import dictionary
      if (importData.dictionary && Array.isArray(importData.dictionary)) {
        data.setDictionaryRaw(importData.dictionary);
      }

      setLastAction({ type: 'success', message: 'Settings imported successfully' });
      logs.info(`Settings imported from ${file.name}`);
    } catch (err) {
      setLastAction({ type: 'error', message: (err as Error).message });
      logs.error(`Failed to import settings: ${(err as Error).message}`);
    }

    input.value = '';
  };

  const handleReset = () => {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
      settings.reset();
      setLastAction({ type: 'success', message: 'Settings reset to defaults' });
      logs.info('Settings reset to defaults');
    }
  };

  return (
    <div className="space-y-6">
      {/* Export */}
      <div className="space-y-2">
        <h3 className="font-semibold">
          <Text id="settings.export">Export Settings</Text>
        </h3>
        <p className="text-sm text-gray-400">
          <Text id="settings.exportHint">Save your settings to a file for backup or sharing</Text>
        </p>
        <Button onClick={handleExport} className="w-full">
          📤 <Text id="settings.exportButton">Export to JSON</Text>
        </Button>
        <p className="text-xs text-gray-500">
          ⚠️ <Text id="settings.exportWarning">API keys are not exported for security</Text>
        </p>
      </div>

      <hr className="border-border" />

      {/* Import */}
      <div className="space-y-2">
        <h3 className="font-semibold">
          <Text id="settings.import">Import Settings</Text>
        </h3>
        <p className="text-sm text-gray-400">
          <Text id="settings.importHint">Load settings from a previously exported file</Text>
        </p>
        <Button onClick={() => fileInputRef.current?.click()} className="w-full">
          📥 <Text id="settings.importButton">Import from JSON</Text>
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          className="hidden"
        />
      </div>

      <hr className="border-border" />

      {/* Reset */}
      <div className="space-y-2">
        <h3 className="font-semibold">
          <Text id="settings.reset">Reset Settings</Text>
        </h3>
        <p className="text-sm text-gray-400">
          <Text id="settings.resetHint">Restore all settings to their default values</Text>
        </p>
        <Button
          onClick={handleReset}
          className="w-full text-red-400 border-red-500/30 hover:border-red-400"
        >
          🔄 <Text id="settings.resetButton">Reset to Defaults</Text>
        </Button>
      </div>

      {/* Status Message */}
      {lastAction && (
        <Callout tone={lastAction.type}>
          {lastAction.type === 'success' ? '✅' : '❌'} {lastAction.message}
        </Callout>
      )}
    </div>
  );
}
