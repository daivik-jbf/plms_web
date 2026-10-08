import type { Invite } from '../../api/staff';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import { formatDate } from '../../lib/format';
import styles from './StaffPage.module.css';

interface InvitesTableProps {
  invites: Invite[];
  busy: boolean;
  onResend: (invite: Invite) => void;
  onCancel: (invite: Invite) => void;
}

export function InvitesTable({ invites, busy, onResend, onCancel }: InvitesTableProps) {
  return (
    <Table caption="Invites">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Role</th>
          <th scope="col">Status</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {invites.map((invite) => (
          <tr key={invite.id}>
            <td data-label="Name">
              <span className={styles.name}>{invite.name}</span>
              <span className={styles.muted}>{invite.email}</span>
            </td>
            <td data-label="Role">{invite.role === 'admin' ? 'Admin' : 'Staff'}</td>
            <td data-label="Status">
              {invite.status === 'pending' ? (
                <Badge tone="change">{`Pending · expires ${formatDate(invite.expiresAt)}`}</Badge>
              ) : (
                <Badge tone="warning">Expired</Badge>
              )}
            </td>
            <td data-label="Actions">
              <div className={styles.actions}>
                <Button variant="secondary" size="small" disabled={busy} aria-label={`Resend invite to ${invite.name}`} onClick={() => onResend(invite)}>
                  Resend
                </Button>
                <Button variant="secondary" size="small" disabled={busy} aria-label={`Cancel invite for ${invite.name}`} onClick={() => onCancel(invite)}>
                  Cancel
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
