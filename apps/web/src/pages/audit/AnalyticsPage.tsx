import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ANALYTICS_PERIODS,
  type AuditAnalytics,
  DEFAULT_ANALYTICS_DAYS,
  exportAuditReport,
  getAuditAnalytics,
  markAuditOpened,
} from '../../api/audit';
import { describeError } from '../../api/client';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Select } from '../../components/Select';
import { Skeleton } from '../../components/Skeleton';
import { saveBlob } from '../../lib/download';
import { formatDateTime } from '../../lib/format';
import styles from './Analytics.module.css';
import { type BarDatum, ColumnChart, DataTable, RankedBars } from './charts';

const PERIOD_LABELS: Record<number, string> = {
  7: 'Last 7 days',
  30: 'Last 30 days',
  90: 'Last 90 days',
  365: 'Last 12 months',
};

const OPERATION_LABELS = {
  created: 'Added',
  edited: 'Edited',
  moved: 'Moved or reordered',
  deleted: 'Deleted',
  restored: 'Restored',
  purged: 'Permanently deleted',
} as const;

const CATEGORY_LABELS = { accounts: 'Accounts and access', content: 'Content changes', files: 'File uploads', playback: 'Playback' } as const;

const dayLabel = (day: string): string =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));

const hourLabel = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: AuditAnalytics };

function readDays(value: string | null): number {
  const days = Number(value);
  return (ANALYTICS_PERIODS as readonly number[]).includes(days) ? days : DEFAULT_ANALYTICS_DAYS;
}

export function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const days = readDays(params.get('days'));
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reloads, setReloads] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const pinged = useRef(false);

  // One "opened" marker per visit, as on the log itself (the ref also stops React StrictMode sending two).
  useEffect(() => {
    if (pinged.current) return;
    pinged.current = true;
    void markAuditOpened().catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    getAuditAnalytics(days)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [days, reloads]);

  async function onDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const { blob, filename } = await exportAuditReport(days);
      saveBlob(blob, filename);
    } catch (error) {
      setDownloadError(describeError(error));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div data-print-report>
      <div className={styles.header}>
        <h1>Audit analytics</h1>
        <div className={styles.actions} data-no-print>
          <Link to="/audit" className={styles.back}>
            Back to the audit log
          </Link>
          <Button variant="secondary" onClick={() => window.print()} disabled={state.status !== 'ready'}>
            Print or save as PDF
          </Button>
          <Button variant="secondary" busy={downloading} onClick={() => void onDownload()}>
            Download report (CSV)
          </Button>
        </div>
      </div>

      {downloadError ? <Alert tone="error">{downloadError}</Alert> : null}

      <div className={styles.periodRow} data-no-print>
        <Select label="Period" value={String(days)} onChange={(event) => setParams({ days: event.target.value }, { replace: true })}>
          {ANALYTICS_PERIODS.map((option) => (
            <option key={option} value={option}>
              {PERIOD_LABELS[option]}
            </option>
          ))}
        </Select>
      </div>

      {state.status === 'loading' ? (
        <Skeleton rows={6} />
      ) : state.status === 'error' ? (
        <>
          <Alert tone="error">{state.message}</Alert>
          <Button variant="secondary" onClick={() => setReloads((count) => count + 1)}>
            Retry
          </Button>
        </>
      ) : state.data.totals.events === 0 ? (
        <EmptyState title="No activity in this period">Pick a longer period, or come back once people have used the system.</EmptyState>
      ) : (
        <Report data={state.data} />
      )}
    </div>
  );
}

