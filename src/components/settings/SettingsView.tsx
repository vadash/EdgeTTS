import { Text } from 'preact-i18n';
import { Tabs, TabPanel } from '@/components/common';
import { GeneralTab } from './tabs/GeneralTab';
import { VoicePoolTab } from './tabs/VoicePoolTab';
import { LLMTab } from './tabs/LLMTab';
import { AudioTab } from './tabs/AudioTab';
import { DictionaryTab } from './tabs/DictionaryTab';
import { ExportImportTab } from './tabs/ExportImportTab';

const tabs = [
  { id: 'general', label: 'General', icon: '⚙️' },
  { id: 'voices', label: 'Voices', icon: '🎤' },
  { id: 'llm', label: 'LLM', icon: '🤖' },
  { id: 'audio', label: 'Audio', icon: '🔊' },
  { id: 'dictionary', label: 'Dictionary', icon: '📖' },
  { id: 'export', label: 'Export/Import', icon: '📦' },
];

export function SettingsView() {
  return (
    <div className="flex-1 flex flex-col p-4 min-h-0">
      <div className="flex-1 bg-primary-secondary rounded-lg border border-border overflow-hidden">
        <Tabs tabs={tabs} defaultTab="general">
          {(activeTab) => (
            <>
              <TabPanel id="general" activeTab={activeTab}>
                <GeneralTab />
              </TabPanel>
              <TabPanel id="voices" activeTab={activeTab}>
                <VoicePoolTab />
              </TabPanel>
              <TabPanel id="llm" activeTab={activeTab}>
                <LLMTab />
              </TabPanel>
              <TabPanel id="audio" activeTab={activeTab}>
                <AudioTab />
              </TabPanel>
              <TabPanel id="dictionary" activeTab={activeTab}>
                <DictionaryTab />
              </TabPanel>
              <TabPanel id="export" activeTab={activeTab}>
                <ExportImportTab />
              </TabPanel>
            </>
          )}
        </Tabs>
      </div>
    </div>
  );
}
