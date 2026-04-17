import { signal } from '@preact/signals';
import { Button } from '@/components/common';
import { KokoroFallbackService } from '@/services/KokoroFallbackService';

const TEST_SENTENCE = 'Hello, this is a test of the Kokoro text to speech engine.';

const loading = signal(false);
const error = signal<string | null>(null);

export function KokoroTestButton() {
  const handleClick = async () => {
    loading.value = true;
    error.value = null;

    try {
      const kokoro = KokoroFallbackService.getInstance();
      await kokoro.preload();
      const blob = await kokoro.synthesize(TEST_SENTENCE, 'female');
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      await audio.play();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  };

  return (
    <div class="w-full">
      {error.value && (
        <div class="mb-2 rounded border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error.value}
        </div>
      )}
      <Button
        variant="default"
        onClick={handleClick}
        disabled={loading.value}
        className="w-full py-2 text-sm"
      >
        {loading.value ? 'Loading...' : 'Test Kokoro'}
      </Button>
    </div>
  );
}
