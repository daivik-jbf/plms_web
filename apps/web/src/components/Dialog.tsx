import { type MouseEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import styles from './Dialog.module.css';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: 'center' | 'right' | 'left';
  children: ReactNode;
}

// Browsers without `closedby` (Safari) get click-outside dismissal from the handler below.
const supportsClosedBy = typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;
const LIGHT_DISMISS = { closedby: 'any' } as Record<string, string>;

export function Dialog({ open, onClose, title, side = 'center', children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // The native `close` event covers Esc, the back gesture, light dismiss and our own close() calls.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.addEventListener('close', onClose);
    return () => dialog.removeEventListener('close', onClose);
  }, [onClose]);

  function onBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (supportsClosedBy || event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const inside =
      rect.top <= event.clientY && event.clientY <= rect.bottom && rect.left <= event.clientX && event.clientX <= rect.right;
    if (!inside) event.currentTarget.close();
  }

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles[side]}`}
      aria-labelledby={titleId}
      onClick={onBackdropClick}
      {...LIGHT_DISMISS}
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} aria-label="Close" onClick={() => ref.current?.close()}>
            ×
          </button>
        </header>
        <div className={styles.body}>{open ? children : null}</div>
      </div>
    </dialog>
  );
}
