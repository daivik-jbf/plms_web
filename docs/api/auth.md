# JBF LMS API: authentication, invites and users (milestone 1)

This is the hand-written contract for everything the API exposes in milestone 1. It was written from the code and its end-to-end tests. A generated OpenAPI document is planned for milestone 6 (see `PROGRESS.md`).

- Base path: every route starts with `/api` (for example `POST /api/auth/login`).
- Format: JSON requests and responses (`Content-Type: application/json`). Timestamps are ISO 8601 strings in UTC.
- Emails are trimmed and lower-cased by the server before use.
- Roles: `admin` and `staff`.

## For the mobile developer: read this first

- Mobile always sends `"client": "mobile"` in login/refresh/logout bodies and the headers `X-Client: mobile` and `X-App-Version: <version>`.
  - If `client` is left out it defaults to `"web"`, and the server then sets a cookie instead of returning the refresh token. Always send it.
- Access token lifetime is 900 seconds; call refresh when a request returns 401, then retry once.
- Refresh tokens rotate on every refresh: always store the newest one. Two refreshes with the same token in quick succession will fail for the second one, so serialize refresh calls.
  - In practice: keep one refresh in flight at a time (a mutex or a shared promise). Requests that hit 401 while a refresh is running should wait for it and then retry with the new access token. Never refresh from two threads, two screens or a background task and the foreground at once.
  - A refresh token that was already used is rejected. If an already-used token is presented again more than 10 seconds after it was rotated, the server treats it as theft and revokes that whole session; the user must sign in again.
  - Refresh tokens last 30 days from the last refresh.
- Error bodies look like `{ statusCode, error, message, fieldErrors?, requestId }`; show `message`, and quote `requestId` in support requests.
  - `error` and `fieldErrors` are only present on some errors (see "Errors" below).
- A deactivated user receives 401 on every call and on refresh; the app should sign out, but downloaded files remain on the device.

## Authentication model

| Item | Value |
| --- | --- |
| Access token | Signed JWT, sent as `Authorization: Bearer <accessToken>` |
| Access token lifetime | 900 seconds (15 minutes). The login and refresh responses return it as `expiresIn` |
| Refresh token | Opaque random string, 30 days, single use (rotates on every refresh) |
| Web refresh token | Never in JSON. Sent by the server as an HttpOnly cookie `jbf_rt` (`SameSite=Strict`, `Secure` in production, path `/api/auth`) |
| Mobile refresh token | Returned in the JSON body as `refreshToken` and sent back in the body |

The server checks the database on every authenticated request. Deactivating a user or changing their role takes effect on the very next request, even if the access token has not expired.

Endpoints are private by default. In this document, "Public" means no token is needed, "Any signed-in user" means a valid access token, and "Admin" means a valid access token for a user whose role is `admin` (Staff get 403).

### Web-only rules

These do not affect mobile, but they explain some responses:

- Web refresh and logout read the refresh token from the cookie, and they require the header `X-Requested-With: jbf-web`. Without it they return 403 `Missing required header.`.
- The cookie is `SameSite=Strict`, so the web app and the API must be hosted under the same site (for example `app.example.org` and `api.example.org`).
- CORS only allows the configured web origin. Native apps are not affected by CORS.

### Request headers

| Header | Who | Purpose |
| --- | --- | --- |
| `Authorization: Bearer <accessToken>` | all signed-in calls | identifies the user |
| `X-Client: mobile` | mobile, every request | recorded in the audit log as the source |
| `X-App-Version: <version>` | mobile, every request | recorded in the audit log |
| `X-Requested-With: jbf-web` | web, refresh and logout | required by the server (403 without it) |

Every response carries `X-Request-Id`, the same value as `requestId` in error bodies.

## Errors

