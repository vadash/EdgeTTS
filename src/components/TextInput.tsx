import { useText } from 'preact-i18n';
import { textContent } from '../state/appState';

export function TextInput() {
  const { placeholder } = useText({ placeholder: 'text.placeholder' });

  return (
    <textarea
      class="text-input"
      id="text-area"
      placeholder={placeholder}
      value={textContent.value}
      onInput={(e) => textContent.value = (e.target as HTMLTextAreaElement).value}
      style={{
        flex: 1,
        width: '100%',
        minHeight: '200px',
      }}
    />
  );
}
