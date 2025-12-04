import { useRef, useCallback, useEffect } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { useLogs, useConversion } from '@/stores';
import { useLogger } from '@/di';
import type { LogLevel } from '@/services/interfaces';
import { ProgressBar } from './ProgressBar';

export function StatusPanel() {
  const logs = useLogs();
  const conversion = useConversion();
  const logger = useLogger();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { current, total } = conversion.progress.value;
  const filter = logs.filterLevel.value;
  const { error: errorCount, warn: warningCount, info: infoCount, debug: debugCount } = logs.counts.value;

  // Get filtered entries
  const entries = logs.filtered.value;
  const statusText = entries.map(e => `[${e.elapsed}] ${e.message}`).join('\n');

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [statusText]);

  // Calculate ETA
  const getETA = useCallback(() => {
    if (current === 0 || total === 0 || !conversion.startTime.value) return '';
    const elapsed = Date.now() - conversion.startTime.value;
    const rate = current / elapsed;
    const remaining = (total - current) / rate;
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, [current, total, conversion.startTime.value]);

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

  const setFilter = useCallback((level: LogLevel | 'all') => {
    logs.setFilter(level);
  }, [logs]);

  const eta = getETA();

  const FilterButton = ({ level, label, count }: { level: LogLevel | 'all'; label: string; count?: number }) => (
    <button
      onClick={() => setFilter(level)}
      className={`px-2 py-1 text-xs rounded transition-colors
        ${filter === level
          ? 'bg-accent text-white'
          : 'text-gray-400 hover:text-white hover:bg-primary-tertiary'
        }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className="ml-1 opacity-70">({count})</span>
      )}
    </button>
  );

  return (
    <div className="flex flex-col h-full bg-primary-secondary rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-1 flex-wrap">
          <FilterButton level="all" label="All" />
          <FilterButton level="error" label="Errors" count={errorCount} />
          <FilterButton level="warn" label="Warnings" count={warningCount} />
          <FilterButton level="info" label="Info" count={infoCount} />
          <FilterButton level="debug" label="Debug" count={debugCount} />
        </div>
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

      {/* Log entries */}
      <textarea
        ref={textareaRef}
        className="flex-1 w-full p-3 bg-transparent text-sm font-mono text-gray-300 resize-none
                   focus:outline-none scrollbar-hide"
        readOnly
        value={statusText}
        aria-label="Status log"
      />
    </div>
  );
}
