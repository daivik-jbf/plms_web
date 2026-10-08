import type { ComponentPropsWithRef } from 'react';
import styles from './TextField.module.css';
import { useFieldIds } from './use-field-ids';

type SelectProps = ComponentPropsWithRef<'select'> & {
  label: string;
  hint?: string;
  error?: string;
};

export function Select({ label, hint, error, id, children, ...rest }: SelectProps) {
  const { inputId, hintId, errorId, describedBy } = useFieldIds(id, hint, error);

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <select {...rest} id={inputId} className={styles.input} aria-invalid={error ? true : undefined} aria-describedby={describedBy}>
        {children}
      </select>
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
