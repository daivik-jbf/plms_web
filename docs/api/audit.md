# JBF LMS API: audit log (milestone 2)

This is the hand-written contract for the audit log read side, written from the code (`apps/api/src/audit/`) and its end-to-end tests (`apps/api/test/audit*.e2e-spec.ts`). Authentication, token handling, the error body shape and the rate-limit rules are described in `docs/api/auth.md`; this page only adds what is specific to the audit log. A generated OpenAPI document is still planned for milestone 6 (see `PROGRESS.md`).

- Base path: every route starts with `/api`.
- Access: **Admin only**. No token gives 401 (`Unauthorized`). A Staff token gives 403 (`You do not have permission to do that.`). The server enforces this on all three endpoints; hiding the pages in the web app is only a convenience.
- Writing the log is not part of this API: entries are created by the server when things happen (sign-ins, invites, role changes and so on). The log is append-only; there is no endpoint to edit or delete entries.

| Method and path | Purpose | Success |
| --- | --- | --- |
| `GET /api/audit` | One page of entries, newest first, with filters | 200 JSON |
| `POST /api/audit/opened` | Record that an Admin opened the Audit log page | 204, no body |
| `GET /api/audit/export.csv` | Download the filtered entries as a CSV file | 200 `text/csv` |

## `GET /api/audit`

Returns one page of audit entries, newest first.

### Query parameters

All parameters are optional. Unknown parameters are ignored. A value that fails validation gives a 400 (see "Errors").

| Parameter | Type and rules | Default | Meaning |
| --- | --- | --- | --- |
| `limit` | integer 1 to 100 | `50` | Page size. `0`, `101` and non-numbers give 400 `fieldErrors.limit` |
| `cursor` | opaque string, at most 300 characters | none (first page) | Pass the `nextCursor` of the previous page. See "Paging" |
| `actorId` | UUID (upper or lower case) | none | Only entries performed by this user |
| `involving` | UUID (upper or lower case) | none | Entries performed by this user **or** done to this user (the target is a user with this id). Invite targets are not matched, even if the id is the same |
| `category` | `accounts`, `content`, `files` or `playback` | none | Only entries in this category (see the table below) |
| `action` | one of the 17 known actions listed below | none | Only entries with exactly this action. Any other value gives 400 `fieldErrors.action` |
| `from` | ISO 8601 date-time with a `Z` or an offset, for example `2026-03-02T00:00:00.000Z`; the year must be 0001 to 9999; up to microsecond precision is kept | none | Only entries at or after this instant (inclusive). A bare date such as `2026-03-02` is rejected, and so is year `0000` (400 `fieldErrors.from`) |
| `to` | same format and year range as `from` | none | Only entries at or before this instant (inclusive) |
| `q` | text, trimmed, at most 100 characters | none | Case-insensitive "contains" search over the actor label (the email or typed text), the target label, the action name, and the actor's and target's names. `%` and `_` are matched literally (they are not wildcards). An empty or all-space value is ignored |
| `includePlayback` | the text `true` or `false` | `false` | `false` is the "Changes only" view: entries in the `playback` category (playback and download events) are hidden. `true` shows them. `category=playback` always shows them |

Notes:

- Filters combine with AND.
- Known actions: `auth.login.succeeded`, `auth.login.failed`, `auth.logout`, `auth.logout_all`, `auth.refresh.reuse_detected`, `auth.password.changed`, `auth.password.reset_requested`, `auth.password.reset_completed`, `invite.created`, `invite.resent`, `invite.cancelled`, `invite.accepted`, `user.deactivated`, `user.reactivated`, `user.role_changed`, `audit.viewed`, `audit.exported`. The `action` filter accepts only these, even though the log can later contain others (see "Unknown actions").
- Categories come from the part of the action before the first dot: `content.*` is `content`, `file.*` is `files`, `playback.*` and `download.*` are `playback`, and everything else is `accounts`. Today every known action is `accounts`; the other categories are ready for later milestones.

### Response (200)

```json
{
  "items": [ { "...": "AuditEntryView, see below" } ],
  "nextCursor": "eyJ0IjoiMjAyNi0xMC0wOCAxMDo0MjoxMi4xMjM0NTYrMDAiLCJpZCI6IjBmM2M5ZTRhLTdiMmEtNGQ5ZS05YzFlLTVhNmQ4ZTJmMWE3YiJ9"
}
```

- `items`: at most `limit` entries, newest first.
- `nextCursor`: a string when there are more entries after this page, otherwise `null` (the last page, or an empty result).

### `AuditEntryView`

