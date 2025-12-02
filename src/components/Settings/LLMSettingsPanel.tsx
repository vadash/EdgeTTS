import { useState } from 'preact/hooks';
import {
  llmEnabled,
  llmApiKey,
  llmApiUrl,
  llmModel,
  saveLLMSettings,
} from '../../state/appState';
import { LLMVoiceService } from '../../services/LLMVoiceService';

export function LLMSettingsPanel() {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

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

  const handleSave = () => {
    saveLLMSettings();
    setTestResult(null);
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
        <span style={{ fontWeight: 'bold' }}>LLM Voice Assignment</span>
      </div>

      <label class="toggle-wrapper" style={{ marginBottom: '1rem' }}>
        <span>Enable LLM Mode</span>
        <input
          type="checkbox"
          class="toggle"
          checked={llmEnabled.value}
          onChange={(e) => {
            llmEnabled.value = (e.target as HTMLInputElement).checked;
          }}
        />
      </label>

      {llmEnabled.value && (
        <div class="llm-settings-fields" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div class="field">
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
              API Key
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type={showApiKey ? 'text' : 'password'}
                value={llmApiKey.value}
                onInput={(e) => {
                  llmApiKey.value = (e.target as HTMLInputElement).value;
                }}
                placeholder="sk-..."
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color, #444)',
                  background: 'var(--input-bg, #222)',
                  color: 'inherit',
                }}
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                style={{ padding: '0.5rem', minWidth: '40px' }}
                title={showApiKey ? 'Hide' : 'Show'}
              >
                {showApiKey ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <div class="field">
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
              API URL
            </label>
            <input
              type="text"
              value={llmApiUrl.value}
              onInput={(e) => {
                llmApiUrl.value = (e.target as HTMLInputElement).value;
              }}
              placeholder="https://api.openai.com/v1"
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
              Model
            </label>
            <input
              type="text"
              value={llmModel.value}
              onInput={(e) => {
                llmModel.value = (e.target as HTMLInputElement).value;
              }}
              placeholder="gpt-4o-mini"
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

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              onClick={handleTestConnection}
              disabled={testing || !llmApiKey.value}
              style={{ flex: 1 }}
            >
              {testing ? '⏳ Testing...' : '🔌 Test Connection'}
            </button>
            <button onClick={handleSave} style={{ flex: 1 }}>
              💾 Save
            </button>
          </div>

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
              {testResult.success ? '✅ Connection successful!' : `❌ ${testResult.error}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
