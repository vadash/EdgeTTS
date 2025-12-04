import { useRef } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { useData, useSettings, useLogs } from '@/stores';
import { Button, Toggle } from '@/components/common';

export function DictionaryTab() {
  const dataStore = useData();
  const settings = useSettings();
  const logs = useLogs();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const rules = dataStore.dictionaryRaw.value;

  const handleFileChange = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const newRules = text.split('\n').filter(line => line.trim() && !line.startsWith('#'));
      dataStore.setDictionaryRaw(newRules);
      logs.info(`Loaded dictionary: ${file.name} (${newRules.length} rules)`);
    } catch (err) {
      logs.error(`Error loading dictionary: ${(err as Error).message}`);
    }

    input.value = '';
  };

  const handleClear = () => {
    dataStore.clearDictionary();
    logs.info('Dictionary cleared');
  };

  const handleExport = () => {
    if (rules.length === 0) return;

    const text = rules.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dictionary.lexx';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-2xl">📖</span>
        <div>
          <h3 className="font-semibold">
            <Text id="settings.dictionary">Dictionary</Text>
          </h3>
          <p className="text-sm text-gray-400">
            <Text id="settings.dictionaryHint">Word replacements for TTS pronunciation</Text>
          </p>
        </div>
      </div>

      {/* Upload */}
      <div className="flex gap-2">
        <Button onClick={() => fileInputRef.current?.click()} className="flex-1">
          📄 <Text id="files.upload">Upload .lexx file</Text>
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".lexx,.txt"
          onChange={handleFileChange}
          className="hidden"
        />
        {rules.length > 0 && (
          <>
            <Button onClick={handleExport}>
              💾 <Text id="settings.export">Export</Text>
            </Button>
            <Button onClick={handleClear}>
              🗑️
            </Button>
          </>
        )}
      </div>

      {/* Case Sensitivity */}
      <div className="flex items-center justify-between p-4 bg-primary rounded-lg border border-border">
        <div>
          <div className="font-medium">
            <Text id="settings.dictionary.caseSensitive">Case Sensitive</Text>
          </div>
          <div className="text-sm text-gray-400">
            <Text id="settings.dictionary.caseSensitiveHint">Match exact letter case</Text>
          </div>
        </div>
        <Toggle
          checked={settings.lexxRegister.value}
          onChange={(v) => settings.setLexxRegister(v)}
        />
      </div>

      {/* Rules List */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="input-label">
            <Text id="settings.rules">Rules</Text> ({rules.length})
          </span>
        </div>
        {rules.length > 0 ? (
          <div className="bg-primary rounded-lg border border-border p-3 max-h-[300px] overflow-y-auto">
            <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
              {rules.slice(0, 100).join('\n')}
              {rules.length > 100 && `\n... and ${rules.length - 100} more rules`}
            </pre>
          </div>
        ) : (
          <div className="text-center text-gray-500 p-8 bg-primary rounded-lg border border-dashed border-border">
            <Text id="settings.noRules">No dictionary rules loaded</Text>
          </div>
        )}
      </div>

      {/* Format Help */}
      <details className="text-sm">
        <summary className="cursor-pointer text-gray-400 hover:text-white">
          <Text id="settings.dictionaryFormatHelp">Dictionary format help</Text>
        </summary>
        <div className="mt-2 p-3 bg-primary rounded-lg border border-border text-gray-400">
          <code className="block">word=replacement</code>
          <code className="block">"exact"="replacement"</code>
          <code className="block">regex"pattern"="replace"</code>
        </div>
      </details>
    </div>
  );
}
