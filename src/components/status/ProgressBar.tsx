interface ProgressBarProps {
  current: number;
  total: number;
  failed?: number;
  eta?: string;
  llmWorkers?: number;
  ttsWorkers?: number;
}

function ProgressBar({
  current,
  total,
  failed = 0,
  eta,
  llmWorkers = 0,
  ttsWorkers = 0,
}: ProgressBarProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  if (total === 0) return null;

  const remaining = total - current - failed;

  return (
    <div className="space-y-2">
      <div className="progress-bar">
        <div className="progress-bar-fill" style={{ width: `${percentage}%` }} />
      </div>
      <div className="flex justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="text-green-400">
            {'\u2713'} {current}
          </span>
          {failed > 0 && (
            <span className="text-red-400">
              {'\u2717'} {failed}
            </span>
          )}
          {remaining > 0 && (
            <span className="text-gray-400">
              {'\u25CC'} {remaining}
            </span>
          )}
          <span>({percentage}%)</span>
          {(llmWorkers > 0 || ttsWorkers > 0) && (
            <span className="ml-2 px-2 py-0.5 rounded bg-surface-alt border border-border text-gray-400">
              {'\u26A1'} {llmWorkers > 0 ? `LLM: ${llmWorkers}` : `TTS: ${ttsWorkers}`}
            </span>
          )}
        </div>
        {eta && <span>ETA: {eta}</span>}
      </div>
    </div>
  );
}

export { ProgressBar };
export type { ProgressBarProps };
