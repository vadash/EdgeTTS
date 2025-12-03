import { TextInput } from './components/TextInput';
import { VoiceSelector } from './components/VoiceSelector/VoiceSelector';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { LanguageSelector } from './components/Settings/LanguageSelector';
import { FileUpload } from './components/FileHandlers/FileUpload';
import { DictionaryUpload } from './components/FileHandlers/DictionaryUpload';
import { StatusArea } from './components/StatusArea';
import { ConvertButton } from './components/ConvertButton';

export function App() {
  return (
    <div class="app">
      <aside class="sidebar">
        <div class="top-row">
          <VoiceSelector />
          <LanguageSelector />
        </div>

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
