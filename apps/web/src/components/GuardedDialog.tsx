import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';

interface Guard {
  setDirty: (dirty: boolean) => void;
  // Closes the dialog, asking first when something has been typed or changed. Does nothing while a request is running.
  requestClose: () => void;
}

const GuardContext = createContext<Guard | null>(null);

interface GuardedDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  blocked?: boolean;
  // What the person is about to lose, for the question: "Discard the lesson you started?"
  discard?: string;
  children: ReactNode;
}

// A dialog with a form that asks before it is closed with something typed or changed in it. The form reports that with
// useDialogGuard, and uses the function it returns for its own Cancel button.
export function GuardedDialog({ open, onClose, title, blocked = false, discard = 'Discard what you have entered?', children }: GuardedDialogProps) {
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);

  const close = useCallback(() => {
    setAsking(false);
    setDirty(false);
    onClose();
  }, [onClose]);

  const guard = useMemo<Guard>(
    () => ({
      setDirty,
      requestClose: () => {
        if (blocked) return;
        if (dirty) setAsking(true);
        else close();
      },
    }),
    [blocked, dirty, close],
  );

  return (
    <GuardContext.Provider value={guard}>
      <Dialog open={open} onClose={close} title={title} blocked={blocked} onDismissRequest={guard.requestClose}>
        {children}
      </Dialog>
      <ConfirmDialog open={asking} title="Discard changes?" confirmLabel="Discard" cancelLabel="Keep editing" tone="danger" onConfirm={close} onCancel={() => setAsking(false)}>
        {discard}
      </ConfirmDialog>
    </GuardContext.Provider>
  );
}

// Tells the dialog around the form whether it holds anything worth keeping, and returns what to call to close it.
export function useDialogGuard(dirty: boolean): () => void {
  const guard = useContext(GuardContext);
  if (!guard) throw new Error('useDialogGuard must be used inside a GuardedDialog.');
  const { setDirty, requestClose } = guard;
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);
  return requestClose;
}
