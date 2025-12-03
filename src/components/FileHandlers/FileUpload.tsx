import { useRef } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { useData, useLogs } from '../../stores';
import { convertFileToTxt } from '../../services/FileConverter';

export function FileUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const dataStore = useData();
  const logs = useLogs();

  const handleFileChange = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    try {
      for (const file of Array.from(files)) {
        const converted = await convertFileToTxt(file);

        for (const { filename, content } of converted) {
          const currentText = dataStore.textContent.value;
          dataStore.setTextContent(currentText + (currentText ? '\n\n' : '') + content);
        }

        if (converted.length === 1) {
          logs.info(`Loaded: ${file.name}`);
        } else {
          logs.info(`Loaded: ${file.name} (${converted.length} files)`);
        }
      }
      dataStore.bookLoaded.value = true;
    } catch (err) {
      logs.error(`Error loading file: ${(err as Error).message}`);
    }

    input.value = '';
  };

  return (
    <label class="file-handler-label" aria-label="Upload text file">
      <span class="file-handler-title">
        <Text id="files.upload">File</Text>
      </span>
      <input
        ref={inputRef}
        type="file"
        accept=".txt,.fb2,.epub,.ini,.zip"
        multiple
        onChange={handleFileChange}
        aria-label="Select text file to upload"
      />
      <button
        onClick={() => inputRef.current?.click()}
        class="w-full"
        aria-label="Open file picker"
      >
        📄
      </button>
    </label>
  );
}
