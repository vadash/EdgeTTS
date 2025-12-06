interface SliderProps {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  disabled?: boolean;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue = (v) => String(v),
  disabled = false
}: SliderProps) {
  return (
    <div className={`space-y-2 ${disabled ? 'opacity-50' : ''}`}>
      {label && (
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">{label}</span>
          <span className="text-white font-medium">{formatValue(value)}</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => !disabled && onChange(Number((e.target as HTMLInputElement).value))}
        disabled={disabled}
        className="slider"
      />
    </div>
  );
}
