import { useState } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { useLLM } from '../../stores';
import { LLMVoiceService } from '../../services/LLMVoiceService';

export function LLMSettingsPanel() {
  const llm = useLLM();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

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
    });

    const result = await service.testConnection();
    setTestResult(result);
    setTesting(false);
  };

  return (
    <div class="llm-settings-panel">
      <div class="section-header">
        <span class="section-header-icon">🤖</span>
        <span class="section-header-title"><Text id="llm.title">LLM Voice Assignment</Text></span>
      </div>

      <div class="llm-settings-fields">
        <div class="field">
          <label class="field-label">
            <Text id="llm.apiKey">API Key</Text>
          </label>
          <input
            type="password"
            class="input-field"
            value={llm.apiKey.value}
            onInput={(e) => {
              llm.setApiKey((e.target as HTMLInputElement).value);
            }}
            placeholder="Api key will be encrypted in browser local storage"
          />
        </div>

        <div class="field">
          <label class="field-label">
            <Text id="llm.apiUrl">API URL</Text>
          </label>
          <input
            type="text"
            class="input-field"
            value={llm.apiUrl.value}
            onInput={(e) => {
              llm.setApiUrl((e.target as HTMLInputElement).value);
            }}
            placeholder="https://enter.api.url.here.open.ai.compatible/v1"
          />
        </div>

        <div class="field">
          <label class="field-label">
            <Text id="llm.model">Model</Text>
          </label>
          <input
            type="text"
            class="input-field"
            value={llm.model.value}
            onInput={(e) => {
              llm.setModel((e.target as HTMLInputElement).value);
            }}
            placeholder="your-model-name"
          />
        </div>

        <button
          onClick={handleTestConnection}
          disabled={testing || !llm.apiKey.value}
          class="w-full mt-1"
        >
          {testing ? <><Text id="llm.testing">Testing...</Text></> : <>🔌 <Text id="llm.testConnection">Test Connection</Text></>}
        </button>

        {testResult && (
          <div class={testResult.success ? 'success-message' : 'error-message'}>
            {testResult.success ? <>✅ <Text id="llm.connectionSuccess">Connection successful!</Text></> : `❌ ${testResult.error}`}
          </div>
        )}
      </div>
    </div>
  );
}
