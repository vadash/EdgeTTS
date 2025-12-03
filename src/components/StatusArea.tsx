import { useRef, useCallback, useEffect } from 'preact/hooks';
import { Text } from 'preact-i18n';
import { useLogs, useConversion, useSettings } from '../stores';
import type { LogLevel } from '../services/interfaces';

export function StatusArea() {
  const logs = useLogs();
  const conversion = useConversion();
  const settings = useSettings();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { current, total } = conversion.progress.value;
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const filter = logs.filterLevel.value;
  const errorCount = logs.errorCount.value;
  const warningCount = logs.warningCount.value;

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

  // Resizer logic
  const isDragging = useRef(false);
  const resizerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    resizerRef.current?.classList.add('dragging');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = window.innerWidth - e.clientX;
      const clampedWidth = Math.max(250, Math.min(newWidth, window.innerWidth * 0.5));
      settings.setStatusAreaWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      resizerRef.current?.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      settings.save();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [settings]);

  // Actions
  const handleClear = useCallback(() => {
    logs.clear();
  }, [logs]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(logs.toText());
    } catch (e) {
      console.error('Failed to copy logs', e);
    }
  }, [logs]);

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

  return (
    <div
      class="status-area"
      style={{ width: `${settings.statusAreaWidth.value}px` }}
    >
      <div
        ref={resizerRef}
        class="status-resizer"
        onMouseDown={handleMouseDown}
      />

      {/* Header with filters and actions */}
      <div class="status-header">
        <div class="status-filters">
          <button
            class={`status-filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            <Text id="status.filter.all">All</Text>
          </button>
          <button
            class={`status-filter-btn ${filter === 'error' ? 'active' : ''}`}
            onClick={() => setFilter('error')}
          >
            <Text id="status.filter.errors">Errors</Text>
            {errorCount > 0 && <span class="count">({errorCount})</span>}
          </button>
          <button
            class={`status-filter-btn ${filter === 'warn' ? 'active' : ''}`}
            onClick={() => setFilter('warn')}
          >
            <Text id="status.filter.warnings">Warnings</Text>
            {warningCount > 0 && <span class="count">({warningCount})</span>}
          </button>
        </div>
        <div class="status-actions">
          <button class="status-action-btn" onClick={handleClear} title="Clear">
            🗑️
          </button>
          <button class="status-action-btn" onClick={handleCopy} title="Copy">
            📋
          </button>
          <button class="status-action-btn" onClick={handleExport} title="Export">
            💾
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div class="progress-container">
          <div class="progress-bar-wrapper">
            <div class="progress-bar" style={{ width: `${percentage}%` }} />
          </div>
          <div class="progress-info">
            <span>{current} / {total} ({percentage}%)</span>
            {eta && <span><Text id="status.progress.eta">ETA</Text>: {eta}</span>}
          </div>
        </div>
      )}

      {/* Log entries */}
      <textarea
        ref={textareaRef}
        id="stat-area"
        class="status-textarea"
        readOnly
        value={statusText}
        aria-label="Status log"
      />
    </div>
  );
}
