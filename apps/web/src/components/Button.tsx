import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  busy?: boolean;
};

export function Button({ variant = 'primary', busy = false, disabled, type = 'button', className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy}
      className={[styles.button, styles[variant], className].filter(Boolean).join(' ')}
    />
  );
}
