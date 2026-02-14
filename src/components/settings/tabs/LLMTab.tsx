import { useState } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { useLLM } from '@/stores';
import { useLogger } from '@/di/ServiceContext';
import { LLMVoiceService } from '@/services/llm';
import { Toggle, Tabs, TabPanel, Button } from '@/components/common';
import { LLMHelp } from './LLMHelp';
import { StageConfigForm, type TestResult } from './StageConfigForm';
import type { LLMStage, StageConfig } from '@/stores/LLMStore';

const stageTabs = [
  { id: 'extract', label: 'Extract', icon: '1️⃣' },
  { id: 'merge', label: 'Merge', icon: '2️⃣' },
  { id: 'assign', label: 'Assign', icon: '3️⃣' },
];

type TestState = Record<LLMStage, {
  testing: boolean;
  result: TestResult | null;
}>;

const initialTestState: TestState = {
  extract: { testing: false, result: null },
  merge: { testing: false, result: null },
  assign: { testing: false, result: null },
};

export function LLMTab() {
  const llm = useLLM();
  const logger = useLogger();
  const [testState, setTestState] = useState<TestState>(initialTestState);

  const handleTestConnection = async (stage: LLMStage, useStreaming: boolean) => {
    const config = llm[stage].value;
    if (!config.apiKey) {
      setTestState(prev => ({
        ...prev,
        [stage]: { ...prev[stage], result: { success: false, error: 'API key is required' } }
      }));
      return;
    }

    setTestState(prev => ({
      ...prev,
      [stage]: { ...prev[stage], testing: true, result: null }
    }));

    const service = new LLMVoiceService({
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      model: config.model,
      narratorVoice: '',
      logger,
    });

    const result = useStreaming
      ? await service.testConnectionStreaming()
      : await service.testConnection();

    setTestState(prev => ({
      ...prev,
      [stage]: { ...prev[stage], testing: false, result }
    }));

    // Auto-save on success
    if (result.success) {
      await llm.saveSettings();
    }
  };

  const handleStageFieldChange = <K extends keyof StageConfig>(
    stage: LLMStage,
    field: K,
    value: StageConfig[K]
  ) => {
    llm.setStageField(stage, field, value);
  };

  const handleCopySettings = (sourceStage: LLMStage) => {
    const sourceConfig = llm[sourceStage].value;
    const targetStages: LLMStage[] = ['extract', 'merge', 'assign'].filter(s => s !== sourceStage);

    for (const target of targetStages) {
      llm.setStageField(target, 'apiKey', sourceConfig.apiKey);
      llm.setStageField(target, 'apiUrl', sourceConfig.apiUrl);
      llm.setStageField(target, 'model', sourceConfig.model);
      llm.setStageField(target, 'temperature', sourceConfig.temperature);
      llm.setStageField(target, 'topP', sourceConfig.topP);
    }
  };

  const renderStageForm = (stage: LLMStage) => {
    const stageState = testState[stage];
    return (
      <StageConfigForm
        config={llm[stage].value}
        onChange={(field, value) => handleStageFieldChange(stage, field, value)}
        showVoting={stage === 'assign'}
        useVoting={stage === 'assign' ? llm.useVoting.value : undefined}
        onVotingChange={stage === 'assign' ? (v) => llm.setUseVoting(v) : undefined}
        onTestConnection={(useStreaming) => handleTestConnection(stage, useStreaming)}
        testing={stageState.testing}
        testResult={stageState.result}
        onCopySettings={() => handleCopySettings(stage)}
      />
    );
  };

  return (
    <div className="space-y-6">
      {/* Header with Master Toggle */}
      <div className="flex items-center justify-between">
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
        <Toggle
          checked={llm.enabled.value}
          onChange={(v) => llm.setEnabled(v)}
        />
      </div>

      {/* Stage description */}
      <div className="text-sm text-gray-400 space-y-1">
        <p><strong>Extract:</strong> <Text id="llm.extractDesc">Detects characters from text</Text></p>
        <p><strong>Merge:</strong> <Text id="llm.mergeDesc">Deduplicates detected characters</Text></p>
        <p><strong>Assign:</strong> <Text id="llm.assignDesc">Assigns speakers to sentences</Text></p>
      </div>

      {/* Stage Tabs */}
      <Tabs tabs={stageTabs} defaultTab="extract">
        {(activeTab) => (
          <>
            <TabPanel id="extract" activeTab={activeTab}>
              {renderStageForm('extract')}
            </TabPanel>
            <TabPanel id="merge" activeTab={activeTab}>
              {renderStageForm('merge')}
            </TabPanel>
            <TabPanel id="assign" activeTab={activeTab}>
              {renderStageForm('assign')}
            </TabPanel>
          </>
        )}
      </Tabs>

      {/* Save Button */}
      <Button variant="primary" onClick={() => llm.saveSettings()} className="w-full">
        💾 <Text id="settings.save">Save Settings</Text>
      </Button>

      {/* Help section */}
      <LLMHelp />
    </div>
  );
}
