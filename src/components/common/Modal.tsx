import type { ComponentChildren } from 'preact';

interface ModalProps {
  open?: boolean;
  onClose?: () => void;
  title?: ComponentChildren;
  children: ComponentChildren;
  className?: string;
}

export function Modal({ open = true, onClose, title, children, className = '' }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className={`bg-surface border border-border rounded-lg shadow-xl ${className}`.trim()}>
        {title != null && (
          <div
            className={
              onClose
                ? 'flex items-center justify-between px-4 py-3 border-b border-border'
                : 'px-4 py-3 border-b border-border'
            }
          >
            <h2 className="text-lg font-semibold">{title}</h2>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="text-gray-400 hover:text-white p-1"
                aria-label="Close"
              >
                ✕
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
