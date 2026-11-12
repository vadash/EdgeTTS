import { useState } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { Button, Callout } from '@/components/common';
import { getLogger } from '@/services';
import { testLlmConnection } from '@/services/llm';
import { parsePoolTextarea, PoolParseError, type PoolEntry } from '@/services/llm/pool';
import type { StageConfig } from '@/state/types';
import { useLLM } from '@/stores';
import type { TestResult } from './StageConfigForm';

interface EntryTestState {
  testing: boolean;
  result: TestResult | null;
}

const exampleLine =
  '{"url":"https://api.example.com/v1","key":"sk-...","name":"slot-1","model":"gpt-4o-mini"}';

export function PoolTab() {
  const llm = useLLM();
  const logger = getLogger();
  const [tests, setTests] = useState<Record<number, EntryTestState>>({});
  const [testingAll, setTestingAll] = useState(false);
  const raw = llm.poolRaw.value;

  let entries: PoolEntry[] = [];
  let parseError: string | null = null;
  try {
    entries = parsePoolTextarea(raw);
  } catch (e) {
    parseError = e instanceof PoolParseError ? e.message : String(e);
  }

  // Per-entry test is advisory: it uses the entry's resolved model and never
  // blocks saving. Connection triple falls back to the Extract stage.
  const configFor = (entry: PoolEntry): StageConfig => {
    const base = llm.extract.value;
    const hasThinkingKey =
      entry.enable_thinking !== undefined ||
      entry.chat_template_kwargs !== undefined ||
      entry.reasoning_effort !== undefined;
    return {
      ...base,
      apiUrl: entry.url,
      apiKey: entry.key,
      model: entry.model ?? base.model,
      temperature: entry.temperature ?? base.temperature,
      // Entry thinking keys replace the stage reasoning toggle outright.
      reasoning: hasThinkingKey ? null : base.reasoning,
    };
  };

  const testEntry = async (index: number, entry: PoolEntry) => {
    setTests((prev) => ({ ...prev, [index]: { testing: true, result: null } }));
    const result = await testLlmConnection(
      { config: configFor(entry), logger },
      llm.extract.value.streaming,
    );
    setTests((prev) => ({ ...prev, [index]: { testing: false, result } }));
  };

  const testAll = async () => {
    setTestingAll(true);
    try {
      for (const [index, entry] of entries.entries()) {
        await testEntry(index, entry);
      }
    } finally {
      setTestingAll(false);
    }
  };

  const handleInput = (value: string) => {
    setTests({});
    llm.setPoolRaw(value);
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-gray-300">
          <Text id="llm.pool.title">Connection Pool</Text>
        </h4>
        <p className="text-xs text-gray-400 mt-1">
          <Text id="llm.pool.description">
            One JSON object per line: url and key are required; name, model, temperature, and
            thinking keys are optional. A non-empty pool replaces every stage's API URL, key, and
            model. Empty keeps per-stage settings.
          </Text>
        </p>
      </div>

      <textarea
        className="input-field font-mono text-xs min-h-[16rem]"
        rows={16}
        spellcheck={false}
        value={raw}
        placeholder={exampleLine}
        onInput={(e) => handleInput((e.target as HTMLTextAreaElement).value)}
      />

      {parseError ? (
        <Callout tone="error">{parseError}</Callout>
      ) : (
        <p className="text-xs text-gray-400">
          <Text id="llm.pool.slotCount" fields={{ count: entries.length }}>
            {'Pool entries: {{count}}'}
          </Text>
          {entries.length === 0 &&
            ' — empty pool keeps the per-stage API URL, key, and model behavior.'}
        </p>
      )}

      {entries.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={testAll} disabled={testingAll}>
              {testingAll ? (
                <Text id="llm.pool.testingAll">Testing all...</Text>
              ) : (
                <Text id="llm.pool.testAll">Test all</Text>
              )}
            </Button>
            <span className="text-xs text-gray-400">
              <Text id="llm.pool.testAdvisory">
                Tests are advisory only; failed entries still save.
              </Text>
            </span>
          </div>

          {entries.map((entry, index) => {
            const state = tests[index];
            return (
              <div
                key={index}
                className="flex items-center gap-3 p-2 border border-gray-700 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-300 truncate">
                    <span className="text-gray-500">#{index + 1}</span> {entry.name ?? entry.url}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {entry.model ?? llm.extract.value.model} · {entry.url}
                  </div>
                  {state?.result && !state.result.success && (
                    <div className="text-xs text-red-400">{state.result.error}</div>
                  )}
                  {state?.result?.success && (
                    <div className="text-xs text-green-400">
                      <Text id="llm.pool.testSuccess">Connection successful</Text>
                      {state.result.model ? ` (${state.result.model})` : ''}
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => testEntry(index, entry)}
                  disabled={state?.testing || testingAll}
                >
                  {state?.testing ? (
                    <Text id="llm.pool.testing">Testing...</Text>
                  ) : (
                    <Text id="llm.pool.test">Test</Text>
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
