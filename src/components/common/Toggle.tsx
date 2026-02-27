interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  title?: string;
}

export function Toggle({ checked, onChange, label, disabled = false, title }: ToggleProps) {
  return (
    <label
      className={`flex items-center gap-3 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      title={title}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`toggle ${checked ? 'toggle-checked' : ''}`}
      >
        <span
          className={`toggle-thumb ${checked ? 'toggle-thumb-checked' : 'toggle-thumb-unchecked'}`}
        />
      </button>
      {label && <span className="text-sm text-gray-300">{label}</span>}
    </label>
  );
}
