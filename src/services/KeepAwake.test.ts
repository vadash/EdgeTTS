import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('KeepAwake - visibility guard', () => {
  let _originalNavigator: Navigator;
  let mockWakeLock: { request: ReturnType<typeof vi.fn> };
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockWakeLock = {
      request: vi.fn().mockResolvedValue({
        released: false,
        release: vi.fn().mockResolvedValue(undefined),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onrelease: null,
        type: 'screen',
      }),
    };

    // Mock navigator.wakeLock
    Object.defineProperty(navigator, 'wakeLock', {
      value: mockWakeLock,
      configurable: true,
      writable: true,
    });

    addEventListenerSpy = vi.spyOn(document, 'addEventListener');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not request wake lock when document is hidden', async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });

    // Import fresh to get clean state
    const { KeepAwake } = await import('./KeepAwake');
    const keepAwake = new KeepAwake();

    // Trigger just is wake lock part by calling start()
    // The wake lock request should be skipped
    await keepAwake.start();

    expect(mockWakeLock.request).not.toHaveBeenCalled();

    // But, visibility listener should still be registered
    expect(addEventListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    keepAwake.stop();
  });

  it('requests wake lock when document is visible', async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });

    const { KeepAwake } = await import('./KeepAwake');
    const keepAwake = new KeepAwake();

    await keepAwake.start();

    expect(mockWakeLock.request).toHaveBeenCalledWith('screen');

    keepAwake.stop();
  });
});
