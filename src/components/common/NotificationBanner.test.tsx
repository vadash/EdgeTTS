import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { NotificationBanner } from './NotificationBanner';

// Mock preact-i18n
vi.mock('preact-i18n', () => ({
  useText: vi.fn((_: Record<string, string>) => ({
    dismissAria: 'Dismiss notification',
  })),
  Text: ({ children }: { id: string; children: string }) => children,
}));

// Mock the UISettingsStore
const mockDismissedNotifications = { value: {} };
const mockDismissNotification = vi.fn();

vi.mock('@/stores', () => ({
  get dismissedNotifications() {
    return mockDismissedNotifications;
  },
  get dismissNotification() {
    return mockDismissNotification;
  },
}));

describe('NotificationBanner', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    mockDismissedNotifications.value = {};
  });

  describe('rendering behavior', () => {
    it('should render when not dismissed and show is true', () => {
      mockDismissedNotifications.value = { llmRequired: false };
      const { container } = render(
        <NotificationBanner type="info" storageKey="llmRequired" title="Test Title">
          Test content
        </NotificationBanner>,
      );
      expect(container.firstChild).not.toBeNull();
    });

    it('should render when not dismissed and show is undefined', () => {
      mockDismissedNotifications.value = { llmRequired: false };
      const { container } = render(
        <NotificationBanner type="warning" storageKey="llmRequired" title="Test Title">
          Test content
        </NotificationBanner>,
      );
      expect(container.firstChild).not.toBeNull();
    });

    it('should not render when dismissed (storageKey = true)', () => {
      mockDismissedNotifications.value = { llmRequired: true };
      const { container } = render(
        <NotificationBanner type="info" storageKey="llmRequired" title="Test Title">
          Test content
        </NotificationBanner>,
      );
      expect(container.firstChild).toBeNull();
    });

    it('should not render when show prop is false', () => {
      mockDismissedNotifications.value = { llmRequired: false };
      const { container } = render(
        <NotificationBanner type="info" storageKey="llmRequired" title="Test Title" show={false}>
          Test content
        </NotificationBanner>,
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('dismiss functionality', () => {
    it('dismiss button has i18n aria-label and calls dismissNotification on click', () => {
      mockDismissedNotifications.value = { llmRequired: false };
      render(
        <NotificationBanner type="info" storageKey="llmRequired" title="Test Title">
          Test content
        </NotificationBanner>,
      );

      const dismissButton = screen.getByLabelText('Dismiss notification');
      expect(dismissButton).toBeDefined();
      dismissButton.click();
      expect(mockDismissNotification).toHaveBeenCalledWith('llmRequired');
    });
  });

  describe('styling by type', () => {
    it('renders the warning icon for the warning variant', () => {
      mockDismissedNotifications.value = { llmRequired: false };
      const { container } = render(
        <NotificationBanner type="warning" storageKey="llmRequired" title="Test Title">
          Test content
        </NotificationBanner>,
      );
      expect(container.textContent).toContain('⚠️');
    });

    it('renders the info icon for the info variant', () => {
      mockDismissedNotifications.value = { llmRequired: false };
      const { container } = render(
        <NotificationBanner type="info" storageKey="llmRequired" title="Test Title">
          Test content
        </NotificationBanner>,
      );
      expect(container.textContent).toContain('💡');
    });
  });

  describe('content rendering', () => {
    it('should render title and children', () => {
      mockDismissedNotifications.value = { llmRequired: false };
      const { container } = render(
        <NotificationBanner type="info" storageKey="llmRequired" title="Test Title">
          Test content
        </NotificationBanner>,
      );

      expect(container.textContent).toContain('Test Title');
      expect(container.textContent).toContain('Test content');
    });
  });
});
