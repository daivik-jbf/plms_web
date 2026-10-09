# Storage: videos and cover images (Cloudflare R2)

This guide is for the person who sets up the storage for the JBF Learning Management System. You do not need to have used Cloudflare before. Follow the steps in order; each one says what to click and what to copy. The developer view of the same feature is in `docs/api/media.md`.

**Please read this first.** This guide was written before an R2 bucket existed for this project, so it has not been tested end to end. The Cloudflare dashboard wording used below (R2 Object Storage, Manage API tokens, CORS policy, Object lifecycle rules) was written without access to a live account and may differ slightly from what you see. Cloudflare also changes its screens from time to time. The real test of your setup is `npm run storage:check` (section 4); trust it over this guide, and please correct the guide if something differs.

## 1. What this is for

Videos and cover images are not kept on the server. They go to **Cloudflare R2**, a private online storage service (think of a very large, locked filing cabinet that only this system has the key to). A folder in R2 is called a **bucket**.

- The browser sends each video in pieces (16 MB each) straight to R2, using **temporary links** that the API hands out. A temporary link is a web address that only works for one specific job (for example "upload piece 3 of this video") and stops working after one hour. The video bytes never pass through the API server.
- Videos are played through temporary links as well, and cover images are shown through temporary links.
- The bucket is never public. Nobody can open a file without a temporary link that the API issued to a signed-in person.

## 2. Before you start

- A Cloudflare account. It is free to create. R2 needs a payment method on file, but has a free monthly allowance; see Cloudflare's current R2 pricing page for the numbers, which change.
- R2 does not charge for data leaving the bucket ("egress"), which suits videos that are watched often.
- Someone with access to the server's `apps/api/.env` file (the settings file for the API) to paste the values into at the end.

## 3. Step by step

The Cloudflare dashboard wording below (R2 Object Storage, Manage API tokens, CORS policy, Object lifecycle rules) was written without access to a live account and may differ slightly from what you see. `npm run storage:check` (section 4) is the real test of the setup. This guide was written before an R2 bucket existed for this project, so it has not been tested end to end.

1. **Create the bucket.** In the Cloudflare dashboard open **R2 Object Storage** and choose **Create bucket**. Give it a name, for example `jbf-media`. Leave **public access off**. Do not enable the `r2.dev` public URL.
2. **Note the Account ID.** It is shown on the R2 overview page. You will need it in step 6.
3. **Create an access key.** Go to **R2 → Manage API tokens → Create API token**. Choose the permission **Object Read & Write** and limit it to **this bucket only** (`jbf-media`). Copy the **Access Key ID** and the **Secret Access Key** straight away; the secret is shown only once. Treat both like passwords.
4. **Set the bucket's browser permissions (CORS).** Browsers refuse to talk to a different web address unless that address says it is allowed; the rules for this are called CORS. Open the bucket, then **Settings → CORS policy**, and paste the following, replacing `https://lms.example.org` with the exact address the web app is served from (no slash at the end; add `http://localhost:5173` as a second entry only for a development bucket):

   ```json
   [
     {
       "AllowedOrigins": ["https://lms.example.org"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["Content-Type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   What each line does:
   - `PUT` lets the browser send the video pieces and cover images.
   - `GET` and `HEAD` let the browser play videos and show covers.
   - `AllowedHeaders: Content-Type` is required: each cover upload link is tied to the image's type, so the browser must send that `Content-Type` header, and the bucket must allow it. Without it cover uploads are blocked.
   - **`ExposeHeaders: ETag` is essential.** After each piece is stored, R2 returns a receipt (called the ETag). Unless the bucket exposes that header, the browser is not allowed to read it, and every video upload fails with "the storage did not return a receipt".
5. **Add a safety-net rule.** Open **Settings → Object lifecycle rules** and add a rule **Abort incomplete multipart uploads** after **3 days**. This tidies up pieces from uploads nobody finished. It is only a safety net: the API also cleans up abandoned uploads itself after 24 hours.
6. **Tell the API about it.** Put these settings in `apps/api/.env` on the server:

   ```
   STORAGE_DRIVER=r2
   R2_ACCOUNT_ID=<the Account ID from step 2>
   R2_ACCESS_KEY_ID=<the Access Key ID from step 3>
   R2_SECRET_ACCESS_KEY=<the Secret Access Key from step 3>
   R2_BUCKET=jbf-media
   ```

   Never commit this file or paste the values into chat, tickets or logs. Restart the API afterwards. `WEB_ORIGIN` in the same file must be the same web address you put in the CORS policy (the check in the next section uses it).

## 4. Check that it works

From the project folder run:

```bash
npm run storage:check -w @jbf/api
```

It uploads a small file through a temporary link, reads it back, checks its size and first bytes, uploads a file in two pieces and finishes it, then asks the bucket the same question a browser would ask to check the CORS rules for the address in `WEB_ORIGIN`. It aborts its test uploads and deletes everything it created. Each line starts with a tick (✓) or a cross (✗), and a cross is followed by an explanation in plain words. At the end it prints `Storage is ready.` (exit code 0) or `Some checks failed.` (exit code 1).

If `STORAGE_DRIVER` is not `r2`, it stops straight away and asks you to set it, because it only has something to prove against the real service.

Common crosses and what to do:

| What you see | Usual cause and fix |
| --- | --- |
| `The service answered 403` | The Access Key ID or Secret Access Key is wrong or mistyped, the key was not given access to this bucket, or the server's clock is far off (links are signed with the time). Re-check step 3 and step 6, and the server's clock |
| `The service answered 404` (on the first line, "Upload a small file with a temporary link") | The bucket was not found: `R2_BUCKET` is misspelled or the bucket does not exist in this account. Check the name exactly as shown in the R2 dashboard, and that `R2_ACCOUNT_ID` belongs to the account that owns the bucket |
| `fetch failed` (or another network error message) on the first line | The script could not reach Cloudflare at all. Usual causes: `R2_ACCOUNT_ID` is wrong (the address `https://<account>.r2.cloudflarestorage.com` then does not exist), or the computer has no internet access or a firewall is blocking it |
| `The test upload was refused (HTTP n); check the access key and bucket name before judging the browser permissions.` | The test upload itself failed, so the browser rules could not be judged. Fix the key or bucket first (as above), then run the check again |
| `The bucket's browser permissions (CORS) do not allow the web address ... to upload.` | The `AllowedOrigins` in the CORS policy does not list the address in `WEB_ORIGIN` exactly (watch for `http` against `https`, `www.`, a trailing slash, or a different port) |
| `The bucket does not allow the PUT method from the browser.` | `AllowedMethods` is missing `PUT` |
| `The bucket does not allow the Content-Type header from the browser, so cover uploads would be blocked.` | `AllowedHeaders` is missing `Content-Type` |
| `The bucket does not expose the ETag header, so the browser cannot read each piece's receipt.` | `ExposeHeaders` is missing `ETag`; uploads would fail with "the storage did not return a receipt" |

