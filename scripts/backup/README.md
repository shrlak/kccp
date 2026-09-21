# Weekly encrypted backup — setup

`.github/workflows/backup.yml` runs every Sunday (and on-demand via `workflow_dispatch`):
dumps the production database through a read-only role, restores that dump into a
throwaway Postgres to verify it, packages it with the migrations + edge-function source,
encrypts it, and overwrites one `backups/current.*` backup set in Cloudflare R2. After all
four current objects are verified, `prune-retention.py` removes dated objects left by the
former retention policy. On any failure it opens (or comments on) a GitHub issue labeled
`backup-failure`.

Already done (by Claude, in-session): the `kccp-attendance-backups` R2 bucket and the
`backup_reader` Postgres role (`SELECT`-only, `BYPASSRLS` so it can actually read past
RLS, no `SUPERUSER`/`CREATEDB`/`CREATEROLE`/`REPLICATION`) both exist. What's left below
requires either dashboard access Claude doesn't have, or a private key that must never
pass through an AI session or GitHub in plaintext — so these steps are yours to run.

## 1. Generate the age keypair (do this on your own machine, not in any AI session)

```sh
age-keygen -o backup-key.txt
```

This prints a line like `Public key: age1...` and writes both keys to `backup-key.txt`.

- **Public key** (`age1...`) → goes into the `BACKUP_AGE_PUBLIC_KEY` GitHub secret below.
  It can only encrypt; it does not need to be kept secret.
- **Private key** (the `AGE-SECRET-KEY-1...` line in `backup-key.txt`) → keep this
  somewhere durable and offline (password manager, printed and stored safely — whatever
  your normal secret-custody practice is). **Do not** upload it to GitHub as a secret, or
  paste it into any chat session, including this one. GitHub Actions only ever encrypts
  with the public key; nothing in CI should ever be able to decrypt a backup. If this key
  is lost, every backup taken with it becomes permanently unrecoverable — there is no
  recovery path, so treat the private key file as the one true irreplaceable artifact.

## 2. Create an R2 API token (Cloudflare dashboard)

1. Cloudflare dashboard → **R2** → **Manage R2 API Tokens**.
2. Create a token scoped to just the `kccp-attendance-backups` bucket, permission
   **Object Read & Write** (the prune step needs to delete old objects, not just write new
   ones).
3. Note down, from the token creation screen:
   - **Access Key ID**
   - **Secret Access Key** (shown once)
   - **Account ID** (shown on the same screen / on the R2 landing page) — used to build the
     endpoint URL `https://<account-id>.r2.cloudflarestorage.com`.

## 3. Set the backup-reader password

GitHub Actions connects through Supabase's IPv4 Session Pooler using fixed, non-secret
host/user settings in the workflow. Only the password is stored as a GitHub secret; this
avoids URI escaping mistakes and prevents password fragments from appearing in connection
URL errors.

1. Generate a strong password in a password manager.
2. In the Supabase SQL editor, set it on the existing read-only role:

   ```sql
   SET password_encryption = 'scram-sha-256';
   ALTER ROLE backup_reader WITH LOGIN PASSWORD '<new-strong-password>';
   ```

3. Copy that exact password into `SUPABASE_BACKUP_DB_PASSWORD` in step 4. Do not add a
   username, connection URL, quotes, or surrounding whitespace.

