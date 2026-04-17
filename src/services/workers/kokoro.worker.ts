import { KokoroTTS } from 'kokoro-js';

const MODEL_ID = 'onnx-community/Kokoro-82M-ONNX';
const DTYPE = 'q8' as const;
const DEVICE = 'wasm' as const;

let tts: KokoroTTS | null = null;

// Web Worker message handler — `self` is the worker global scope
const ctx = self as unknown as Worker;

ctx.onmessage = async (ev: MessageEvent): Promise<void> => {
  const { type } = ev.data as { type: string };

  switch (type) {
    case 'load': {
      try {
        tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: DTYPE, device: DEVICE });
        ctx.postMessage({ type: 'ready' });
      } catch (err) {
        ctx.postMessage({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'generate': {
      try {
        if (!tts) {
          ctx.postMessage({
            type: 'generate_error',
            error: 'Model not loaded',
          });
          return;
        }

        const { text, voice } = ev.data as { type: string; text: string; voice: string };
        const result = await tts.generate(text, { voice: voice as 'af_bella' });
        const audio = result.audio as Float32Array;

        ctx.postMessage({ type: 'generate_result', audio }, [audio.buffer]);
      } catch (err) {
        ctx.postMessage({
          type: 'generate_error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    default:
      break;
  }
};
