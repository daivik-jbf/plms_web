import type { ComponentPropsWithRef } from 'react';
import styles from './TextField.module.css';
import { useFieldIds } from './use-field-ids';

type TextAreaProps = ComponentPropsWithRef<'textarea'> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextArea({ label, hint, error, id, rows = 4, ...rest }: TextAreaProps) {
  const { inputId, hintId, errorId, describedBy } = useFieldIds(id, hint, error);

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <textarea {...rest} id={inputId} rows={rows} className={styles.input} aria-invalid={error ? true : undefined} aria-describedby={describedBy} />
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
