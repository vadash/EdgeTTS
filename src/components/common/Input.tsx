import type { JSX } from 'preact';

interface InputProps extends Omit<JSX.HTMLAttributes<HTMLInputElement>, 'label'> {
  label?: string;
}

export function Input({ label, id, className = '', ...props }: InputProps) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={inputId} className="input-label">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`input-field ${className}`.trim()}
        {...props}
      />
    </div>
  );
}
