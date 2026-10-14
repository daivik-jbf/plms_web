import { type MouseEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import styles from './Dialog.module.css';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: 'center' | 'right' | 'left';
  // While true (a request is running) the user cannot dismiss the dialog: Esc, the back gesture, light dismiss,
  // click-outside and the Close button are all ignored.
  blocked?: boolean;
  // When given, Esc, the back gesture, light dismiss, click-outside and the Close button ask this instead of closing, so the
  // owner can ask first ("discard what you typed?") and then close by setting `open` to false.
  onDismissRequest?: () => void;
  children: ReactNode;
}

// Browsers without `closedby` (Safari) get click-outside dismissal from the handler below.
const supportsClosedBy = typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;
const LIGHT_DISMISS = { closedby: 'any' } as Record<string, string>;

export function Dialog({ open, onClose, title, side = 'center', blocked = false, onDismissRequest, children }: DialogProps) {
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

  // The native `cancel` event precedes Esc, the back gesture and light dismiss; cancelling it keeps the dialog open.
  const dismissRequest = useRef(onDismissRequest);
  dismissRequest.current = onDismissRequest;
  const asksFirst = onDismissRequest !== undefined;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !(blocked || asksFirst)) return;
    const keepOpen = (event: Event) => {
      event.preventDefault();
      if (!blocked) dismissRequest.current?.();
    };
    dialog.addEventListener('cancel', keepOpen);
    return () => dialog.removeEventListener('cancel', keepOpen);
  }, [blocked, asksFirst]);

  function onBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (blocked || supportsClosedBy || event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const inside =
      rect.top <= event.clientY && event.clientY <= rect.bottom && rect.left <= event.clientX && event.clientX <= rect.right;
    if (!inside) {
      if (dismissRequest.current) dismissRequest.current();
      else event.currentTarget.close();
    }
  }

  return (
    <dialog
      ref={ref}
      // The centered dialog needs no class of its own (there is no .center rule), so only drawers add one.
      className={[styles.dialog, side === 'center' ? undefined : styles[side]].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      onClick={onBackdropClick}
      {...LIGHT_DISMISS}
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} aria-label="Close" disabled={blocked} onClick={() => (onDismissRequest ? onDismissRequest() : ref.current?.close())}>
            ×
          </button>
        </header>
        <div className={styles.body}>{open ? children : null}</div>
      </div>
    </dialog>
  );
}
