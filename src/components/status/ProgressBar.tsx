interface ProgressBarProps {
  current: number;
  total: number;
  eta?: string;
}

export function ProgressBar({ current, total, eta }: ProgressBarProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  if (total === 0) return null;

  return (
    <div className="space-y-2">
      <div className="progress-bar">
        <div className="progress-bar-fill" style={{ width: `${percentage}%` }} />
      </div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>
          {current} / {total} ({percentage}%)
        </span>
        {eta && <span>ETA: {eta}</span>}
      </div>
    </div>
  );
}
