import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/preact';
import { ConvertView } from './ConvertView';

// Mock preact-i18n - must be hoisted, no top-level variables
vi.mock('preact-i18n', () => ({
  useText: vi.fn(() => ({
    dismissAria: 'Dismiss notification',
  })),
  Text: ({ id }: { id: string; children?: string }) => {
    const defaultTexts: Record<string, string> = {
      'convert.hints.llmRequiredTitle': 'LLM API Key Required',
      'convert.hints.llmRequiredDesc': 'LLM API Key description',
      'convert.hints.resumeTitle': 'Crash Recovery & Resume',
      'convert.hints.resumeDesc': 'Resume feature description',
    };
    return defaultTexts[id] || id;
  },
}));

// Mock stores - must be hoisted, use getter pattern
const mockIsConfigured = { value: false };
const mockDismissedNotifications: { value: Record<string, boolean> } = { value: {} };
const mockDismissNotification = vi.fn();

vi.mock('@/stores', async () => {
  const actual = await vi.importActual<typeof import('@/stores')>('@/stores');
  return {
    ...actual,
    get isConfigured() {
      return mockIsConfigured;
    },
    get dismissedNotifications() {
      return mockDismissedNotifications;
    },
    get dismissNotification() {
      return mockDismissNotification;
    },
  };
});

// Mock sub-components - simple mocks
vi.mock('./FileDropZone', () => ({
  FileDropZone: () => <div data-testid="file-drop-zone">FileDropZone</div>,
}));

vi.mock('./QuickVoiceSelect', () => ({
  QuickVoiceSelect: () => <div data-testid="quick-voice-select">QuickVoiceSelect</div>,
}));

vi.mock('./ConvertButton', () => ({
  ConvertButton: () => <div data-testid="convert-button">ConvertButton</div>,
}));

vi.mock('./TextEditor', () => ({
  TextEditor: () => <div data-testid="text-editor">TextEditor</div>,
}));

vi.mock('@/components/status', () => ({
  StatusPanel: () => <div data-testid="status-panel">StatusPanel</div>,
}));

vi.mock('./VoiceReviewModal', () => ({
  VoiceReviewModal: () => <div data-testid="voice-review-modal">VoiceReviewModal</div>,
}));

vi.mock('./ResumeModal', () => ({
  ResumeModal: () => <div data-testid="resume-modal">ResumeModal</div>,
}));

// Create a mock function that we can track
const notificationBannerMockFn = vi.fn();

// Mock NotificationBanner - use inline function that references the tracking mock
vi.mock('@/components/common', () => ({
  NotificationBanner: (props: {
    type: string;
    title: unknown;
    children: unknown;
    storageKey: string;
    show?: boolean;
  }) => {
    notificationBannerMockFn(props);
    if (!props.show && props.show !== undefined) return null;
    if (mockDismissedNotifications.value[props.storageKey]) return null;
    return (
      <div data-testid={`notification-${props.storageKey}`} data-type={props.type}>
        {props.title}
        {props.children}
      </div>
    );
  },
}));

