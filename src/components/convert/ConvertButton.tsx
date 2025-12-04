import { Text } from 'preact-i18n';
import { useData, useConversion } from '@/stores';
import { useTTSConversion } from '@/hooks/useTTSConversion';
import { Button } from '@/components/common';

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
    <Button
      variant="primary"
      onClick={handleClick}
      disabled={isProcessing || !dataStore.textContent.value.trim()}
      className="w-full py-3 text-base"
      aria-label={isProcessing ? 'Converting text to speech' : 'Start text to speech conversion'}
      aria-busy={isProcessing}
    >
      {isProcessing ? (
        <>
          <span className="animate-spin">⏳</span>
          <Text id="status.processing">Processing...</Text>
        </>
      ) : (
        <>
          <span>🎵</span>
          <Text id="convert.button">Save to MP3</Text>
        </>
      )}
    </Button>
  );
}
