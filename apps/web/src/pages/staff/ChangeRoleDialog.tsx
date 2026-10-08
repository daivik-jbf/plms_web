import { type FormEvent, useState } from 'react';
import type { Person, Role } from '../../api/staff';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
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
    <Dialog open={person !== null} onClose={onClose} title="Change role" blocked={busy}>
      {person ? <RoleForm person={person} busy={busy} error={error} onSave={onSave} onClose={onClose} /> : null}
    </Dialog>
  );
}

function RoleForm({ person, busy, error, onSave, onClose }: Omit<ChangeRoleDialogProps, 'person'> & { person: Person }) {
  const [role, setRole] = useState<Role>(person.role);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    onSave(role);
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
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy} disabled={role === person.role}>
          Save
        </Button>
      </div>
    </form>
  );
}
