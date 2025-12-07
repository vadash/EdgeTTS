import { useState } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { useLLM } from '@/stores';
import { useLogger } from '@/di/ServiceContext';
import { LLMVoiceService } from '@/services/llm';
import { Button, Toggle, Select, Slider } from '@/components/common';
import { LLMHelp } from './LLMHelp';
import type { ReasoningLevel } from '@/stores/LLMStore';

const reasoningOptions = [
  { value: 'off', label: 'Off' },
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export function LLMTab() {
  const llm = useLLM();
  const logger = useLogger();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string; model?: string } | null>(null);

  const handleTestConnection = async () => {
    if (!llm.apiKey.value) {
      setTestResult({ success: false, error: 'API key is required' });
      return;
    }

    setTesting(true);
    setTestResult(null);

    const service = new LLMVoiceService({
      apiKey: llm.apiKey.value,
      apiUrl: llm.apiUrl.value,
      model: llm.model.value,
      narratorVoice: '',
      logger,
    });

    const result = await service.testConnection();
    setTestResult(result);
    setTesting(false);

    // Auto-save on success
    if (result.success) {
      await llm.saveSettings();
    }
  };

  const handleSave = async () => {
    await llm.saveSettings();
  };

  const handleReasoningChange = (e: Event) => {
    const value = (e.target as HTMLSelectElement).value;
    llm.setReasoning(value === 'off' ? null : value as ReasoningLevel);
  };

  const isReasoningEnabled = !!llm.reasoning.value;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-2xl">🤖</span>
        <div>
          <h3 className="font-semibold">
            <Text id="llm.title">LLM Voice Assignment</Text>
          </h3>
          <p className="text-sm text-gray-400">
            <Text id="llm.description">Use AI to detect characters and assign voices</Text>
          </p>
        </div>
      </div>

      {/* API Key */}
      <div className="space-y-1">
        <label className="input-label">
          <Text id="llm.apiKey">API Key</Text>
        </label>
        <input
          type="password"
          className="input-field"
          value={llm.apiKey.value}
          onInput={(e) => llm.setApiKey((e.target as HTMLInputElement).value)}
          placeholder="sk-... (encrypted in browser storage)"
        />
        <p className="text-xs text-gray-500">
          <Text id="llm.apiKeyHint">Your API key is encrypted and stored locally</Text>
        </p>
      </div>

      {/* API URL */}
      <div className="space-y-1">
        <label className="input-label">
          <Text id="llm.apiUrl">API URL</Text>
        </label>
        <input
          type="text"
          className="input-field"
          value={llm.apiUrl.value}
          onInput={(e) => llm.setApiUrl((e.target as HTMLInputElement).value)}
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
          value={llm.model.value}
          onInput={(e) => llm.setModel((e.target as HTMLInputElement).value)}
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
          checked={llm.streaming.value}
          onChange={(v) => llm.setStreaming(v)}
          label="Streaming"
        />

        {/* Reasoning Mode */}
        <Select
          label="Reasoning Mode"
          value={llm.reasoning.value || 'off'}
          options={reasoningOptions}
          onChange={handleReasoningChange}
        />

        {/* Temperature */}
        <Slider
          label="Temperature"
          value={llm.temperature.value}
          min={0}
          max={1}
          step={0.1}
          onChange={(v) => llm.setTemperature(v)}
          formatValue={(v) => v.toFixed(1)}
          disabled={isReasoningEnabled}
        />

        {/* Top-P */}
        <Slider
          label="Top-P"
          value={llm.topP.value}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => llm.setTopP(v)}
          formatValue={(v) => v.toFixed(2)}
          disabled={isReasoningEnabled}
        />

        {/* Hint about reasoning mode */}
        {isReasoningEnabled && (
          <p className="text-xs text-yellow-500">
            <Text id="llm.reasoningDisablesParams">Temperature and Top-P are disabled when reasoning mode is enabled</Text>
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          onClick={handleTestConnection}
          disabled={testing || !llm.apiKey.value}
          className="flex-1"
        >
          {testing ? (
            <Text id="llm.testing">Testing...</Text>
          ) : (
            <>🔌 <Text id="llm.testConnection">Test Connection</Text></>
          )}
        </Button>
        <Button variant="primary" onClick={handleSave} className="flex-1">
          💾 <Text id="settings.save">Save</Text>
        </Button>
      </div>

      {/* Result */}
      {testResult && (
        <div
          className={`p-3 rounded-lg ${
            testResult.success
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
          }`}
        >
          {testResult.success ? (
            <>✅ <Text id="llm.connectionSuccess">Connection successful!</Text> {testResult.model && <span className="text-gray-400">({testResult.model})</span>}</>
          ) : (
            <>❌ {testResult.error}</>
          )}
        </div>
      )}

      {/* Help section */}
      <LLMHelp />
    </div>
  );
}
