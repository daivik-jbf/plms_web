import { Link } from 'react-router-dom';
import { type AuditEntry, filtersToParams } from '../../api/audit';
import { Table } from '../../components/Table';
import { formatDateTime, formatExactUtc, formatValue } from '../../lib/format';
import styles from './AuditPage.module.css';
import { sourceLabel } from './AuditTable';

const roleLabel = (role: string | null): string => (role === 'admin' ? ' (Admin)' : role === 'staff' ? ' (Staff)' : '');

interface AuditDetailsProps {
  entry: AuditEntry;
  // Called with the search part of the link's address (without the '?').
  onNavigate: (search: string) => void;
}

export function AuditDetails({ entry, onNavigate }: AuditDetailsProps) {
  const actorName = entry.actor?.name ?? entry.actor?.label ?? 'System';
  const personId = entry.actor?.id ?? (entry.target?.type === 'user' ? entry.target.id : null);
  const personName = entry.actor?.id ? actorName : (entry.target?.name ?? entry.target?.label ?? 'this person');
  const changes = entry.changes ? Object.entries(entry.changes) : [];
  const involving = personId ? filtersToParams({ involving: personId }).toString() : null;

  return (
    <>
      <p>{entry.summary}</p>
      <dl className={styles.details}>
        <dt>When</dt>
        <dd>
          {formatDateTime(entry.occurredAt)}
          <span className={styles.muted}>{formatExactUtc(entry.occurredAt)}</span>
        </dd>
        <dt>Who</dt>
        <dd>{`${actorName}${roleLabel(entry.actor?.role ?? null)}`}</dd>
        {entry.target ? (
          <>
            <dt>Target</dt>
            <dd>{`${entry.target.type === 'user' ? 'User' : entry.target.type === 'invite' ? 'Invite' : entry.target.type}: ${entry.target.name ?? entry.target.label ?? entry.target.id}`}</dd>
          </>
        ) : null}
        <dt>From</dt>
        <dd>{[sourceLabel(entry.source), entry.ip].filter(Boolean).join(' · ')}</dd>
        {entry.appVersion ? (
          <>
            <dt>App version</dt>
            <dd>{entry.appVersion}</dd>
          </>
        ) : null}
        {entry.userAgent ? (
          <>
            <dt>Device</dt>
            <dd>{entry.userAgent}</dd>
          </>
        ) : null}
        {entry.requestId ? (
          <>
            <dt>Request</dt>
            <dd>{entry.requestId}</dd>
          </>
        ) : null}
      </dl>

      {changes.length > 0 ? (
        <Table caption="Changes">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {changes.map(([field, change]) => (
              <tr key={field}>
                <td data-label="Field">{field}</td>
                <td data-label="Before" className={styles.before}>
                  {formatValue(change.before)}
                </td>
                <td data-label="After" className={styles.after}>
                  {formatValue(change.after)}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      {entry.metadata ? <pre className={styles.metadata}>{JSON.stringify(entry.metadata, null, 2)}</pre> : null}

      {involving ? (
        <p>
          <Link to={{ pathname: '/audit', search: `?${involving}` }} onClick={() => onNavigate(involving)}>
            {`View all of ${personName}'s activity`}
          </Link>
        </p>
      ) : null}
    </>
  );
}
