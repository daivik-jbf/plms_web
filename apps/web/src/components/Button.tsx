import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'default' | 'small';
  busy?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'default',
  busy = false,
  disabled,
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={[styles.button, styles[variant], size === 'small' ? styles.small : undefined, className]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
