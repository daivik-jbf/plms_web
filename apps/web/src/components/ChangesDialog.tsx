import { Button } from './Button';
import styles from './ChangesDialog.module.css';
import { Dialog } from './Dialog';

export interface Change {
  field: string;
  before: string;
  after: string;
}

interface ChangesDialogProps {
  open: boolean;
  changes: Change[];
  onConfirm: () => void;
  onBack: () => void;
}

const SHOWN = 240;
const NOTHING = 'Nothing';

// Long text is shortened in the list; the full text is in the field the person came from.
const shown = (text: string): string => (text.length > SHOWN ? `${text.slice(0, SHOWN)}…` : text);

// What is about to change, field by field, shown before anything is saved.
export function ChangesDialog({ open, changes, onConfirm, onBack }: ChangesDialogProps) {
  return (
    <Dialog open={open} onClose={onBack} title="Review your changes">
      <p>These changes will be saved:</p>
      <ul className={styles.list}>
        {changes.map((change) => (
          <li key={change.field} className={styles.item}>
            <strong>{change.field}</strong>
            <span className={styles.before}>
              <span className={styles.tag}>Before</span>
              {shown(change.before)}
            </span>
            <span className={styles.after}>
              <span className={styles.tag}>After</span>
              {shown(change.after)}
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        {/* The safe choice has focus when the dialog opens, so a stray Enter never confirms. */}
        <Button variant="secondary" onClick={onBack} data-autofocus>
          Back
        </Button>
        <Button onClick={onConfirm}>Confirm and save</Button>
      </div>
    </Dialog>
  );
}

const textOf = (value: string): string => (value ? value : NOTHING);

// A title or description: the change to list, or null when the text is the same once trimmed.
export function textChange(field: string, before: string | null | undefined, after: string): Change | null {
  const was = (before ?? '').trim();
  const now = after.trim();
  return was === now ? null : { field, before: textOf(was), after: textOf(now) };
}

// A new cover picture: there is no text to compare, so it says whether a picture is being replaced.
export function coverChange(hadCover: boolean, file: File | null): Change | null {
  return file ? { field: 'Cover image', before: hadCover ? 'The current cover' : NOTHING, after: `New picture: ${file.name}` } : null;
}

// The changes that were made, without the fields that stayed the same.
export const changesOf = (...all: (Change | null)[]): Change[] => all.filter((change): change is Change => change !== null);
