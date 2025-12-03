import { useState } from 'preact/hooks';
import { Text } from 'preact-i18n';
import {
  llmApiKey,
  llmApiUrl,
  llmModel,
} from '../../state/appState';
import { LLMVoiceService } from '../../services/LLMVoiceService';

export function LLMSettingsPanel() {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  const handleTestConnection = async () => {
    if (!llmApiKey.value) {
      setTestResult({ success: false, error: 'API key is required' });
      return;
    }

    setTesting(true);
    setTestResult(null);

    const service = new LLMVoiceService({
      apiKey: llmApiKey.value,
      apiUrl: llmApiUrl.value,
      model: llmModel.value,
      narratorVoice: '',
    });

    const result = await service.testConnection();
    setTestResult(result);
    setTesting(false);
  };

  return (
    <div class="llm-settings-panel">
      <div
        class="section-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '1rem',
          paddingBottom: '0.5rem',
          borderBottom: '1px solid var(--border-color, #444)',
        }}
      >
        <span style={{ fontSize: '1.1rem' }}>🤖</span>
        <span style={{ fontWeight: 'bold' }}><Text id="llm.title">LLM Voice Assignment</Text></span>
      </div>

      <div class="llm-settings-fields" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div class="field">
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
            <Text id="llm.apiKey">API Key</Text>
          </label>
          <input
            type="password"
            value={llmApiKey.value}
            onInput={(e) => {
              llmApiKey.value = (e.target as HTMLInputElement).value;
            }}
            placeholder="Api key will be encrypted in browser local storage"
            style={{
              width: '100%',
              padding: '0.5rem',
              borderRadius: '4px',
              border: '1px solid var(--border-color, #444)',
              background: 'var(--input-bg, #222)',
              color: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div class="field">
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
            <Text id="llm.apiUrl">API URL</Text>
          </label>
          <input
            type="text"
            value={llmApiUrl.value}
            onInput={(e) => {
              llmApiUrl.value = (e.target as HTMLInputElement).value;
            }}
            placeholder="https://enter.api.url.here.open.ai.compatible/v1"
            style={{
              width: '100%',
              padding: '0.5rem',
              borderRadius: '4px',
              border: '1px solid var(--border-color, #444)',
              background: 'var(--input-bg, #222)',
              color: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div class="field">
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
            <Text id="llm.model">Model</Text>
          </label>
          <input
            type="text"
            value={llmModel.value}
            onInput={(e) => {
              llmModel.value = (e.target as HTMLInputElement).value;
            }}
            placeholder="your-model-name"
            style={{
              width: '100%',
              padding: '0.5rem',
              borderRadius: '4px',
              border: '1px solid var(--border-color, #444)',
              background: 'var(--input-bg, #222)',
              color: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <button
          onClick={handleTestConnection}
          disabled={testing || !llmApiKey.value}
          style={{ width: '100%', marginTop: '0.5rem' }}
        >
          {testing ? <><Text id="llm.testing">Testing...</Text></> : <>🔌 <Text id="llm.testConnection">Test Connection</Text></>}
        </button>

        {testResult && (
          <div
            style={{
              padding: '0.5rem',
              borderRadius: '4px',
              background: testResult.success
                ? 'rgba(0, 200, 0, 0.2)'
                : 'rgba(200, 0, 0, 0.2)',
              border: `1px solid ${testResult.success ? 'green' : 'red'}`,
              fontSize: '0.9rem',
            }}
          >
            {testResult.success ? <>✅ <Text id="llm.connectionSuccess">Connection successful!</Text></> : `❌ ${testResult.error}`}
          </div>
        )}
      </div>
    </div>
  );
}