## 4. Add the GitHub repo secrets

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Value |
|---|---|
| `SUPABASE_BACKUP_DB_PASSWORD` | Only the `backup_reader` password from step 3 |
| `BACKUP_AGE_PUBLIC_KEY` | The `age1...` public key from step 1 |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` from step 2 |
| `R2_ACCESS_KEY_ID` | From step 2 |
| `R2_SECRET_ACCESS_KEY` | From step 2 |

## 4b. Check the five values before you paste them (recommended)

```sh
export PGPASSWORD='...'            # step 3
export BACKUP_AGE_PUBLIC_KEY='age1...'
export AGE_KEY_FILE="$HOME/Desktop/kccp-backup-key.txt"   # optional, but do it
export R2_ENDPOINT='https://<account-id>.r2.cloudflarestorage.com'
export AWS_ACCESS_KEY_ID='...'
export AWS_SECRET_ACCESS_KEY='...'
bash scripts/backup/preflight.sh
```

Runs entirely on your machine and sends nothing anywhere. It connects with the *same*
host/user the workflow uses, confirms `backup_reader` actually reads rows (a role without
`BYPASSRLS` sees zero — that would make a "successful" empty backup), encrypts with the
public key **and decrypts again with the private one**, and checks the R2 token can write
*and delete* (the prune step deletes; a Read-only token fails at the very last step).

A failing GitHub run hides its values — correctly — so "which of the five is wrong" is
hard to see there. This names it.

## 5. First run

Actions tab → **Weekly Encrypted Backup** → **Run workflow**, once all five secrets above
are set. Confirms the whole chain (dump → verify-restore → encrypt → upload → prune)
before waiting for the next scheduled Sunday. If a secret is missing, the run fails fast
at the "Check required secrets are configured" step and names exactly which one.

## 6. In-app backup/restore (Admins tab)

The Admins tab's "전체 암호화 백업" section shows the current backup's encrypted size and
Pittsburgh completion time. It lets a super-admin trigger a replacement backup, download
the current one, and restore — all from the website, without touching GitHub or Cloudflare
directly. This runs through the edge function (`supabase/functions/attendance-api`),
which needs its **own** copies of some of the same credentials — Supabase Edge Function
secrets are a separate store from the GitHub Actions repo secrets above, even when the
values are identical. Set these via the Supabase dashboard (Project Settings → Edge
Functions → your function → Secrets) or the CLI:

```sh
supabase secrets set --project-ref loovulhchmmwagtvjnhc \
  GITHUB_PAT=<step a> \
  R2_ENDPOINT=<same value as the GitHub secret> \
  R2_ACCESS_KEY_ID=<same value as the GitHub secret> \
  R2_SECRET_ACCESS_KEY=<same value as the GitHub secret> \
  RESTORE_DB_URL=<step b>
```

**a. `GITHUB_PAT`** — a fine-grained GitHub personal access token, scoped to **this repo
only**, with **Actions: Read and write** permission (nothing else). Create it at
GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.
This is what lets the "지금 백업 실행" (run backup now) button dispatch the workflow — it
cannot read secrets or touch code, only start a run.

**b. `RESTORE_DB_URL`** — a Session Pooler connection URL for the
`backup_restorer` role (read **and** write — `TRUNCATE`+`INSERT`, still no schema/DDL
privileges):

```
postgresql://backup_restorer.loovulhchmmwagtvjnhc:<password>@aws-1-us-east-1.pooler.supabase.com:5432/postgres
```

Use the exact Session Pooler host shown by the project's **Connect** panel if it differs.

The `backup_restorer` password was generated and shown once in chat alongside
`backup_reader`'s, the same way — not repeated here. Lost it? See **Rotating a DB
password** below, using `backup_restorer` in place of `backup_reader`.

Restoring itself never needs a stored secret for the `age` **private** key — the admin
performing the restore pastes it into the confirmation dialog at the moment they use it,
and the edge function uses it in-memory for that one request only. Nothing server-side
ever holds it.

## Rotating a DB password

If either role's password is ever lost or needs rotating, run against the prod project
(via `mcp__Supabase__execute_sql` or the SQL editor), substituting the role name:

```sql
ALTER ROLE backup_reader WITH PASSWORD '<new-strong-password>';    -- or backup_restorer
```

Then update the password-only `SUPABASE_BACKUP_DB_PASSWORD` GitHub secret to match.
The workflow supplies the host, port, database, username, and SSL mode separately.

## Quarterly restore drill

The Admins tab's restore button (see step 6) is the normal path, and it depends on the
edge function being up. This manual drill is the fallback that doesn't — decrypting and
loading a backup with nothing but the private key file, `age`, and `psql` on your own
machine, the same way you'd have to if Supabase itself were ever unreachable. The in-CI
verification step proves the dump *content* restores cleanly every week; this is the one
that proves *you* still have everything needed to do it by hand. Recommend quarterly:

```sh
# Download current.sql.age from the R2 bucket (dashboard, or aws s3 cp with the
# R2_* credentials from step 2), then:
age -d -i backup-key.txt -o backup.sql current.sql.age

# Data-only — needs an existing schema to load into. A scratch DB with just-applied
# migrations mirrors what the CI verify step does:
createdb restore_drill
for f in supabase/migrations/*.sql; do psql restore_drill -v ON_ERROR_STOP=1 -f "$f"; done
psql restore_drill --single-transaction -v ON_ERROR_STOP=1 -f backup.sql
```

The `current.schema.tar.gz.age` file alongside it isn't needed for this — it's the
migrations + edge-function source, archival reference for a from-scratch project rebuild,
not something you load into a database.

If this ever fails, the automated pipeline's in-CI verification wouldn't have caught it —
that's exactly what makes the manual drill worth doing.
