import { useEffect, useRef, useState } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { Button, Callout, Select, Slider, Toggle } from '@/components/common';
import type { ReasoningLevel, StageConfig } from '@/state/types';

const reasoningOptions = [
  { value: 'off', label: 'Off' },
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const textFieldSpecs = [
  {
    id: 'api-key-input',
    field: 'apiKey',
    labelId: 'llm.apiKey',
    label: 'API Key',
    type: 'password',
    placeholder: 'sk-... (encrypted in browser storage)',
  },
  {
    id: 'api-url-input',
    field: 'apiUrl',
    labelId: 'llm.apiUrl',
    label: 'API URL',
    type: 'text',
    placeholder: 'https://api.openai.com/v1',
  },
  {
    id: 'model-input',
    field: 'model',
    labelId: 'llm.model',
    label: 'Model',
    type: 'text',
    placeholder: 'gpt-4o-mini',
  },
] as const;

export interface TestResult {
  success: boolean;
  error?: string;
  model?: string;
}

interface StageConfigFormProps {
  config: StageConfig;
  onChange: <K extends keyof StageConfig>(field: K, value: StageConfig[K]) => void;
  /** True only for the merge stage — relabels Max Retries as a vote-budget hint. */
  isMerge?: boolean;
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
  isMerge,
  showVoting,
  useVoting,
  onVotingChange,
  onTestConnection,
  testing,
  testResult,
  onCopySettings,
}: StageConfigFormProps) {
  const isReasoningEnabled = !!config.reasoning;
  const corsErrorDetected = useRef(false);

  const handleReasoningChange = (e: Event) => {
    const value = (e.target as HTMLSelectElement).value;
    onChange('reasoning', value === 'off' ? null : (value as ReasoningLevel));
  };

  // Auto-prefill CORS middleware URL when CORS error is detected and field is empty
  useEffect(() => {
    if (
      testResult &&
      !testResult.success &&
      testResult.error?.startsWith('CORS Error') &&
      !config.corsMiddleware?.trim()
    ) {
      if (!corsErrorDetected.current) {
        corsErrorDetected.current = true;
        onChange('corsMiddleware', 'http://localhost:8010/proxy');
      }
    }
    if (!testResult || testResult.success) {
      corsErrorDetected.current = false;
    }
  }, [testResult]);

  return (
    <div className="space-y-4">
      {/* Copy Settings Button */}
      {onCopySettings && (
        <Button onClick={onCopySettings} variant="default" className="w-full">
          📋 <Text id="llm.copySettings">Copy to other stages</Text>
        </Button>
      )}

      {/* Connection fields: API Key / URL / Model */}
      {textFieldSpecs.map((f) => (
        <div className="space-y-1" key={f.id}>
          <label className="input-label" htmlFor={f.id}>
            <Text id={f.labelId}>{f.label}</Text>
          </label>
          <input
            id={f.id}
            type={f.type}
            className="input-field"
            value={config[f.field]}
            onInput={(e) => onChange(f.field, (e.target as HTMLInputElement).value)}
            placeholder={f.placeholder}
          />
        </div>
      ))}

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
        {/* Max Retries — p-retry semantics: attempts AFTER the first, so 0 = one call.
            Merge doesn't retry at all; there the value sizes the replacement-temperature
            budget for the vote pool (see LLMVoiceService.mergeCharactersWithLLM). */}
        <div className="space-y-1">
          <label className="input-label" htmlFor="max-retries-input">
            {isMerge ? (
              <Text id="llm.mergeAttempts">Extra Vote Attempts</Text>
            ) : (
              <Text id="llm.maxRetries">Max Retries</Text>
            )}
          </label>
          <input
            id="max-retries-input"
            type="number"
            className="input-field"
            min={0}
            max={50}
            step={1}
            value={config.maxRetries}
            onInput={(e) => {
              const n = Number((e.target as HTMLInputElement).value);
              onChange('maxRetries', Number.isFinite(n) ? Math.max(0, Math.min(50, n)) : 0);
            }}
          />
          <p className="text-xs text-gray-400">
            {isMerge ? (
              <Text id="llm.mergeAttemptsHint">
                Merge always collects 5 votes. This buys replacement attempts for failed votes:
                budget = 5 x (1 + value). 0 = no replacements.
              </Text>
            ) : (
              <Text id="llm.maxRetriesHint">
                Attempts after the first. 0 = one try, then the backup model takes over.
              </Text>
            )}
          </p>
        </div>

        {/* CORS Proxy */}
        <div className="space-y-1">
          <label className="input-label" htmlFor="cors-proxy-input">
            CORS Proxy
          </label>
          <input
            id="cors-proxy-input"
            type="text"
            className="input-field"
            value={config.corsMiddleware}
            onInput={(e) => onChange('corsMiddleware', (e.target as HTMLInputElement).value)}
            placeholder="http://localhost:8010/proxy"
          />
          <CORSProxyHelp apiUrl={config.apiUrl} />
        </div>

        {/* QA Pass - only for Assign stage */}
        {showVoting && onVotingChange && (
          <Toggle
            checked={useVoting ?? false}
            onChange={onVotingChange}
            label="Enable QA Pass"
            title="Runs a QA pass to catch vocative traps, missed action beats, and narration errors (2x API cost)"
            disabled={isReasoningEnabled}
          />
        )}

        {/* Hint about reasoning mode */}
        {isReasoningEnabled && (
          <p className="text-xs text-yellow-500">
            <Text id="llm.reasoningDisablesParams">
              Temperature and Top-P are disabled when reasoning mode is enabled
            </Text>
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
          <Callout tone={testResult.success ? 'success' : 'error'}>
            {testResult.success ? (
              <>
                <Text id="llm.connectionSuccess">Connection successful!</Text>
                {testResult.model && (
                  <span className="text-gray-400 ml-1">({testResult.model})</span>
                )}
              </>
            ) : (
              <>
                {testResult.error}
                {testResult.error?.startsWith('CORS Error') && (
                  <CORSInlineHelp apiUrl={config.apiUrl} />
                )}
              </>
            )}
          </Callout>
        )}
      </div>
    </div>
  );
}

