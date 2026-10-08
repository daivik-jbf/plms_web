import { Link } from 'react-router-dom';
import type { Person } from '../../api/staff';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import styles from './StaffPage.module.css';

interface PeopleTableProps {
  people: Person[];
  selfId: string;
  busy: boolean;
  onChangeRole: (person: Person) => void;
  onDeactivate: (person: Person) => void;
  onReactivate: (person: Person) => void;
}

export function PeopleTable({ people, selfId, busy, onChangeRole, onDeactivate, onReactivate }: PeopleTableProps) {
  return (
    <Table caption="People">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Role</th>
          <th scope="col">Status</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {people.map((person) => {
          const isSelf = person.id === selfId;
          const hintId = `self-hint-${person.id}`;
          return (
            <tr key={person.id}>
              <td data-label="Name">
                <span className={styles.name}>{person.name}</span>
                <span className={styles.muted}>{person.email}</span>
              </td>
              <td data-label="Role">{person.role === 'admin' ? 'Admin' : 'Staff'}</td>
              <td data-label="Status">
                <Badge tone={person.status === 'active' ? 'success' : 'neutral'}>
                  {person.status === 'active' ? 'Active' : 'Deactivated'}
                </Badge>
              </td>
              <td data-label="Actions">
                <div className={styles.actions}>
                  <Button variant="secondary" size="small" disabled={busy || isSelf} aria-describedby={isSelf ? hintId : undefined} aria-label={`Change role for ${person.name}`} onClick={() => onChangeRole(person)}>
                    Change role
                  </Button>
                  {person.status === 'active' ? (
                    <Button variant="secondary" size="small" disabled={busy || isSelf} aria-describedby={isSelf ? hintId : undefined} aria-label={`Deactivate ${person.name}`} onClick={() => onDeactivate(person)}>
                      Deactivate
                    </Button>
                  ) : (
                    <Button variant="secondary" size="small" disabled={busy} aria-label={`Reactivate ${person.name}`} onClick={() => onReactivate(person)}>
                      Reactivate
                    </Button>
                  )}
                  <Link className={styles.link} to={`/audit?involving=${person.id}`} aria-label={`View activity for ${person.name}`}>
                    View activity
                  </Link>
                </div>
                {isSelf ? (
                  <span id={hintId} className={styles.muted}>
                    Ask another Admin to change your access.
                  </span>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
