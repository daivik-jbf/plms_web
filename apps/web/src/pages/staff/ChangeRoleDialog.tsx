import { type FormEvent, useState } from 'react';
import type { Person, Role } from '../../api/staff';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { type Change, ChangesDialog } from '../../components/ChangesDialog';
import { GuardedDialog, useDialogGuard } from '../../components/GuardedDialog';
import { Select } from '../../components/Select';
import styles from './StaffPage.module.css';

interface ChangeRoleDialogProps {
  person: Person | null;
  busy: boolean;
  error: string | null;
  onSave: (role: Role) => void;
  onClose: () => void;
}

export function ChangeRoleDialog({ person, busy, error, onSave, onClose }: ChangeRoleDialogProps) {
  return (
    <GuardedDialog discard="Discard the role change?" open={person !== null} onClose={onClose} title="Change role" blocked={busy}>
      {person ? <RoleForm person={person} busy={busy} error={error} onSave={onSave} /> : null}
    </GuardedDialog>
  );
}

const ROLE_NAMES: Record<Role, string> = { staff: 'Staff', admin: 'Admin' };

function RoleForm({ person, busy, error, onSave }: Omit<ChangeRoleDialogProps, 'person' | 'onClose'> & { person: Person }) {
  const [role, setRole] = useState<Role>(person.role);
  const [reviewing, setReviewing] = useState(false);
  const dirty = role !== person.role;
  const review: Change[] = dirty ? [{ field: 'Role', before: ROLE_NAMES[person.role], after: ROLE_NAMES[role] }] : [];
  const requestClose = useDialogGuard(dirty);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (dirty) setReviewing(true);
  }

  return (
    <form onSubmit={onSubmit}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <p>
        Choose what <strong>{person.name}</strong> can do. Admins can manage people and read the audit log.
      </p>
      <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        <option value="staff">Staff</option>
        <option value="admin">Admin</option>
      </Select>
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={requestClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy} disabled={role === person.role}>
          Save
        </Button>
      </div>
      <ChangesDialog
        open={reviewing}
        changes={review}
        onBack={() => setReviewing(false)}
        onConfirm={() => {
          setReviewing(false);
          onSave(role);
        }}
      />
    </form>
  );
}
