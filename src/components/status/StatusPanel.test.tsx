import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/preact';
import { StatusPanel } from './StatusPanel';

// Track worker values dynamically
let mockLlmWorkers = 0;
let mockTtsWorkers = 0;

// Mock preact/hooks
vi.mock('preact/hooks', () => ({
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
  useRef: () => ({ current: null }),
}));

// Mock services
vi.mock('@/services', () => ({
  getLogger: () => ({
    error: vi.fn(),
  }),
}));

// Mock the stores
vi.mock('@/stores', () => ({
  useLogs: () => ({
    entries: { value: [] },
    clear: vi.fn(),
    toText: vi.fn().mockReturnValue('test log text'),
  }),
  useConversion: () => ({
    progress: { value: { current: 50, total: 100, failed: 5 } },
    estimatedTimeRemaining: { value: '00:05:00' },
  }),
}));

// Mock the worker signals - these are read dynamically from the tracking vars
vi.mock('@/stores/ConversionStore', () => ({
  get activeLlmWorkers() {
    return { value: mockLlmWorkers };
  },
  get activeTtsWorkers() {
    return { value: mockTtsWorkers };
  },
}));

describe('StatusPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLlmWorkers = 0;
    mockTtsWorkers = 0;
  });

  it('renders ProgressBar with worker counts from store', () => {
    mockLlmWorkers = 4;
    mockTtsWorkers = 8;

    const { container } = render(<StatusPanel />);

    // ProgressBar should render with worker counts
    expect(container.textContent).toContain('50%');
    expect(container.textContent).toContain('LLM: 4');
  });

  it('renders TTS workers when LLM workers are 0', () => {
    mockLlmWorkers = 0;
    mockTtsWorkers = 8;

    const { container } = render(<StatusPanel />);

    expect(container.textContent).toContain('TTS: 8');
    expect(container.textContent).not.toContain('LLM:');
  });

  it('does not render worker badge when both counts are 0', () => {
    mockLlmWorkers = 0;
    mockTtsWorkers = 0;

    const { container } = render(<StatusPanel />);

    expect(container.textContent).not.toContain('LLM:');
    expect(container.textContent).not.toContain('TTS:');
  });

  it('renders progress bar with correct counts', () => {
    mockLlmWorkers = 2;
    mockTtsWorkers = 0;

    const { container } = render(<StatusPanel />);

    // Should show current, failed, and remaining
    expect(container.textContent).toContain('50'); // current
    expect(container.textContent).toContain('5'); // failed
    expect(container.textContent).toContain('45'); // remaining (100-50-5)
  });
});