CORS changes can take a minute to apply; run the check again after a short wait.

## 5. Local development without Cloudflare

The default setting, `STORAGE_DRIVER=local`, keeps files in a folder on the developer's own machine (`apps/api/.storage`, which is never committed; change it with `STORAGE_LOCAL_DIR`). The API itself serves those files through public `/api/dev-storage/...` addresses using signed, expiring links that work like R2's. These routes answer 404 unless the local driver is the one in use, and the request log hides the link part of the address.

- The signing key comes from `STORAGE_SIGNING_SECRET` (at least 32 characters). If it is not set, the API makes a random one each time it starts, so links stop working when the API restarts. That is fine for development.
- **It is refused in production:** with `NODE_ENV=production` the API will not start with `STORAGE_DRIVER=local`.
- It proves the application logic (the upload flow, the checks, the screens) but **not** the Cloudflare setup. Only `npm run storage:check` against the real bucket does that.

## 6. Limits and rules

| Rule | Value |
| --- | --- |
| Video type | MP4 only (`video/mp4`). Other formats must be converted first (for example with HandBrake) |
| Video size | 1 byte up to 2 GB (2,147,483,648 bytes) |
| Cover images | JPEG, PNG or WebP, up to 10 MB |
| Piece size | 16 MB; a 2 GB video is at most 128 pieces. Every piece except the last must be at least 5 MB (R2's own rule) |
| Temporary links | Valid for 1 hour |
| Unfinished uploads | Removed after 24 hours: an hourly timer inside the API does it, or run `npm run storage:cleanup -w @jbf/api` (it prints `Removed N abandoned uploads.`). Running it twice is harmless |

When an upload is finished the API checks the stored file itself: its size must equal what was declared, its type must match, and its first bytes must look like an MP4 (or a JPEG, PNG or WebP for a cover). A file that fails is discarded and the person is told why.

## 7. Security notes

- The bucket is private. The only way to read or write a file is a temporary link issued by the API to a signed-in Admin or Staff member.
- Temporary links last one hour. They are never written to the audit log or the server logs, and are never stored by the web app. The audit log records that a link was issued (a "Played" entry for every playback link), not the link.
- A person who has a playback link can watch that video until the link expires. That is true of any temporary link and is accepted.
- **Accepted risk: a cover upload link stays usable for its hour.** A cover upload link is tied to the image type but not to its length, and it keeps working after the cover has been checked and attached. Until the link expires (one hour), the person who obtained it can write arbitrary or oversized bytes into the stored cover file, which the portal's size and first-bytes checks would have refused. Only a signed-in Staff or Admin member can obtain such a link. When a cover is read, the link forces the declared content type, and the bucket is private. Copying the file on the server when the cover is completed would close this gap; that is future work.
- The access key is limited to one bucket. To rotate it: create a new key (step 3), update `apps/api/.env`, restart the API, then delete the old key in Cloudflare.
- Keep `apps/api/.env` out of version control and out of backups that many people can read.

## 8. Cost note

R2 bills storage per GB per month; a 2 GB video costs a fraction of a cent per month to keep, and downloads are free. Check Cloudflare's current R2 pricing page before launch, since prices and the free allowance change.