describe('ConvertView', () => {
  beforeEach(() => {
    notificationBannerMockFn.mockClear();
    mockIsConfigured.value = false;
    mockDismissedNotifications.value = {};
  });

  describe('LLM warning banner', () => {
    it('should show LLM warning banner when isConfigured is false and not dismissed', () => {
      mockIsConfigured.value = false;
      mockDismissedNotifications.value = { llmRequired: false };
      render(<ConvertView />);

      expect(notificationBannerMockFn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning',
          storageKey: 'llmRequired',
          show: true,
        }),
      );
    });

    it('should not show LLM warning banner when isConfigured is true', () => {
      mockIsConfigured.value = true;
      mockDismissedNotifications.value = { llmRequired: false };
      render(<ConvertView />);

      const llmBannerCalls = notificationBannerMockFn.mock.calls.filter(
        (call) => call[0].storageKey === 'llmRequired',
      );
      expect(llmBannerCalls.length).toBe(1);
      expect(llmBannerCalls[0][0].show).toBe(false);
    });

    it('should not show LLM warning banner when dismissed', () => {
      mockIsConfigured.value = false;
      mockDismissedNotifications.value = { llmRequired: true };
      const { container } = render(<ConvertView />);

      const llmBanner = container.querySelector('[data-testid="notification-llmRequired"]');
      expect(llmBanner).toBeNull();
    });

    it('should pass LLM warning banner with correct type and storageKey', () => {
      mockIsConfigured.value = false;
      render(<ConvertView />);

      const llmBannerCall = notificationBannerMockFn.mock.calls.find(
        (call) => call[0].storageKey === 'llmRequired',
      );
      expect(llmBannerCall).toBeDefined();
      if (llmBannerCall) {
        expect(llmBannerCall[0]).toMatchObject({
          type: 'warning',
          storageKey: 'llmRequired',
        });
      }
    });
  });

  describe('Resume tip banner', () => {
    it('should show resume tip banner when not dismissed', () => {
      mockDismissedNotifications.value = { resumeFeatureTip: false };
      render(<ConvertView />);

      const resumeBannerCall = notificationBannerMockFn.mock.calls.find(
        (call) => call[0].storageKey === 'resumeFeatureTip',
      );
      expect(resumeBannerCall).toBeDefined();
      if (resumeBannerCall) {
        expect(resumeBannerCall[0]).toMatchObject({
          type: 'info',
          storageKey: 'resumeFeatureTip',
        });
        // show prop should be undefined (not false) to indicate always visible
        expect(resumeBannerCall[0].show).toBeUndefined();
      }
    });

    it('should not show resume tip banner when dismissed', () => {
      mockDismissedNotifications.value = { resumeFeatureTip: true };
      const { container } = render(<ConvertView />);

      const resumeBanner = container.querySelector('[data-testid="notification-resumeFeatureTip"]');
      expect(resumeBanner).toBeNull();
    });

    it('should pass resume tip banner with correct type and storageKey', () => {
      mockDismissedNotifications.value = { resumeFeatureTip: false };
      render(<ConvertView />);

      const resumeBannerCall = notificationBannerMockFn.mock.calls.find(
        (call) => call[0].storageKey === 'resumeFeatureTip',
      );
      expect(resumeBannerCall).toBeDefined();
      if (resumeBannerCall) {
        expect(resumeBannerCall[0]).toMatchObject({
          type: 'info',
          storageKey: 'resumeFeatureTip',
        });
      }
    });
  });

  describe('both banners interaction', () => {
    it('should show both banners when neither is dismissed and LLM not configured', () => {
      mockIsConfigured.value = false;
      mockDismissedNotifications.value = {};
      render(<ConvertView />);

      const llmBannerCall = notificationBannerMockFn.mock.calls.find(
        (call) => call[0].storageKey === 'llmRequired',
      );
      const resumeBannerCall = notificationBannerMockFn.mock.calls.find(
        (call) => call[0].storageKey === 'resumeFeatureTip',
      );

      expect(llmBannerCall).toBeDefined();
      expect(resumeBannerCall).toBeDefined();
    });

    it('should show only resume banner when LLM is configured', () => {
      mockIsConfigured.value = true;
      mockDismissedNotifications.value = {};
      render(<ConvertView />);

      const llmBannerCall = notificationBannerMockFn.mock.calls.find(
        (call) => call[0].storageKey === 'llmRequired',
      );
      const resumeBannerCall = notificationBannerMockFn.mock.calls.find(
        (call) => call[0].storageKey === 'resumeFeatureTip',
      );

      expect(llmBannerCall).toBeDefined();
      expect(resumeBannerCall).toBeDefined();
      if (llmBannerCall) {
        expect(llmBannerCall[0].show).toBe(false);
      }
      if (resumeBannerCall) {
        expect(resumeBannerCall[0].show).toBe(undefined);
      }
    });
  });
});
