import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

// Mock KokoroFallbackService
const mockPreload = vi.fn().mockResolvedValue(undefined);
const mockSynthesize = vi
  .fn()
  .mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }));

vi.mock('@/services/KokoroFallbackService', () => ({
  KokoroFallbackService: {
    getInstance: vi.fn(() => ({
      preload: mockPreload,
      synthesize: mockSynthesize,
    })),
  },
}));

// Mock preact-i18n
vi.mock('preact-i18n', () => ({
  Text: ({ children }: { id: string; children: string }) => children,
}));

import { KokoroTestButton } from './KokoroTestButton';

describe('KokoroTestButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreload.mockResolvedValue(undefined);
    mockSynthesize.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }));
  });

  it('should render a button with text "Test Kokoro"', () => {
    render(<KokoroTestButton />);
    expect(screen.getByText('Test Kokoro')).toBeDefined();
  });

  it('should call preload then synthesize on click', async () => {
    render(<KokoroTestButton />);
    const button = screen.getByText('Test Kokoro');
    await fireEvent.click(button);

    await waitFor(() => {
      expect(mockPreload).toHaveBeenCalledOnce();
      expect(mockSynthesize).toHaveBeenCalledOnce();
      expect(mockSynthesize).toHaveBeenCalledWith(
        'Hello, this is a test of the Kokoro text to speech engine.',
        'female',
      );
    });
  });

  it('should show loading state while model is loading/synthesizing', async () => {
    let resolvePreload: () => void;
    mockPreload.mockReturnValue(
      new Promise<void>((r) => {
        resolvePreload = r;
      }),
    );

    render(<KokoroTestButton />);
    const button = screen.getByRole('button');
    await fireEvent.click(button);

    // Button should show loading text and be disabled
    await waitFor(() => {
      expect(screen.getByText('Loading...')).toBeDefined();
    });
    expect(button.hasAttribute('disabled')).toBe(true);

    // Resolve to clean up
    resolvePreload!();
    await waitFor(() => {
      expect(screen.getByText('Test Kokoro')).toBeDefined();
    });
  });

  it('should show error state if synthesis fails', async () => {
    mockSynthesize.mockRejectedValue(new Error('Synthesis failed'));

    render(<KokoroTestButton />);
    await fireEvent.click(screen.getByText('Test Kokoro'));

    await waitFor(() => {
      expect(screen.getByText(/Synthesis failed/)).toBeDefined();
    });
  });

  it('should create Audio with blob URL and play on successful synthesis', async () => {
    const audioPlaySpy = vi.fn().mockResolvedValue(undefined);
    const OrigAudio = window.Audio;
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    vi.stubGlobal(
      'Audio',
      class {
        play = audioPlaySpy;
      },
    );

    render(<KokoroTestButton />);
    await fireEvent.click(screen.getByText('Test Kokoro'));

    await waitFor(() => {
      expect(audioPlaySpy).toHaveBeenCalledOnce();
    });

    expect(URL.createObjectURL).toHaveBeenCalled();
    vi.stubGlobal('Audio', OrigAudio);
  });
});