Error bodies look like `{ statusCode, error, message, fieldErrors?, requestId }`.

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "fieldErrors": { "newPassword": ["Use at least 10 characters."] },
  "requestId": "4b0f6a58-5a3c-4f37-9a52-2f0c6f1f0c11"
}
```

- `message` is written for people: show it.
- `fieldErrors` appears on 400 validation failures: an object mapping a field name to a list of messages. A problem with the whole body uses the key `_`.
- `error` is the standard status text. It is missing on a few responses (plain 401 `Unauthorized`, 404 `Not Found` and 429 throttling), so do not rely on it. Rely on `statusCode` and `message`.
- `requestId`: always present. Quote it in support requests.
- 500 bodies never contain internal details: `{ statusCode: 500, error: "Internal Server Error", message: "Something went wrong. Please try again.", requestId }`.

Common statuses on every endpoint:

| Status | Meaning |
| --- | --- |
| 400 | Invalid body, invalid link token, or a path id that is not a UUID |
| 401 | Missing, invalid or expired access token, or the user is deactivated (`message`: `Unauthorized`) |
| 403 | Signed in but not allowed (`You do not have permission to do that.`) |
| 413 / 415 | Body too large / unsupported content type |
| 429 | Rate limited (see below) or account temporarily locked |

## Rate limits and lockout

Limits are counted per client IP address, per minute.

| Endpoints | Limit |
| --- | --- |
| `login`, `refresh`, `logout` | 20 per minute |
| `forgot-password`, `reset-password`, `invites/preview`, `invites/accept` | 10 per minute |
| everything else | 120 per minute (global) |

Any call can therefore return **429**. Throttled responses look like `{ statusCode: 429, message: "ThrottlerException: Too Many Requests", requestId }`. Back off, wait a minute and try again; do not retry in a tight loop. On a shared network (such as a facility Wi-Fi) many users share one IP, so the app should handle 429 gracefully.

Account lockout: 5 wrong passwords in a row lock the account for 15 minutes. While locked, every login attempt (even with the right password) returns **429** with `Too many failed attempts. Try again in 15 minutes.`. A successful login resets the counter. An Admin reactivating a user, or a completed password reset, clears the lock.

## Password rules

- 10 to 128 characters (counted as characters, not bytes). Spaces are allowed inside a password.
- Not only spaces.
- Not on the common-password list (the comparison ignores upper and lower case).
- No other composition rules (no required symbols or digits).

A password that breaks a rule gets a 400 with the message under `fieldErrors.password` (invite accept) or `fieldErrors.newPassword` (reset and change). `GET /api/auth/password-policy` is public and returns the current length limits so clients can show a hint.

## Link lifetimes

- Invite links: 7 days. Resending an invite issues a new link (7 days again) and the old link stops working.
- Password reset links: 1 hour, single use. Requesting a new reset invalidates earlier unused links.

---

## Shared types

```ts
type Role = 'admin' | 'staff';

interface AuthUser {
  id: string;        // UUID
  email: string;
  name: string;
  role: Role;
}

interface LoginResponse {          // mobile
  user: AuthUser;
  accessToken: string;
  expiresIn: number;               // seconds, 900
  refreshToken: string;            // store it; it is replaced on every refresh
}
// Web gets the same body without refreshToken (the cookie carries it).

interface InviteView {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'pending' | 'expired' | 'accepted' | 'cancelled';
  expiresAt: string;
  createdAt: string;
  invitedBy: string | null;        // user id, null when created from the command line
}

