import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock kokoro-js before importing the worker
const mockGenerate = vi.fn();
const mockTtsInstance = {
  generate: mockGenerate,
};

const mockFromPretrained = vi.fn().mockResolvedValue(mockTtsInstance);

vi.mock('kokoro-js', () => ({
  KokoroTTS: {
    from_pretrained: mockFromPretrained,
  },
}));

// Capture worker message handlers
let messageHandler: ((ev: MessageEvent) => void) | null = null;
const postedMessages: unknown[] = [];

const mockSelf = {
  onmessage: null as ((ev: MessageEvent) => void) | null,
  postMessage: vi.fn((data: unknown, _transfer?: unknown[]) => {
    postedMessages.push(data);
  }),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

// Mock DedicatedWorkerGlobalScope
vi.stubGlobal('self', mockSelf);

// We need to import dynamically because the worker assigns to self.onmessage at top level
beforeEach(async () => {
  vi.clearAllMocks();
  postedMessages.length = 0;
  mockSelf.onmessage = null;
  messageHandler = null;

  mockFromPretrained.mockResolvedValue(mockTtsInstance);

  // Dynamic import to re-execute the worker module
  vi.resetModules();

  // Re-stub globals after resetModules
  vi.stubGlobal('self', mockSelf);

  // Re-mock kokoro-js
  vi.doMock('kokoro-js', () => ({
    KokoroTTS: {
      from_pretrained: mockFromPretrained,
    },
  }));

  await import('./kokoro.worker');

  // Capture the handler assigned to self.onmessage
  messageHandler = mockSelf.onmessage;
});

function sendMessage(data: unknown): void {
  if (!messageHandler) {
    throw new Error('Worker message handler not set');
  }
  messageHandler(new MessageEvent('message', { data }));
}

describe('kokoro.worker', () => {
  describe('load', () => {
    it('should call KokoroTTS.from_pretrained and post ready on success', async () => {
      sendMessage({ type: 'load' });

      // Wait for async from_pretrained to resolve
      await vi.waitFor(() => expect(mockFromPretrained).toHaveBeenCalled());

      expect(mockFromPretrained).toHaveBeenCalledWith('onnx-community/Kokoro-82M-ONNX', {
        dtype: 'q8',
        device: 'wasm',
      });
      expect(mockSelf.postMessage).toHaveBeenCalledWith({ type: 'ready' });
    });

    it('should post error when model loading fails', async () => {
      mockFromPretrained.mockRejectedValue(new Error('Network failure'));

      sendMessage({ type: 'load' });

      await vi.waitFor(() => expect(mockSelf.postMessage).toHaveBeenCalled());

      const errorCall = mockSelf.postMessage.mock.calls.find(
        (call: unknown[]) => (call[0] as { type: string }).type === 'error',
      );
      expect(errorCall).toBeDefined();
      expect((errorCall![0] as { type: string; message: string }).message).toContain(
        'Network failure',
      );
    });
  });

  describe('generate', () => {
    it('should call tts.generate and post generate_result with Float32Array audio', async () => {
      // First load the model
      sendMessage({ type: 'load' });
      await vi.waitFor(() => expect(mockFromPretrained).toHaveBeenCalled());

      // Reset postMessage tracking for generate phase
      mockSelf.postMessage.mockClear();

      const pcmData = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      mockGenerate.mockResolvedValue({
        audio: pcmData,
        sampling_rate: 24000,
      });

      sendMessage({ type: 'generate', text: 'Hello world', voice: 'af_bella' });

      await vi.waitFor(() => expect(mockGenerate).toHaveBeenCalled());

      expect(mockGenerate).toHaveBeenCalledWith('Hello world', { voice: 'af_bella' });

      // Verify the posted message has the correct structure
      const resultCall = mockSelf.postMessage.mock.calls.find(
        (call: unknown[]) => (call[0] as { type: string }).type === 'generate_result',
      );
      expect(resultCall).toBeDefined();
      const result = resultCall![0] as { type: string; audio: Float32Array };
      expect(result.type).toBe('generate_result');
      expect(result.audio).toBeInstanceOf(Float32Array);
      expect(result.audio.length).toBe(4);
      expect(result.audio[0]).toBeCloseTo(0.1);
      expect(result.audio[1]).toBeCloseTo(0.2);
      expect(result.audio[2]).toBeCloseTo(0.3);
      expect(result.audio[3]).toBeCloseTo(0.4);

      // Verify ArrayBuffer was transferred (2nd arg to postMessage)
      const transferList = resultCall![1] as ArrayBuffer[];
      expect(transferList).toBeDefined();
      expect(transferList).toContain(result.audio.buffer);
    });

    it('should post generate_error when synthesis fails', async () => {
      // First load the model
      sendMessage({ type: 'load' });
      await vi.waitFor(() => expect(mockFromPretrained).toHaveBeenCalled());

      mockSelf.postMessage.mockClear();

      mockGenerate.mockRejectedValue(new Error('Inference failed'));

      sendMessage({ type: 'generate', text: 'Fail me', voice: 'am_adam' });

      await vi.waitFor(() => expect(mockGenerate).toHaveBeenCalled());

      const errorCall = mockSelf.postMessage.mock.calls.find(
        (call: unknown[]) => (call[0] as { type: string }).type === 'generate_error',
      );
      expect(errorCall).toBeDefined();
      expect((errorCall![0] as { type: string; error: string }).error).toContain(
        'Inference failed',
      );
    });

    it('should post error when generate is called before model is loaded', async () => {
      // Do NOT load first — directly send generate
      sendMessage({ type: 'generate', text: 'No model', voice: 'af_bella' });

      await vi.waitFor(() => expect(mockSelf.postMessage).toHaveBeenCalled());

      const errorCall = mockSelf.postMessage.mock.calls.find(
        (call: unknown[]) => (call[0] as { type: string }).type === 'generate_error',
      );
      expect(errorCall).toBeDefined();
      expect((errorCall![0] as { type: string; error: string }).error).toContain('not loaded');
    });
  });

  describe('unknown message type', () => {
    it('should ignore unknown message types', async () => {
      // Load model first so worker is in a known state
      sendMessage({ type: 'load' });
      await vi.waitFor(() => expect(mockFromPretrained).toHaveBeenCalled());

      mockSelf.postMessage.mockClear();

      sendMessage({ type: 'unknown_type' });

      // Give a tick for any async handling
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSelf.postMessage).not.toHaveBeenCalled();
    });
  });
});
