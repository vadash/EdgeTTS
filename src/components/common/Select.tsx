import type { JSX } from 'preact';

interface SelectProps extends Omit<JSX.HTMLAttributes<HTMLSelectElement>, 'label'> {
  label?: string;
  options: Array<{ value: string; label: string }>;
  value?: string;
}

export function Select({ label, id, options, className = '', value, ...props }: SelectProps) {
  const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={selectId} className="input-label">
          {label}
        </label>
      )}
      <select id={selectId} className={`select-field ${className}`.trim()} value={value} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
