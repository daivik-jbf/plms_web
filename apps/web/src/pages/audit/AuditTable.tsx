import type { AuditEntry } from '../../api/audit';
import { Badge } from '../../components/Badge';
import { Table } from '../../components/Table';
import { formatDateTime } from '../../lib/format';
import styles from './AuditPage.module.css';

const personOf = (entry: AuditEntry): { name: string; role: string | null } => ({
  name: entry.actor?.name ?? entry.actor?.label ?? 'System',
  role: entry.actor?.role ? (entry.actor.role === 'admin' ? 'Admin' : 'Staff') : null,
});

export const sourceLabel = (source: string): string => (source === 'mobile' ? 'App' : source === 'system' ? 'System' : 'Portal');

interface AuditTableProps {
  entries: AuditEntry[];
  onOpen: (entry: AuditEntry) => void;
}

export function AuditTable({ entries, onOpen }: AuditTableProps) {
  return (
    <Table caption="Audit log">
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Person</th>
          <th scope="col">Action</th>
          <th scope="col">What happened</th>
          <th scope="col">From</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const person = personOf(entry);
          return (
            <tr key={entry.id} className={styles.row} onClick={() => onOpen(entry)}>
              <td data-label="Time">
                <time dateTime={entry.occurredAt}>{formatDateTime(entry.occurredAt)}</time>
              </td>
              <td data-label="Person">
                <span className={styles.name}>{person.name}</span>
                {person.role ? <span className={styles.muted}>{person.role}</span> : null}
              </td>
              <td data-label="Action">
                <Badge tone={entry.tone}>{entry.label}</Badge>
              </td>
              <td data-label="What happened">
                <button type="button" className={styles.summary}>
                  {entry.summary}
                </button>
              </td>
              <td data-label="From">{sourceLabel(entry.source)}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
