import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AuditEntry, exportAudit, filtersFromParams, filtersToParams, listAudit, markAuditOpened, type AuditFilters } from '../../api/audit';
import { describeError } from '../../api/client';
import { listPeople, type Person } from '../../api/staff';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { saveBlob } from '../../lib/download';
import { AuditDetails } from './AuditDetails';
import { AuditFilterBar } from './AuditFilters';
import styles from './AuditPage.module.css';
import { AuditTable } from './AuditTable';

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: AuditEntry[]; nextCursor: string | null; loadingMore: boolean; moreError: string | null };

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const key = params.toString();
  const filters = useMemo(() => filtersFromParams(new URLSearchParams(key)), [key]);
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const pinged = useRef(false);

  // One "opened" marker per visit. The ref also keeps React StrictMode's double effect from sending two.
  useEffect(() => {
    if (pinged.current) return;
    pinged.current = true;
    void markAuditOpened().catch(() => undefined);
  }, []);

  useEffect(() => {
    listPeople().then(setPeople).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    listAudit(filters)
      .then((page) => {
        if (!cancelled) setState({ status: 'ready', items: page.items, nextCursor: page.nextCursor, loadingMore: false, moreError: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [filters, reloads]);

  const change = useCallback(
    (next: AuditFilters) => {
      setExportError(null);
      setParams(filtersToParams(next));
    },
    [setParams],
  );

  async function loadMore() {
    if (state.status !== 'ready' || !state.nextCursor) return;
    const { items, nextCursor } = state;
    setState({ ...state, loadingMore: true, moreError: null });
    try {
      const page = await listAudit(filters, nextCursor);
      setState({ status: 'ready', items: [...items, ...page.items], nextCursor: page.nextCursor, loadingMore: false, moreError: null });
    } catch (error) {
      setState({ status: 'ready', items, nextCursor, loadingMore: false, moreError: describeError(error) });
    }
  }

  async function onExport() {
    setExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await exportAudit(filters);
      saveBlob(blob, filename);
    } catch (error) {
      setExportError(describeError(error));
    } finally {
      setExporting(false);
    }
  }

  const hasFilters = params.toString() !== '';
  const personName = people.find((person) => person.id === filters.involving)?.name;

  return (
    <>
      <div className={styles.header}>
        <h1>Audit log</h1>
        <Button variant="secondary" busy={exporting} onClick={() => void onExport()}>
          Export CSV
        </Button>
      </div>

      {exportError ? <Alert tone="error">{exportError}</Alert> : null}

      <AuditFilterBar key={filters.q ?? ''} filters={filters} people={people} personName={personName} onChange={change} />

      {state.status === 'loading' ? (
        <Skeleton rows={6} />
      ) : state.status === 'error' ? (
        <>
          <Alert tone="error">{state.message}</Alert>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setReloads((count) => count + 1)}>
              Retry
            </Button>
            {hasFilters ? (
              <Button variant="secondary" onClick={() => change({})}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </>
      ) : state.items.length === 0 ? (
        <EmptyState title="No activity matches these filters">
          {hasFilters ? (
            <Button variant="secondary" onClick={() => change({})}>
              Clear filters
            </Button>
          ) : (
            'Activity appears here as people use the system.'
          )}
        </EmptyState>
      ) : (
        <>
          <AuditTable entries={state.items} onOpen={setSelected} />
          {state.moreError ? <Alert tone="error">{state.moreError}</Alert> : null}
          {state.nextCursor ? (
            <div className={styles.more}>
              <Button variant="secondary" busy={state.loadingMore} onClick={() => void loadMore()}>
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Dialog open={selected !== null} onClose={() => setSelected(null)} title={selected?.label ?? 'Details'} side="right">
        {selected ? <AuditDetails entry={selected} onNavigate={() => setSelected(null)} /> : null}
      </Dialog>
    </>
  );
}
