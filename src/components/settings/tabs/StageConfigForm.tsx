import { Text } from 'preact-i18n';
import { Button, Toggle, Select, Slider } from '@/components/common';
import type { StageConfig, ReasoningLevel } from '@/stores/LLMStore';

const reasoningOptions = [
  { value: 'off', label: 'Off' },
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export interface TestResult {
  success: boolean;
  error?: string;
  model?: string;
}

interface StageConfigFormProps {
  config: StageConfig;
  onChange: <K extends keyof StageConfig>(field: K, value: StageConfig[K]) => void;
  showVoting?: boolean;
  useVoting?: boolean;
  onVotingChange?: (value: boolean) => void;
  onTestConnection: (useStreaming: boolean) => void;
  testing?: boolean;
  testResult?: TestResult | null;
  onCopySettings?: () => void;
}

export function StageConfigForm({
  config,
  onChange,
  showVoting,
  useVoting,
  onVotingChange,
  onTestConnection,
  testing,
  testResult,
  onCopySettings,
}: StageConfigFormProps) {
  const isReasoningEnabled = !!config.reasoning;

  const handleReasoningChange = (e: Event) => {
    const value = (e.target as HTMLSelectElement).value;
    onChange('reasoning', value === 'off' ? null : value as ReasoningLevel);
  };

  return (
    <div className="space-y-4">
      {/* Copy Settings Button */}
      {onCopySettings && (
        <Button
          onClick={onCopySettings}
          variant="secondary"
          className="w-full"
        >
          📋 <Text id="llm.copySettings">Copy to other stages</Text>
        </Button>
      )}

      {/* API Key */}
      <div className="space-y-1">
        <label className="input-label">
          <Text id="llm.apiKey">API Key</Text>
        </label>
        <input
          type="password"
          className="input-field"
          value={config.apiKey}
          onInput={(e) => onChange('apiKey', (e.target as HTMLInputElement).value)}
          placeholder="sk-... (encrypted in browser storage)"
        />
      </div>

      {/* API URL */}
      <div className="space-y-1">
        <label className="input-label">
          <Text id="llm.apiUrl">API URL</Text>
        </label>
        <input
          type="text"
          className="input-field"
          value={config.apiUrl}
          onInput={(e) => onChange('apiUrl', (e.target as HTMLInputElement).value)}
          placeholder="https://api.openai.com/v1"
        />
      </div>

      {/* Model */}
      <div className="space-y-1">
        <label className="input-label">
          <Text id="llm.model">Model</Text>
        </label>
        <input
          type="text"
          className="input-field"
          value={config.model}
          onInput={(e) => onChange('model', (e.target as HTMLInputElement).value)}
          placeholder="gpt-4o-mini"
        />
      </div>

      {/* Advanced Settings */}
      <div className="space-y-4 pt-2 border-t border-gray-700">
        <h4 className="text-sm font-medium text-gray-300">
          <Text id="llm.advancedSettings">Advanced Settings</Text>
        </h4>

        {/* Streaming Toggle */}
        <Toggle
          checked={config.streaming}
          onChange={(v) => onChange('streaming', v)}
          label="Streaming"
        />

        {/* Reasoning Mode */}
        <Select
          label="Reasoning Mode"
          value={config.reasoning || 'off'}
          options={reasoningOptions}
          onChange={handleReasoningChange}
        />

        {/* Temperature */}
        <Slider
          label="Temperature"
          value={config.temperature}
          min={0}
          max={1}
          step={0.1}
          onChange={(v) => onChange('temperature', v)}
          formatValue={(v) => v.toFixed(1)}
          disabled={isReasoningEnabled}
        />

        {/* Top-P */}
        <Slider
          label="Top-P"
          value={config.topP}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => onChange('topP', v)}
          formatValue={(v) => v.toFixed(2)}
          disabled={isReasoningEnabled}
        />

        {/* Voting - only for Assign stage */}
        {showVoting && onVotingChange && (
          <Toggle
            checked={useVoting ?? false}
            onChange={onVotingChange}
            label="3-Way Voting"
            title="Calls LLM 3x with different temperatures and uses majority vote for speaker assignment"
            disabled={isReasoningEnabled}
          />
        )}

        {/* Hint about reasoning mode */}
        {isReasoningEnabled && (
          <p className="text-xs text-yellow-500">
            <Text id="llm.reasoningDisablesParams">Temperature and Top-P are disabled when reasoning mode is enabled</Text>
          </p>
        )}
      </div>

      {/* Test Connection */}
      <div className="space-y-3 pt-2 border-t border-gray-700">
        <Button
          onClick={() => onTestConnection(config.streaming)}
          disabled={testing || !config.apiKey}
          className="w-full"
        >
          {testing ? (
            <Text id="llm.testing">Testing...</Text>
          ) : (
            <Text id="llm.testConnection">Test Connection</Text>
          )}
        </Button>

        {/* Test Result */}
        {testResult && (
          <div
            className={`p-3 rounded-lg ${
              testResult.success
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}
          >
            {testResult.success ? (
              <>
                <Text id="llm.connectionSuccess">Connection successful!</Text>
                {testResult.model && <span className="text-gray-400 ml-1">({testResult.model})</span>}
              </>
            ) : (
              <>{testResult.error}</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
