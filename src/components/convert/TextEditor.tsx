import { useText } from 'preact-i18n';
import { useData } from '@/stores';

export function TextEditor() {
  const { placeholder } = useText({ placeholder: 'text.placeholder' });
  const dataStore = useData();

  return (
    <textarea
      className="w-full h-full min-h-[200px] p-4 bg-primary-secondary border border-border rounded-lg
                 text-white placeholder:text-gray-500 resize-none
                 focus:outline-none focus:border-accent focus:shadow-[0_0_0_2px_rgba(13,110,253,0.3)]
                 transition-all"
      placeholder={placeholder}
      value={dataStore.textContent.value}
      onInput={(e) => dataStore.setTextContent((e.target as HTMLTextAreaElement).value)}
      aria-label="Text content for conversion"
    />
  );
}
