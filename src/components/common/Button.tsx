import type { ComponentChildren, JSX } from 'preact';

type ButtonVariant = 'default' | 'primary';
type ButtonSize = 'default' | 'sm' | 'icon';

interface ButtonProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'size'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ComponentChildren;
  disabled?: boolean;
}

export function Button({
  variant = 'default',
  size = 'default',
  children,
  className = '',
  ...props
}: ButtonProps) {
  const variantClasses = variant === 'primary' ? 'btn-primary' : '';
  const sizeClasses = size === 'sm' ? 'btn-sm' : size === 'icon' ? 'btn-icon' : '';

  return (
    <button
      className={`btn ${variantClasses} ${sizeClasses} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
