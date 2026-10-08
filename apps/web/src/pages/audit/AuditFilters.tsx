import { type FormEvent, useEffect, useState } from 'react';
import type { AuditFilters as Filters } from '../../api/audit';
import type { Person } from '../../api/staff';
import { Button } from '../../components/Button';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import styles from './AuditPage.module.css';

interface AuditFiltersProps {
  filters: Filters;
  people: Person[];
  personName?: string;
  onChange: (filters: Filters, options?: { focusHeading?: boolean }) => void;
}

export function AuditFilterBar({ filters, people, personName, onChange }: AuditFiltersProps) {
  const [search, setSearch] = useState(filters.q ?? '');
  const knownActor = !filters.actorId || people.some((person) => person.id === filters.actorId);

  // Keeps the box in step with the address (Clear filters, Back/Forward) without remounting, which would drop focus.
  useEffect(() => setSearch(filters.q ?? ''), [filters.q]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    onChange({ ...filters, q: search.trim() || undefined });
  }

  return (
    <div className={styles.filters}>
      {filters.involving ? (
        <p className={styles.chip}>
          <span>{`Activity of ${personName ?? 'this person'}`}</span>
          <button
            type="button"
            className={styles.chipRemove}
            aria-label={`Remove filter: Activity of ${personName ?? 'this person'}`}
            onClick={() => onChange({ ...filters, involving: undefined }, { focusHeading: true })}
          >
            ×
          </button>
        </p>
      ) : null}
      <div className={styles.filterRow}>
        <Select label="Person" value={filters.actorId ?? ''} onChange={(e) => onChange({ ...filters, actorId: e.target.value || undefined })}>
          <option value="">Anyone</option>
          {/* A person from the address who is not in the list (or the list failed) must not read as "Anyone". */}
          {knownActor ? null : <option value={filters.actorId}>Unknown person</option>}
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Select>
        <Select label="Category" value={filters.category ?? ''} onChange={(e) => onChange({ ...filters, category: e.target.value || undefined })}>
          <option value="">All categories</option>
          <option value="accounts">Accounts</option>
          <option value="content">Content</option>
          <option value="files">Files</option>
          <option value="playback">Playback</option>
        </Select>
        <TextField label="From" type="date" value={filters.from ?? ''} onChange={(e) => onChange({ ...filters, from: e.target.value || undefined })} />
        <TextField label="To" type="date" value={filters.to ?? ''} onChange={(e) => onChange({ ...filters, to: e.target.value || undefined })} />
      </div>
      <form role="search" className={styles.searchRow} onSubmit={submitSearch}>
        <TextField label="Search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} hint="Names, emails and action types" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={!filters.includePlayback}
          onChange={(e) => onChange({ ...filters, includePlayback: e.target.checked ? undefined : true })}
        />
        Changes only
      </label>
    </div>
  );
}