/**
 * Shared local-cors-proxy setup steps. Plain variant renders inside the collapsible
 * help panel; `inline` renders the tightened list inside the CORS error box.
 */
function CORSSetupSteps({ apiUrl, inline }: { apiUrl?: string; inline?: boolean }) {
  const proxyUrl = apiUrl?.trim() || 'https://your-api.com';
  const codeCls = `block bg-primary/50 px-1 py-0.5 rounded text-accent ${inline ? 'mt-0.5' : 'mt-1'}`;

  return (
    <>
      <div>
        <p className={inline ? undefined : 'text-gray-300 font-medium'}>
          {inline ? '1.' : 'Step 1 -'} Install Node.js (skip if installed):
        </p>
        <code className={codeCls}>winget install OpenJS.NodeJS.LTS</code>
        {!inline && <p className="mt-1">Then restart PowerShell.</p>}
      </div>
      <div>
        <p className={inline ? undefined : 'text-gray-300 font-medium'}>
          {inline ? '2.' : 'Step 2 -'} Run proxy:
        </p>
        <code className={`${codeCls} break-all`}>
          npx local-cors-proxy --proxyUrl {proxyUrl} --port 8010
        </code>
      </div>
      <p>
        {inline ? '3. Set' : 'Then set'} CORS Proxy to:{' '}
        <code className="bg-primary/50 px-1 rounded text-accent">http://localhost:8010/proxy</code>
      </p>
      <details className={inline ? undefined : 'mt-2'}>
        <summary className="cursor-pointer text-gray-400 hover:text-gray-300 select-none">
          Show diagram
        </summary>
        <img
          src="./cors-diagram.png"
          alt="CORS proxy flow"
          className={
            inline
              ? 'mt-1 rounded border border-red-500/20 max-w-full'
              : 'mt-2 rounded border border-gray-700 max-w-full'
          }
        />
      </details>
    </>
  );
}

function CORSProxyHelp({ apiUrl }: { apiUrl?: string } = {}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-gray-400 hover:text-gray-300 underline"
      >
        {expanded ? 'Hide setup instructions' : 'Show setup instructions'}
      </button>
      {expanded && (
        <div className="mt-2 p-2 bg-primary/20 rounded text-xs text-gray-400 space-y-2">
          <p>Some API providers block browser requests (no CORS headers). Use a local proxy:</p>
          <CORSSetupSteps apiUrl={apiUrl} />
        </div>
      )}
    </div>
  );
}

function CORSInlineHelp({ apiUrl }: { apiUrl: string }) {
  return (
    <div className="mt-2 p-2 bg-red-500/10 rounded text-xs text-gray-300 space-y-1 border border-red-500/20">
      <p className="font-medium text-red-300">How to fix:</p>
      <CORSSetupSteps apiUrl={apiUrl} inline />
    </div>
  );
}
