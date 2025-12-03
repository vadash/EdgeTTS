import { useRef } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { useData, useLogs } from '../../stores';

export function DictionaryUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const dataStore = useData();
  const logs = useLogs();

  const handleFileChange = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      dataStore.setDictionaryRaw(lines);
      logs.info(`Dictionary loaded: ${lines.length} rules`);
    } catch (err) {
      logs.error(`Error loading dictionary: ${err}`);
    }

    input.value = '';
  };

  const ruleCount = dataStore.dictionaryRaw.value.length;

  return (
    <label class="file-handler-label" aria-label="Upload dictionary file">
      <span class="file-handler-title">
        <Text id="files.dictionary">Dictionary</Text>
        {ruleCount > 0 && (
          <span class="file-handler-count"> ({ruleCount})</span>
        )}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept=".lexx,.txt"
        onChange={handleFileChange}
        aria-label="Select dictionary file"
      />
      <button
        onClick={() => inputRef.current?.click()}
        class="w-full"
        aria-label="Open dictionary picker"
      >
        📖
      </button>
    </label>
  );
}
