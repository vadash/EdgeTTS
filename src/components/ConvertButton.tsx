import { Text } from 'preact-i18n';
import { useData, useConversion } from '../stores';
import { useTTSConversion } from '../hooks/useTTSConversion';

export function ConvertButton() {
  const dataStore = useData();
  const conversionStore = useConversion();
  const { startConversion, selectDirectory } = useTTSConversion();

  const handleClick = async () => {
    if (!dataStore.textContent.value.trim()) {
      return;
    }

    // Try to select directory first
    const canProceed = await selectDirectory();
    if (!canProceed) return;

    // Start conversion
    await startConversion(dataStore.textContent.value, dataStore.book.value);
  };

  const isProcessing = conversionStore.isProcessing.value;

  return (
    <button
      class="convert-btn"
      onClick={handleClick}
      disabled={isProcessing}
      aria-label={isProcessing ? 'Converting text to speech' : 'Start text to speech conversion'}
      aria-busy={isProcessing}
    >
      {isProcessing ? (
        <Text id="status.processing">Processing...</Text>
      ) : (
        <Text id="convert.button">Save to MP3</Text>
      )}
    </button>
  );
}
