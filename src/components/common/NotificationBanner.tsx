import type { ComponentChildren } from 'preact';
import { useText } from 'preact-i18n';
import { dismissedNotifications, dismissNotification } from '@/stores';

type NotificationType = 'warning' | 'info';

interface NotificationBannerProps {
  type: NotificationType;
  title: string;
  children: ComponentChildren;
  storageKey: keyof typeof dismissedNotifications.value;
  show?: boolean;
}

export function NotificationBanner({
  type,
  title,
  children,
  storageKey,
  show = true,
}: NotificationBannerProps) {
  const { dismissAria } = useText({
    dismissAria: 'notificationBanner.dismissAria',
  });

  // Check if notification is dismissed or show is false
  const isDismissed = dismissedNotifications.value[storageKey];
  if (isDismissed || !show) {
    return null;
  }

  const typeStyles = {
    warning: 'bg-red-500/20 border-red-500/50 text-red-400',
    info: 'bg-blue-500/20 border-blue-500/50 text-blue-400',
  };

  const icon = type === 'warning' ? '⚠️' : '💡';

  return (
    <div className={`flex items-start gap-3 p-4 rounded-lg border ${typeStyles[type]}`}>
      <span className="text-xl flex-shrink-0" aria-hidden="true">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold mb-1">{title}</h3>
        <div className="text-sm opacity-90">{children}</div>
      </div>
      <button
        type="button"
        onClick={() => dismissNotification(storageKey)}
        className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
        aria-label={dismissAria}
      >
        ✕
      </button>
    </div>
  );
}
