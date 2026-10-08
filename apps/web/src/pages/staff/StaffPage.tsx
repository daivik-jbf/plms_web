import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeError } from '../../api/client';
import {
  cancelInvite,
  changeRole,
  deactivatePerson,
  type Invite,
  listInvites,
  listPeople,
  type Person,
  reactivatePerson,
  resendInvite,
  type Role,
} from '../../api/staff';
import { useAuth } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { Tabs } from '../../components/Tabs';
import { TextField } from '../../components/TextField';
import { ChangeRoleDialog } from './ChangeRoleDialog';
import { InviteDialog } from './InviteDialog';
import { InvitesTable } from './InvitesTable';
import { PeopleTable } from './PeopleTable';
import styles from './StaffPage.module.css';

type OpenDialog =
  | { kind: 'invite' }
  | { kind: 'role'; person: Person }
  | { kind: 'deactivate'; person: Person }
  | { kind: 'cancel'; invite: Invite }
  | null;

type Notice = { tone: 'error' | 'success'; text: string };

const matches = (filter: string, ...fields: string[]): boolean => {
  const needle = filter.trim().toLowerCase();
  return needle === '' || fields.some((field) => field.toLowerCase().includes(needle));
};

export function StaffPage() {
  const { state } = useAuth();
  const selfId = state.status === 'authenticated' ? state.user.id : '';
  const [people, setPeople] = useState<Person[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<'people' | 'invites'>('people');
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState<OpenDialog>(null);
  // Always the dialog that is open right now, so a request that settles later can tell whether its dialog is still there.
  const dialogRef = useRef<OpenDialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    try {
      const [loadedPeople, loadedInvites] = await Promise.all([listPeople(), listInvites()]);
      setPeople(loadedPeople);
      setInvites(loadedInvites.filter((invite) => invite.status === 'pending' || invite.status === 'expired'));
      setLoadError(null);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Opening or closing a dialog always starts without an error, so one never carries over to the next dialog.
  function openDialog(next: OpenDialog) {
    dialogRef.current = next;
    setDialog(next);
    setDialogError(null);
  }

  function closeDialog() {
    openDialog(null);
  }

  // Runs one action, reloads both lists, then closes the dialog; a failure is shown inside the dialog when one
  // is open, or on the page otherwise.
  async function perform(action: () => Promise<unknown>, success: string | null) {
    const startedIn = dialogRef.current;
    setBusy(true);
    setNotice(null);
    setDialogError(null);
    try {
      await action();
      await load();
      if (startedIn !== null && dialogRef.current === startedIn) closeDialog();
      if (success) setNotice({ tone: 'success', text: success });
    } catch (error) {
      const message = describeError(error);
      // The failure belongs in the dialog only while that same dialog is still open; otherwise nobody would see it.
      if (startedIn !== null && dialogRef.current === startedIn) setDialogError(message);
      else setNotice({ tone: 'error', text: message });
    } finally {
      setBusy(false);
    }
  }

  async function onInvited(email: string, warning?: string) {
    closeDialog();
    setTab('invites');
    await load();
    setNotice(warning ? { tone: 'error', text: warning } : { tone: 'success', text: `Invite sent to ${email}.` });
  }

  const visiblePeople = useMemo(() => (people ?? []).filter((p) => matches(filter, p.name, p.email)), [people, filter]);
  const visibleInvites = useMemo(() => (invites ?? []).filter((i) => matches(filter, i.name, i.email)), [invites, filter]);

  const deactivateTarget = dialog?.kind === 'deactivate' ? dialog.person : null;
  const cancelTarget = dialog?.kind === 'cancel' ? dialog.invite : null;

  return (
    <>
      <div className={styles.header}>
        <h1>Staff</h1>
        <Button onClick={() => openDialog({ kind: 'invite' })}>Invite person</Button>
      </div>

      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {loadError ? (
        <>
          <Alert tone="error">{loadError}</Alert>
          <Button
            variant="secondary"
            onClick={() => {
              setLoadError(null);
              void load();
            }}
          >
            Retry
          </Button>
        </>
      ) : people === null || invites === null ? (
        <Skeleton />
      ) : (
        <>
          <TextField label="Filter by name or email" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Tabs
            label="Staff sections"
            tabs={[
              { id: 'people', label: 'People', count: people.length },
              { id: 'invites', label: 'Invites', count: invites.length },
            ]}
            value={tab}
            onChange={(id) => setTab(id === 'invites' ? 'invites' : 'people')}
          >
            {tab === 'people' ? (
              visiblePeople.length === 0 ? (
                <EmptyState title="No one matches that filter">Clear the filter to see everyone.</EmptyState>
              ) : (
                <PeopleTable
                  people={visiblePeople}
                  selfId={selfId}
                  busy={busy}
                  onChangeRole={(person) => openDialog({ kind: 'role', person })}
                  onDeactivate={(person) => openDialog({ kind: 'deactivate', person })}
                  onReactivate={(person) => void perform(() => reactivatePerson(person.id), `${person.name} was reactivated.`)}
                />
              )
            ) : visibleInvites.length === 0 ? (
              <EmptyState title={invites.length === 0 ? 'No open invites' : 'No invites match that filter'}>
                {invites.length === 0 ? 'Use "Invite person" to add someone.' : 'Clear the filter to see every invite.'}
              </EmptyState>
            ) : (
              <InvitesTable
                invites={visibleInvites}
                busy={busy}
                onResend={(invite) => void perform(() => resendInvite(invite.id), `Invite resent to ${invite.email}.`)}
                onCancel={(invite) => openDialog({ kind: 'cancel', invite })}
              />
            )}
          </Tabs>
        </>
      )}

      <InviteDialog open={dialog?.kind === 'invite'} onClose={closeDialog} onInvited={(email, warning) => void onInvited(email, warning)} />

      <ChangeRoleDialog
        person={dialog?.kind === 'role' ? dialog.person : null}
        busy={busy}
        error={dialog?.kind === 'role' ? dialogError : null}
        onClose={closeDialog}
        onSave={(role: Role) => {
          if (dialog?.kind === 'role') {
            const person = dialog.person;
            void perform(() => changeRole(person.id, role), `${person.name} is now ${role === 'admin' ? 'an Admin' : 'Staff'}.`);
          }
        }}
      />

      <ConfirmDialog
        open={deactivateTarget !== null}
        title={deactivateTarget ? `Deactivate ${deactivateTarget.name}?` : 'Deactivate'}
        confirmLabel="Deactivate"
        tone="danger"
        busy={busy}
        error={deactivateTarget ? dialogError : null}
        onCancel={closeDialog}
        onConfirm={() => {
          if (deactivateTarget) void perform(() => deactivatePerson(deactivateTarget.id), `${deactivateTarget.name} was deactivated.`);
        }}
      >
        {deactivateTarget ? `${deactivateTarget.name} will be signed out immediately and cannot sign in until you reactivate them.` : ''}
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelTarget !== null}
        title={cancelTarget ? `Cancel invite for ${cancelTarget.name}?` : 'Cancel invite'}
        confirmLabel="Cancel invite"
        cancelLabel="Keep invite"
        tone="danger"
        busy={busy}
        error={cancelTarget ? dialogError : null}
        onCancel={closeDialog}
        onConfirm={() => {
          if (cancelTarget) void perform(() => cancelInvite(cancelTarget.id), `Invite for ${cancelTarget.email} was cancelled.`);
        }}
      >
        {cancelTarget ? `The link sent to ${cancelTarget.email} will stop working.` : ''}
      </ConfirmDialog>
    </>
  );
}
