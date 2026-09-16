import { useState } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { TabPanel, Tabs, Toggle } from '@/components/common';
import { getLogger } from '@/services';
import { testLlmConnection } from '@/services/llm';
import { useLLM } from '@/stores';
import { STAGE_COPY_FIELDS, type StageConfig } from '@/state/types';
import type { LLMStage } from '@/stores/LLMStore';
import { LLMHelp } from './LLMHelp';
import { StageConfigForm, type TestResult } from './StageConfigForm';

interface StageInfo {
  id: LLMStage;
  label: string;
  icon: string;
  descId: string;
  desc: string;
  repeatPrompt?: boolean;
}

const stages: StageInfo[] = [
  {
    id: 'extract',
    label: 'Extract',
    icon: '1️⃣',
    descId: 'llm.extractDesc',
    desc: 'Detects characters from text',
    repeatPrompt: true,
  },
  {
    id: 'merge',
    label: 'Merge',
    icon: '2️⃣',
    descId: 'llm.mergeDesc',
    desc: 'Deduplicates detected characters',
    repeatPrompt: true,
  },
  {
    id: 'assign',
    label: 'Assign',
    icon: '3️⃣',
    descId: 'llm.assignDesc',
    desc: 'Assigns speakers to sentences',
    repeatPrompt: true,
  },
  {
    id: 'backup',
    label: 'Backup',
    icon: '4️⃣',
    descId: 'llm.backupDesc',
    desc: 'Used when any stage model exhausts its max retries',
  },
];

type TestState = Record<
  LLMStage,
  {
    testing: boolean;
    result: TestResult | null;
  }
>;

const initialTestState: TestState = {
  extract: { testing: false, result: null },
  merge: { testing: false, result: null },
  assign: { testing: false, result: null },
  backup: { testing: false, result: null },
};

export function LLMTab() {
  const llm = useLLM();
  const logger = getLogger();
  const [testState, setTestState] = useState<TestState>(initialTestState);

  const handleTestConnection = async (stage: LLMStage, useStreaming: boolean) => {
    const config = llm[stage].value;
    if (!config.apiKey) {
      setTestState((prev) => ({
        ...prev,
        [stage]: {
          ...prev[stage],
          result: { success: false, error: 'API key is required' },
        },
      }));
      return;
    }

    setTestState((prev) => ({
      ...prev,
      [stage]: { ...prev[stage], testing: true, result: null },
    }));

    const result = await testLlmConnection({ config, logger }, useStreaming);

    setTestState((prev) => ({
      ...prev,
      [stage]: { ...prev[stage], testing: false, result },
    }));
  };

  const handleStageFieldChange = <K extends keyof StageConfig>(
    stage: LLMStage,
    field: K,
    value: StageConfig[K],
  ) => {
    llm.setStageField(stage, field, value);
  };

  const handleCopySettings = (sourceStage: LLMStage) => {
    const sourceConfig = llm[sourceStage].value;
    const targetStages = stages.map((s) => s.id).filter((s) => s !== sourceStage);

    for (const target of targetStages) {
      for (const field of STAGE_COPY_FIELDS) {
        llm.setStageField(target, field, sourceConfig[field]);
      }
    }
  };

  const renderStageForm = (stage: LLMStage) => {
    const stageState = testState[stage];
    return (
      <StageConfigForm
        config={llm[stage].value}
        onChange={(field, value) => handleStageFieldChange(stage, field, value)}
        isMerge={stage === 'merge'}
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

      {/* Stage description */}
      <div className="text-sm text-gray-400 space-y-1">
        {stages.map((s) => (
          <p key={s.id}>
            <strong>{s.label}:</strong> <Text id={s.descId}>{s.desc}</Text>
          </p>
        ))}
      </div>

      {/* Help section - Free API Options */}
      <LLMHelp />

      {/* Prompt Repetition Section */}
      <div className="space-y-3 pt-4 border-t border-gray-700">
        <div>
          <h4 className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <span>🔄</span>
            <Text id="llm.promptRepetition">Prompt Repetition</Text>
          </h4>
          <p className="text-xs text-gray-400 mt-1">
            <Text id="llm.promptRepetitionDesc">
              Duplicates user prompt for improved LLM accuracy. Adds ~20-30% processing time.
            </Text>
          </p>
        </div>

        {/* Per-stage toggles */}
        <div className="grid grid-cols-3 gap-3">
          {stages
            .filter((s) => s.repeatPrompt)
            .map((s) => (
              <Toggle
                key={s.id}
                checked={llm[s.id].value.repeatPrompt}
                onChange={(v) => handleStageFieldChange(s.id, 'repeatPrompt', v)}
                label={s.label}
              />
            ))}
        </div>
      </div>

      {/* Stage Tabs */}
      <Tabs tabs={stages} defaultTab="extract">
        {(activeTab) => (
          <>
            {stages.map((s) => (
              <TabPanel key={s.id} id={s.id} activeTab={activeTab}>
                {renderStageForm(s.id)}
              </TabPanel>
            ))}
          </>
        )}
      </Tabs>
    </div>
  );
}
