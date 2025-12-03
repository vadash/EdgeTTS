import { useText } from 'preact-i18n';
import { useData } from '../stores';

export function TextInput() {
  const { placeholder } = useText({ placeholder: 'text.placeholder' });
  const dataStore = useData();

  return (
    <textarea
      class="text-input"
      id="text-area"
      placeholder={placeholder}
      value={dataStore.textContent.value}
      onInput={(e) => dataStore.setTextContent((e.target as HTMLTextAreaElement).value)}
      aria-label="Text content for conversion"
    />
  );
}
