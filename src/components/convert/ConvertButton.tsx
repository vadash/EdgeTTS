import { Text } from 'preact-i18n';
import { Button } from '@/components/common';
import { useTTSConversion } from '@/hooks/useTTSConversion';
import { clearTabBlocked, conversion, useConversion, useData } from '@/stores';

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
  const tabBlocked = conversion.value.tabBlocked;

  return (
    <div class="w-full">
      {tabBlocked && (
        <div class="mb-2 flex items-center justify-between rounded border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-200">
          <span>
            A conversion is already running in another tab. Close this tab or wait for it to finish.
          </span>
          <button
            type="button"
            onClick={() => clearTabBlocked()}
            class="ml-2 text-yellow-300 hover:text-yellow-100"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
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
    </div>
  );
}