Every entry has exactly these 16 fields (`null` where nothing applies):

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | UUID string | Entry id |
| `occurredAt` | ISO 8601 string (UTC) | When it happened |
| `actor` | object or `null` | Who did it; `null` when the entry has no actor information at all. Fields: `id` (UUID or `null`), `role` (`admin`, `staff` or `null`), `label` (the email, or the text typed at a failed sign-in, or `null`), `name` (the person's current name from the users table, or `null` if there is no matching user) |
| `action` | string | The action name, for example `user.role_changed` |
| `label` | string | Short human label, for example `Role changed` |
| `tone` | `change`, `danger`, `warning`, `success` or `neutral` | Suggested styling |
| `category` | `accounts`, `content`, `files` or `playback` | Category of the action |
| `target` | object or `null` | What it was done to; `null` when the entry has no target. Fields: `type` (for example `user` or `invite`), `id` (string), `label` (string or `null`), `name` (the user's current name when the target is a user, else `null`) |
| `source` | string | `portal`, `mobile` or `system` |
| `ip` | string or `null` | Client IP address |
| `userAgent` | string or `null` | Client user agent |
| `appVersion` | string or `null` | Mobile app version (`X-App-Version`) |
| `requestId` | string or `null` | The request id (same value as the `X-Request-Id` header of the original request) |
| `changes` | object or `null` | Before and after values: `{ "<field>": { "before": ..., "after": ... } }` |
| `metadata` | object or `null` | Extra facts recorded with the action (for example `reason`, `rowCount`, `filters`) |
| `summary` | string | A plain-English sentence generated by the server |

Names are looked up when the page is read, so they show the person's current name, while `label` fields keep what was recorded at the time. Secrets (passwords, tokens) are never stored in the log, so none can appear here.

Example entry (a role change):

```json
{
  "id": "0f3c9e4a-7b2a-4d9e-9c1e-5a6d8e2f1a7b",
  "occurredAt": "2026-10-08T10:42:12.123Z",
  "actor": {
    "id": "6a1e0c52-3f55-4c0e-8f0d-2f4b9d1c7e10",
    "role": "admin",
    "label": "anita@example.org",
    "name": "Anita Rao"
  },
  "action": "user.role_changed",
  "label": "Role changed",
  "tone": "change",
  "category": "accounts",
  "target": {
    "type": "user",
    "id": "b7d2a5a1-61f3-4f0b-9a2c-0d9e3c4b8f21",
    "label": "ben@example.org",
    "name": "Ben Okoye"
  },
  "source": "portal",
  "ip": "203.0.113.7",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...",
  "appVersion": null,
  "requestId": "4b0f6a58-5a3c-4f37-9a52-2f0c6f1f0c11",
  "changes": { "role": { "before": "staff", "after": "admin" } },
  "metadata": null,
  "summary": "Anita Rao changed Ben Okoye's role from Staff to Admin"
}
```

### Paging

- Order: newest first, by time and then by id (both descending), so entries with the same timestamp keep one fixed order.
- It is keyset paging, not offset paging. The cursor holds the time (to the microsecond, exactly as the database stores it) and the id of the last entry on the page, and the next page is "everything strictly older than that". Because of this, new entries arriving while someone pages do not shift, repeat or skip entries: a page requested with the same cursor returns the same entries before and after new rows are added.
- The cursor is opaque: pass back exactly what you were given, with the same filters. Do not build, parse or store cursors long term.
- An invalid cursor gives a 400 with `fieldErrors.cursor`. That happens if it is not valid base64url JSON, is missing `t` or `id`, if `id` is not a UUID, or if `t` is not a real date and time (impossible values such as `2026-02-30 00:00:00+00` or `24:00:00` are rejected); the message is then `Invalid cursor.`. A cursor longer than 300 characters is also rejected, with the validator's own length message under the same key.
- Page through until `nextCursor` is `null`.

### How entries are presented

The server generates `label`, `tone`, `category` and `summary` for every entry, so clients (web, mobile) do not need their own copy. `summary` uses the person's name when known, else their label (email), else `The system` for a missing actor and `someone` for a missing target.

| Action | Label | Tone | Category | Summary |
| --- | --- | --- | --- | --- |
| `auth.login.succeeded` | Signed in | success | accounts | `<actor> signed in from the portal` (or `the app` when `source` is `mobile`) |
| `auth.login.failed` | Sign-in failed | warning | accounts | `Failed sign-in for <who> (<reason>)`; `<who>` is the person's name, else the typed email, else `an unknown email`. Reasons (from `metadata.reason`): `unknown_email` is "no account with that email", `wrong_password` is "wrong password", `locked` is "account is locked", `deactivated` is "account is deactivated"; when `metadata.locked` is `true` it adds ", account now locked". With no recognised reason: `Failed sign-in for <who>` |
| `auth.logout` | Signed out | neutral | accounts | `<actor> signed out` |
| `auth.logout_all` | Signed out everywhere | neutral | accounts | `<actor> signed out of all devices` |
| `auth.refresh.reuse_detected` | Session reuse detected | warning | accounts | `<actor>'s session was ended because an old session token was used again` |
| `auth.password.changed` | Password changed | change | accounts | `<actor> changed their password` |
| `auth.password.reset_requested` | Password reset requested | neutral | accounts | `<actor> requested a password reset` |
| `auth.password.reset_completed` | Password reset | change | accounts | `<actor> reset their password` |
| `invite.created` | Invite sent | change | accounts | `<actor> invited <target> as <Admin or Staff>` (the role comes from `metadata.role`; an unknown value is shown as is, a missing one as `unknown`) |
| `invite.resent` | Invite resent | change | accounts | `<actor> resent the invite to <target>` |
| `invite.cancelled` | Invite cancelled | danger | accounts | `<actor> cancelled the invite for <target>` |
| `invite.accepted` | Invite accepted | success | accounts | `<actor> accepted their invite and joined` |
| `user.role_changed` | Role changed | change | accounts | `<actor> changed <target>'s role from <Admin or Staff> to <Admin or Staff>` (from `changes.role`) |
| `user.deactivated` | Deactivated | danger | accounts | `<actor> deactivated <target>` |
| `user.reactivated` | Reactivated | success | accounts | `<actor> reactivated <target>` |
| `audit.viewed` | Viewed audit log | neutral | accounts | `<actor> opened the audit log` |
| `audit.exported` | Exported audit log | neutral | accounts | `<actor> exported <n> audit log row(s)` (`row` when n is 1; from `metadata.rowCount`; without a count: `<actor> exported audit log rows`) |

Unknown actions: an action that is not in the table (for example one written by a later milestone) is still returned. `label` is the raw action name, `tone` is `neutral`, `category` follows the prefix rule above, and `summary` is `<actor> performed <action>`. Clients should treat `tone` and `category` as closed sets but never assume `action` is a closed set.

## `POST /api/audit/opened`

Records that the signed-in Admin opened the Audit log page. No request body. Responds 204 with no body.

- Writes one `audit.viewed` entry (actor = the Admin, source from the request headers).
- The web Audit page calls it once when the page opens. It is not called for filter changes, "Load more", opening the details drawer or changing the URL, so there is one `audit.viewed` per page open (opening it again, for example by navigating away and back, is a new open). A client that shows the audit log should do the same.
- Calling it does not require any filters and does not read the log.

## `GET /api/audit/export.csv`

Downloads the entries as a CSV file. It accepts the same filter parameters as `GET /api/audit` (`actorId`, `involving`, `category`, `action`, `from`, `to`, `q`, `includePlayback`) with the same validation and defaults, so "Changes only" applies unless `includePlayback=true` or `category=playback`. It has no `limit` or `cursor`: everything that matches is exported, newest first. (`limit` and `cursor` are ignored if sent.)

Rate limit: 10 exports per minute per client IP (stricter than the global 120 per minute). All rate limits are off when the API runs with `THROTTLE_ENABLED=false` (meant for tests and local work only).

### Response (200)

- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="audit-log-YYYY-MM-DD.csv"`, where the date is the day of the export in UTC.
- The file is streamed in chunks of 1,000 rows, so memory stays flat for large exports.
- The server waits when the client reads slowly (backpressure) and stops quietly if the client disconnects part-way; that is not treated as a failure.
- If an unexpected error happens after streaming has started, the connection is closed without finishing the file, so a truncated download fails instead of looking complete. Validation and the row cap are checked before anything is sent.

### Format

- UTF-8 with a byte order mark (BOM, `EF BB BF`) at the start so Excel detects the encoding.
- Rows end with CRLF (`\r\n`). A header row comes first; an export with no matches is the header row alone.
- Cells containing a comma, a double quote, a CR or an LF are wrapped in double quotes, and double quotes inside are doubled (RFC 4180).
- Formula neutralizing: spreadsheet programs run cells that start like a formula, and some entries contain text typed by an attacker (a failed sign-in stores the email that was typed). So any cell whose text starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe (`'`). So is a cell that starts with a line feed. For example the cell text `=HYPERLINK("http://evil")` becomes `'=HYPERLINK("http://evil")` (before quoting; in the file that cell is then quoted as `"'=HYPERLINK(""http://evil"")"` because it contains double quotes). Empty values are empty cells.

Columns, in order:

| # | Column | Source |
| --- | --- | --- |
| 1 | `Time (UTC)` | `occurredAt`, ISO 8601 (for example `2026-10-08T10:42:12.123Z`) |
| 2 | `Person` | actor `name`, else actor `label` |
| 3 | `Role` | actor `role` |
| 4 | `Action` | `action` |
| 5 | `Label` | `label` |
| 6 | `Target type` | target `type` |
| 7 | `Target` | target `name`, else target `label` |
| 8 | `Source` | `source` |
| 9 | `IP` | `ip` |
| 10 | `App version` | `appVersion` |
| 11 | `Request id` | `requestId` |
| 12 | `Summary` | `summary` |
| 13 | `Changes` | `changes` as a JSON string |

`metadata`, `userAgent` and the ids are not exported.

### Snapshot and the row cap

- The server takes one database-clock timestamp when the export starts. The cap check, the row count recorded in the log and the rows streamed all describe that same set: entries written after that instant, including the `audit.exported` entry that this export records and any other concurrent activity, are not in the file, even when the filters would otherwise match them. So the file's data rows always equal the recorded `rowCount`.
- `AUDIT_EXPORT_MAX_ROWS` (environment setting of the API, default `50000`, must be a positive whole number) is the largest export allowed. Exactly the cap is allowed; one more is refused with **413** before anything is streamed.

### Errors

| Status | When | Body |
| --- | --- | --- |
| 400 | An invalid filter value | validation error with `fieldErrors` (see below); nothing is streamed and nothing is recorded |
| 401 / 403 | Not signed in / not an Admin | as above |
| 413 | More rows match than the cap | `{ "statusCode": 413, "error": "Payload Too Large", "message": "Too many rows to export (limit 50,000). Narrow the filters.", "requestId": "..." }` (the number is the configured `AUDIT_EXPORT_MAX_ROWS`, printed with a thousands separator; no entry is recorded) |
| 429 | More than 10 exports per minute from one IP | see "Errors" below |

## Logging the use of the log

Reading the audit log is itself audited:

- `POST /api/audit/opened` records one `audit.viewed` entry per page open (actor = the Admin). `GET /api/audit` itself records nothing, so paging and filtering do not flood the log.
- Each successful export records one `audit.exported` entry with `metadata: { filters, rowCount }`: the filters that were used (exactly the validated values; unset filters are omitted, `includePlayback` is recorded as a boolean) and the number of rows exported. The exported data is never copied into the log. A refused (413) or invalid (400) export records nothing.

## Errors

Error bodies follow the shape in `docs/api/auth.md`: `{ statusCode, error?, message, fieldErrors?, requestId }`.

400 validation failure (any bad parameter; several can be reported at once):

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "fieldErrors": { "cursor": ["Invalid cursor."] },
  "requestId": "4b0f6a58-5a3c-4f37-9a52-2f0c6f1f0c11"
}
```

`fieldErrors` is keyed by the parameter name (`limit`, `cursor`, `actorId`, `involving`, `category`, `action`, `from`, `to`, `q`, `includePlayback`); the message texts come from the validator and may change, so rely on the key.

| Status | Meaning |
| --- | --- |
| 400 | Invalid parameter (above) |
| 401 | Missing, invalid or expired access token, or the user is deactivated |
| 403 | Signed in as Staff |
| 413 | Export larger than `AUDIT_EXPORT_MAX_ROWS` (export only) |
| 429 | Rate limited (unless `THROTTLE_ENABLED=false`). The global limit is 120 requests per minute per IP, and `export.csv` allows 10 per minute. The body is `{ "statusCode": 429, "message": "ThrottlerException: Too Many Requests", "requestId": "..." }` (no `error` field). Back off and retry after a minute |

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `AUDIT_EXPORT_MAX_ROWS` | `50000` | Largest CSV export allowed (positive integer). Set in `apps/api/.env`; see `apps/api/.env.example` |

## Database notes

The list uses the index `audit_log_paging_idx` on `(occurred_at DESC NULLS LAST, id DESC NULLS LAST)`; the query orders `DESC NULLS LAST` so that Postgres can use it. `audit_log_target_idx` on `target_id` supports `involving`. The `q` search is a sequential scan (fine at this size; add trigram indexes if volume grows). Names are joined at read time, so they would stop resolving if users were ever hard-deleted (they are only deactivated today).
