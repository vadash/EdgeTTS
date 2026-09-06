import { useCallback, useEffect, useRef } from 'preact/hooks';
import { getLogger } from '@/services';
import type { LogLevel } from '@/services/Logger';
import { useConversion, useLogs } from '@/stores';
import { downloadFile } from '@/utils/file';
import { activeLlmWorkers, activeTtsWorkers } from '@/stores/ConversionStore';
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
    default:
      return 'text-gray-300';
  }
}

export function StatusPanel() {
  const logs = useLogs();
  const conversion = useConversion();
  const logger = getLogger();
  const containerRef = useRef<HTMLDivElement>(null);

  const { current, total, failed } = conversion.progress.value;
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
    downloadFile(
      logs.toText(),
      `edgetts-logs-${new Date().toISOString().slice(0, 10)}.txt`,
      'text/plain',
    );
  }, [logs]);

  const eta = conversion.estimatedTimeRemaining.value || '';

  return (
    <div className="flex flex-col h-full bg-primary-secondary rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="text-sm text-gray-400">Status</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleClear}
            className="p-1.5 rounded hover:bg-primary-tertiary transition-colors"
            title="Clear"
          >
            🗑️
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-primary-tertiary transition-colors"
            title="Copy"
          >
            📋
          </button>
          <button
            type="button"
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
          <ProgressBar
            current={current}
            total={total}
            failed={failed}
            eta={eta}
            llmWorkers={activeLlmWorkers.value}
            ttsWorkers={activeTtsWorkers.value}
          />
        </div>
      )}

      {/* Log entries - scrollable with colored lines */}
      <div
        ref={containerRef}
        role="log"
        aria-live="polite"
        className="flex-1 overflow-y-auto p-3 font-mono text-sm"
      >
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`${getLevelColor(entry.level)} whitespace-pre-wrap break-words`}
          >
            [{entry.elapsed}] {entry.message}
          </div>
        ))}
      </div>
    </div>
  );
}
