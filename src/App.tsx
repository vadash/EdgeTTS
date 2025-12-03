import { useEffect } from 'preact/hooks';
import { loadSettings } from './state/appState';
import { TextInput } from './components/TextInput';
import { VoiceSelector } from './components/VoiceSelector/VoiceSelector';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { FileUpload } from './components/FileHandlers/FileUpload';
import { DictionaryUpload } from './components/FileHandlers/DictionaryUpload';
import { StatusArea } from './components/StatusArea';
import { ConvertButton } from './components/ConvertButton';

export function App() {
  useEffect(() => {
    void loadSettings();
  }, []);

  return (
    <div class="app">
      <aside class="sidebar">
        <VoiceSelector />

        <SettingsPanel />

        <div class="file-handlers">
          <DictionaryUpload />
          <FileUpload />
        </div>

        <ConvertButton />
      </aside>

      <main class="main-content">
        <TextInput />
      </main>

      <StatusArea />
    </div>
  );
}
