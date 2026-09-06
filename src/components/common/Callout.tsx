import type { ComponentChildren } from 'preact';

type CalloutTone = 'success' | 'error' | 'warning';

const toneClasses: Record<CalloutTone, string> = {
  success: 'bg-green-500/20 text-green-400 border border-green-500/30',
  error: 'bg-red-500/20 text-red-400 border border-red-500/30',
  warning: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
};

interface CalloutProps {
  tone: CalloutTone;
  children: ComponentChildren;
}

/** Static status callout: one tone-colored div; children carry icon and message. */
export function Callout({ tone, children }: CalloutProps) {
  return <div className={`p-3 rounded-lg ${toneClasses[tone]}`}>{children}</div>;
}