interface UserView {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'active' | 'deactivated';
  createdAt: string;
}
```

---

## Auth endpoints

### POST /api/auth/login

Auth: Public. Rate limit 20/min.

Request:

```json
{ "email": "person@example.org", "password": "their password", "client": "mobile" }
```

`email` must be a valid address (max 254). `password` is required (1 to 1024 characters; the login form does not apply the password rules). `client` is `"web"` or `"mobile"` (default `"web"`).

Success `200`: `LoginResponse` for mobile. For web the body is `{ user, accessToken, expiresIn }` and the refresh token is set in the `jbf_rt` cookie.

Errors:

- `400` validation (`fieldErrors.email`, `fieldErrors.password`).
- `401` `Invalid email or password.` Used for a wrong password, an unknown email and a deactivated account alike, so the response never reveals which accounts exist.
- `429` the account is locked (`Too many failed attempts. Try again in 15 minutes.`) or the IP is rate limited.

### POST /api/auth/refresh

Auth: Public (the refresh token is the credential). Rate limit 20/min.

Request (mobile): `{ "client": "mobile", "refreshToken": "<latest refresh token>" }`

Request (web): `{ "client": "web" }` with header `X-Requested-With: jbf-web`; the refresh token comes from the cookie.

Success `200`: same body as login with a new `accessToken` and (mobile) a new `refreshToken`. Web gets the new cookie.

Errors:

- `401` `Session expired. Please sign in again.` The token is missing, unknown, expired, already used, revoked, or the user is deactivated. Sign the user out (mobile: delete the stored tokens). On web the cookie is cleared.
- `403` `Missing required header.` (web without `X-Requested-With: jbf-web`).
- `400`, `429` as above.

Remember: serialize refresh calls and store the newest refresh token (see the top of this document).

### POST /api/auth/logout

Auth: Public (works even when the access token has expired). Rate limit 20/min.

Request: same shape as refresh (mobile sends `refreshToken` in the body; web sends the header and the cookie).

Success `204`, no body. It ends this device's session (the whole refresh chain). It also returns 204 if the token is missing, unknown or already revoked, so it is safe to call repeatedly. Web also clears the cookie. The mobile app should delete its stored tokens regardless of the result.

Errors: `403` `Missing required header.` (web without the header), `400`, `429`.

### POST /api/auth/logout-all

Auth: Any signed-in user.

Request: no body.

Success `204`. Revokes every refresh token the user has, on every device. Access tokens already issued keep working until they expire (at most 15 minutes), but they cannot be refreshed.

Errors: `401`.

### POST /api/auth/forgot-password

Auth: Public. Rate limit 10/min.

Request: `{ "email": "person@example.org" }`

Success `202`: `{ "message": "If an account exists for that email, a reset link has been sent." }`. The response is identical whether or not the account exists. Only active users get an email. The link is valid for 1 hour.

Errors: `400` (invalid email format), `429`.

### POST /api/auth/reset-password

Auth: Public. Rate limit 10/min.

Request: `{ "token": "<token from the reset link>", "newPassword": "..." }`

Success `204`. Sets the new password, clears any lockout and signs the user out everywhere (all refresh tokens are revoked). The user must then sign in with the new password.

Errors:

- `400` `This reset link is invalid or has expired.` (unknown, used, expired, or the user is deactivated).
- `400` validation, with the password rule message in `fieldErrors.newPassword`.
- `429`.

### POST /api/auth/change-password

Auth: Any signed-in user.

Request: `{ "currentPassword": "...", "newPassword": "..." }`

Success `204`. Signs the user out everywhere, including this device: the refresh token stops working, so the app should send the user to the sign-in screen and sign in again with the new password.

Errors:

- `400` with `fieldErrors.currentPassword: ["Current password is incorrect."]`.
- `400` with `fieldErrors.newPassword` when the new password breaks a rule.
- `401`.

### GET /api/auth/me

Auth: Any signed-in user.

Success `200`: `AuthUser`. Use it to read the current name and role after a refresh.

Errors: `401`.

### GET /api/auth/password-policy

Auth: Public. Counts against the global limit.

Success `200`: `{ "minLength": 10, "maxLength": 128 }`

---

## Invite endpoints

There is no self-signup. Admins invite people by email; the person opens the link, chooses a password and then signs in.

### POST /api/invites

Auth: Admin.

Request: `{ "email": "new.person@example.org", "name": "New Person", "role": "staff" }`

`name` is 1 to 100 characters: letters, spaces, hyphens and apostrophes.

Success `201`: `InviteView` (`status: "pending"`). An email with the link is sent; the link expires in 7 days.

Errors:

- `400` validation.
- `401`, `403`.
- `409` `A user with this email already exists.`
- `409` `An invite for this email is already pending. Resend or cancel it instead.`
- `502` `The invite was saved but the email could not be sent. Use Resend to try again.` (the invite exists; resend it).

### GET /api/invites

Auth: Admin.

Success `200`: `InviteView[]`, newest first, including accepted, cancelled and expired invites (check `status`).

Errors: `401`, `403`.

### POST /api/invites/:id/resend

Auth: Admin. No body.

Success `200`: `InviteView` with a fresh 7-day expiry. A new email is sent; the previous link no longer works. Works for pending and expired invites.

Errors: `400` (id is not a UUID), `401`, `403`, `404` `Invite not found.`, `409` `This invite has already been accepted or cancelled.`, `502` (email failed, invite saved).

### DELETE /api/invites/:id

Auth: Admin.

Success `204`. The invite is cancelled and its link stops working.

Errors: `400`, `401`, `403`, `404` `Invite not found.`, `409` `This invite has already been accepted or cancelled.`

### POST /api/invites/preview

Auth: Public. Rate limit 10/min.

Request: `{ "token": "<token from the invite link>" }`

Success `200`: `{ "name": "New Person", "email": "new.person@example.org" }` so the accept screen can greet the person.

Errors: `400` `This invite link is invalid or has expired.` (unknown, expired, cancelled or already used), `429`.

### POST /api/invites/accept

Auth: Public. Rate limit 10/min.

Request: `{ "token": "<token from the invite link>", "password": "..." }`

Success `201`: `AuthUser`. The account now exists but the person is not signed in; send them to the sign-in screen.

Errors: `400` `This invite link is invalid or has expired.`, `400` validation with the password rule message in `fieldErrors.password`, `429`.

---

## User endpoints

All user endpoints are Admin only (`401` without a token, `403` for Staff). The `:id` must be a UUID (otherwise `400`).

### GET /api/users

Success `200`: `UserView[]`, sorted by name, including deactivated users.

### PATCH /api/users/:id/role

Request: `{ "role": "admin" }` or `{ "role": "staff" }`

Success `200`: the updated `UserView`. Takes effect on the user's next request. Setting the role the user already has is a no-op that returns 200.

Errors: `400`, `404` `User not found.`, `409` `At least one active Admin is required.` (cannot demote the last active Admin).

### POST /api/users/:id/deactivate

No body. Success `200`: the updated `UserView` with `status: "deactivated"`. The user's sessions are revoked and every call they make returns 401 from then on. Calling it on an already-deactivated user returns 200.

Errors: `404`, `409` `At least one active Admin is required.` (cannot deactivate the last active Admin).

### POST /api/users/:id/reactivate

No body. Success `200`: the updated `UserView` with `status: "active"`. Also clears any lockout. The user signs in again with their existing password (use "Forgot password" if they do not remember it). Calling it on an active user returns 200.

Errors: `404`.

---

## Health checks

Both are public.

- `GET /api/health` returns `200 { "status": "ok" }` when the process is running.
- `GET /api/health/ready` returns `200 { "status": "ok" }` when the database answers, otherwise `503` `Database unavailable.`

---

## Suggested mobile flow

1. Sign in: `POST /api/auth/login` with `client: "mobile"`. Store `refreshToken` in secure storage and keep `accessToken` in memory.
2. Call the API with `Authorization: Bearer <accessToken>` and the `X-Client` / `X-App-Version` headers.
3. On a 401: take the refresh lock, call `POST /api/auth/refresh`, store the new `refreshToken` and `accessToken`, release the lock, retry the original request once.
4. If refresh returns 401: delete the stored tokens and show the sign-in screen. This is also what happens when an Admin deactivates the user. Files already downloaded to the device stay on the device.
5. Sign out: `POST /api/auth/logout` with the refresh token, then delete the stored tokens whatever the result.
6. On 429: show the `message`, wait and try again later.
