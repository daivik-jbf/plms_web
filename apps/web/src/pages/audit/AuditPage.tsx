import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AuditEntry, exportAudit, filtersFromParams, filtersToParams, listAudit, markAuditOpened, type AuditFilters } from '../../api/audit';
import { ApiError, describeError } from '../../api/client';
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

// Every query parameter the Audit page sends: a 400 naming one of them means the address itself is bad.
const FILTER_KEYS = new Set(['involving', 'actorId', 'category', 'action', 'from', 'to', 'q', 'includePlayback', 'cursor']);
const BAD_ADDRESS = 'Some filters in this address are not valid. Clear filters to start again.';

function listError(error: unknown): string {
  if (error instanceof ApiError && error.status === 400 && Object.keys(error.fieldErrors).some((key) => FILTER_KEYS.has(key))) {
    return BAD_ADDRESS;
  }
  return describeError(error);
}

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
  const heading = useRef<HTMLHeadingElement>(null);
  // Set when the control the person used goes away while the list reloads (Retry, Clear filters, the chip's remove
  // button, the drawer's link); focus then moves to the heading instead of being lost to the page body.
  const focusHeadingAfterLoad = useRef(false);
  // Bumped whenever the list is reloaded, so a slow "Load more" for an older list can tell it is stale.
  const generation = useRef(0);

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
    generation.current += 1;
    setState({ status: 'loading' });
    listAudit(filters)
      .then((page) => {
        if (!cancelled) setState({ status: 'ready', items: page.items, nextCursor: page.nextCursor, loadingMore: false, moreError: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: listError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [filters, reloads]);

  useEffect(() => {
    if (state.status === 'loading' || !focusHeadingAfterLoad.current) return;
    focusHeadingAfterLoad.current = false;
    heading.current?.focus();
  }, [state.status]);

  const change = useCallback(
    (next: AuditFilters, options: { focusHeading?: boolean } = {}) => {
      setExportError(null);
      const nextParams = filtersToParams(next);
      // Only a change of address reloads the list, so only then is there a load to wait for.
      if (options.focusHeading && nextParams.toString() !== key) focusHeadingAfterLoad.current = true;
      setParams(nextParams);
    },
    [key, setParams],
  );

  function retry() {
    focusHeadingAfterLoad.current = true;
    setReloads((count) => count + 1);
  }

  function followDrawerLink(search: string) {
    if (search !== key) focusHeadingAfterLoad.current = true;
    setSelected(null);
  }

  async function loadMore() {
    if (state.status !== 'ready' || !state.nextCursor || state.loadingMore) return;
    const { items, nextCursor } = state;
    const started = generation.current;
    setState({ ...state, loadingMore: true, moreError: null });
    try {
      const page = await listAudit(filters, nextCursor);
      if (started !== generation.current) return;
      setState({ status: 'ready', items: [...items, ...page.items], nextCursor: page.nextCursor, loadingMore: false, moreError: null });
    } catch (error) {
      if (started !== generation.current) return;
      setState({ status: 'ready', items, nextCursor, loadingMore: false, moreError: listError(error) });
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

  // Unknown keys in the address are ignored everywhere, so they do not count as filters either.
  const hasFilters = filtersToParams(filters).toString() !== '';
  const personName = people.find((person) => person.id === filters.involving)?.name;

  return (
    <>
      <div className={styles.header}>
        <h1 ref={heading} tabIndex={-1}>
          Audit log
        </h1>
        <Button variant="secondary" busy={exporting} onClick={() => void onExport()}>
          Export CSV
        </Button>
      </div>

      {exportError ? <Alert tone="error">{exportError}</Alert> : null}

      <AuditFilterBar filters={filters} people={people} personName={personName} onChange={change} />

      {state.status === 'loading' ? (
        <Skeleton rows={6} />
      ) : state.status === 'error' ? (
        <>
          <Alert tone="error">{state.message}</Alert>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={retry}>
              Retry
            </Button>
            {hasFilters ? (
              <Button variant="secondary" onClick={() => change({}, { focusHeading: true })}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </>
      ) : state.items.length === 0 ? (
        <EmptyState title="No activity matches these filters">
          {hasFilters ? (
            <Button variant="secondary" onClick={() => change({}, { focusHeading: true })}>
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
        {selected ? <AuditDetails entry={selected} onNavigate={followDrawerLink} /> : null}
      </Dialog>
    </>
  );
}