function Report({ data }: { data: AuditAnalytics }) {
  const { totals } = data;
  const daily: BarDatum[] = data.daily.map((row) => ({
    key: row.day,
    label: dayLabel(row.day),
    value: row.total,
    detail: dayLabel(row.day),
  }));
  const hourly: BarDatum[] = data.hourly.map((row) => ({
    key: String(row.hour),
    label: hourLabel(row.hour),
    value: row.total,
    detail: `${hourLabel(row.hour)} UTC`,
  }));
  const operations = (Object.keys(OPERATION_LABELS) as (keyof typeof OPERATION_LABELS)[]).map((key) => ({
    key,
    label: OPERATION_LABELS[key],
    value: data.byOperation[key],
  }));
  const categories = (Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]).map((key) => ({
    key,
    label: CATEGORY_LABELS[key],
    value: data.byCategory[key],
  }));
  const tiles: { label: string; value: number; alert?: boolean }[] = [
    { label: 'Events recorded', value: totals.events },
    { label: 'People active', value: totals.activePeople },
    { label: 'Content changes', value: totals.contentChanges },
    { label: 'Uploads finished', value: totals.uploadsFinished },
    { label: 'Failed sign-ins', value: totals.failedSignIns, alert: totals.failedSignIns > 0 },
    { label: 'Security events', value: totals.securityEvents, alert: totals.securityEvents > 0 },
  ];

  return (
    <>
      <p className={styles.range}>
        {formatDateTime(data.range.from)} to {formatDateTime(data.range.to)}. Charts group events by UTC day and hour.
      </p>

      <ul className={styles.tiles} aria-label="Totals for the period">
        {tiles.map((tile) => (
          <li key={tile.label} className={`${styles.tile} ${tile.alert ? styles.tileAlert : ''}`}>
            <span className={styles.tileValue}>{tile.value.toLocaleString()}</span>
            <span className={styles.tileLabel}>{tile.label}</span>
          </li>
        ))}
      </ul>

      <div className={styles.grid}>
        <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="a-daily">
          <h2 id="a-daily">Activity per day</h2>
          <p className={styles.panelNote}>Every recorded event, including playback.</p>
          <ColumnChart title="Events per day" data={daily} unit="events" />
          <DataTable summary="View as a table" heading={['Day', 'Events']} rows={daily.map((item) => [item.detail, item.value])} />
        </section>

        <section className={styles.panel} aria-labelledby="a-ops">
          <h2 id="a-ops">What changed</h2>
          <p className={styles.panelNote}>Content changes by kind: courses, topics, files and library items.</p>
          <RankedBars rows={operations} />
        </section>

        <section className={styles.panel} aria-labelledby="a-cats">
          <h2 id="a-cats">Where the activity is</h2>
          <p className={styles.panelNote}>All events by area.</p>
          <RankedBars rows={categories} />
        </section>

        <section className={styles.panel} aria-labelledby="a-actions">
          <h2 id="a-actions">Most common actions</h2>
          <p className={styles.panelNote}>The 15 actions that happened most.</p>
          <RankedBars rows={data.byAction.map((row) => ({ key: row.action, label: row.label, value: row.count }))} />
        </section>

        <section className={styles.panel} aria-labelledby="a-hours">
          <h2 id="a-hours">Busiest hours (UTC)</h2>
          <p className={styles.panelNote}>When people are working in the system.</p>
          <ColumnChart title="Events by hour of day" data={hourly} unit="events" />
          <DataTable summary="View as a table" heading={['Hour', 'Events']} rows={hourly.map((item) => [item.detail, item.value])} />
        </section>

        <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="a-people">
          <h2 id="a-people">Most active people</h2>
          <div className={styles.scroll}>
            <table className={styles.people}>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                  <th scope="col" className={styles.num}>
                    Events
                  </th>
                  <th scope="col">Last active</th>
                </tr>
              </thead>
              <tbody>
                {data.topPeople.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <Link to={`/audit?actorId=${person.id}`}>{person.name ?? person.label ?? 'Unknown'}</Link>
                      {person.name && person.label ? <div className={styles.muted}>{person.label}</div> : null}
                    </td>
                    <td>{person.role === 'admin' ? 'Admin' : person.role === 'staff' ? 'Staff' : '—'}</td>
                    <td className={styles.num}>{person.count.toLocaleString()}</td>
                    <td>{formatDateTime(person.lastActiveAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="a-security">
          <h2 id="a-security">Security</h2>
          <p className={styles.panelNote}>Failed sign-ins, reused sign-in tokens, role changes and deactivated accounts.</p>
          {data.security.byAction.length === 0 ? (
            <p className={styles.ok}>No security events in this period.</p>
          ) : (
            <>
              <RankedBars rows={data.security.byAction.map((row) => ({ key: row.action, label: row.label, value: row.count }))} />
              {data.security.failedSignInAddresses.length > 0 ? (
                <>
                  <h3 className={styles.alertLine}>Addresses with the most failed sign-ins</h3>
                  <RankedBars rows={data.security.failedSignInAddresses.map((row) => ({ key: row.ip, label: row.ip, value: row.count }))} />
                </>
              ) : null}
              <p className={styles.panelNote}>
                <Link to="/audit?category=accounts">Open the account activity in the audit log</Link>
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
