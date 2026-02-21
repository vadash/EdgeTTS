import { useRef, useCallback, useEffect } from 'preact/hooks';
import { useLogs, useConversion } from '@/stores';
import { getLogger } from '@/services';
import type { LogLevel } from '@/services/LoggerService';
import { ProgressBar } from './ProgressBar';

/**
 * Get Tailwind color class based on log level
 */
function getLevelColor(level: LogLevel): string {
  switch (level) {
    case 'error':
      return 'text-red-400';
    case 'warn':
      return 'text-yellow-400';
    case 'info':
    default:
      return 'text-gray-300';
  }
}

export function StatusPanel() {
  const logs = useLogs();
  const conversion = useConversion();
  const logger = getLogger();
  const containerRef = useRef<HTMLDivElement>(null);

  const { current, total } = conversion.progress.value;
  const entries = logs.entries.value;

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries]);

  // Actions
  const handleClear = useCallback(() => {
    logs.clear();
  }, [logs]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(logs.toText());
    } catch (e) {
      logger.error('Failed to copy logs', e instanceof Error ? e : undefined);
    }
  }, [logs, logger]);

  const handleExport = useCallback(() => {
    const text = logs.toText();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `edgetts-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logs]);

  const eta = conversion.estimatedTimeRemaining.value || '';

  return (
    <div className="flex flex-col h-full bg-primary-secondary rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="text-sm text-gray-400">Status</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleClear}
            className="p-1.5 rounded hover:bg-primary-tertiary transition-colors"
            title="Clear"
          >
            🗑️
          </button>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-primary-tertiary transition-colors"
            title="Copy"
          >
            📋
          </button>
          <button
            onClick={handleExport}
            className="p-1.5 rounded hover:bg-primary-tertiary transition-colors"
            title="Export"
          >
            💾
          </button>
        </div>
      </div>

      {/* Progress */}
      {total > 0 && (
        <div className="px-3 py-2 border-b border-border">
          <ProgressBar current={current} total={total} eta={eta} />
        </div>
      )}

      {/* Log entries - scrollable with colored lines */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-sm"
        aria-label="Status log"
      >
        {entries.map((entry) => (
          <div key={entry.id} className={`${getLevelColor(entry.level)} whitespace-pre-wrap break-words`}>
            [{entry.elapsed}] {entry.message}
          </div>
        ))}
      </div>
    </div>
  );
}
