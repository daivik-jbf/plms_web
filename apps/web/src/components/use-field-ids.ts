import { useId } from 'react';

// Ids that tie a form control to its hint and error text, shared by TextField and Select.
export function useFieldIds(id: string | undefined, hint?: string, error?: string) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return { inputId, hintId, errorId, describedBy };
}
