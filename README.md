# Broadigo Command Center

A PostgreSQL-backed CEO performance dashboard whose production metrics come from persisted, parsed Slack messages. Normal execution never falls back to mock data. Sample data is available only when `DEMO_DATA_ENABLED=true` in a non-production environment.

## Production data flow

Slack signs `POST /api/slack/events` → the endpoint verifies the raw request and acknowledges quickly → configured channel/user IDs are resolved → the raw message is stored in PostgreSQL → a conservative channel parser writes an appointment, sale, lead, dock, or media activity → `/api/dashboard` aggregates every visible page for the selected Asia/Karachi date range.

The endpoint supports Slack URL verification and the message payloads delivered by both `message.channels` and `message.groups`. Threads and message subtypes are deliberately excluded. Event IDs and channel/message timestamps are deduplicated.

The historical importer processes every active mapped channel, follows Slack cursors until complete, and honors a `Retry-After` response. The seeded whitelist is:

- `broadigo-media`
- `broadigo-sale-development-general`
- `broadigo-sales-reporting`
- `broadigomedia-sales-development-general`
- `docks-reporting`
- `leads-reporting`
- `sales-development-general`
- `sales-reporting`

## Baby-step local production setup

### 1. Create PostgreSQL

If you use Supabase, creating a project already creates the PostgreSQL database. Open **Project Settings → Database**, copy the connection string, and use it as `DATABASE_URL`. Prefer Supabase's transaction-pooler connection string for a serverless deployment such as Vercel; the direct connection string is suitable for migration and local administration.

For a local PostgreSQL installation instead:

1. Install PostgreSQL 16 or newer and remember the password you choose for its `postgres` administrator.
2. Open **SQL Shell (psql)** from the Start menu.
3. Press Enter for the default server, database, port, and username, then enter the administrator password.
4. Paste these commands one at a time, replacing `CHOOSE_A_STRONG_PASSWORD`:

   ```sql
   CREATE USER broadigo_app WITH PASSWORD 'CHOOSE_A_STRONG_PASSWORD';
   CREATE DATABASE broadigo OWNER broadigo_app;
   \q
   ```

5. Your local connection string is now:

   ```text
   postgresql://broadigo_app:CHOOSE_A_STRONG_PASSWORD@localhost:5432/broadigo
   ```

### 2. Fill `.env.local`

1. Copy `.env.example` to a new file named `.env.local`.
2. Fill every value below. Do not commit `.env.local`.

   ```dotenv
   DATABASE_URL=postgresql://broadigo_app:CHOOSE_A_STRONG_PASSWORD@localhost:5432/broadigo
   SLACK_BOT_TOKEN=PASTE_YOUR_EXISTING_BOT_TOKEN_HERE
   SLACK_SIGNING_SECRET=PASTE_YOUR_EXISTING_SIGNING_SECRET_HERE
   SLACK_WORKSPACE_ID=PASTE_YOUR_WORKSPACE_ID_HERE
   SESSION_SECRET=PASTE_A_RANDOM_STRING_OF_AT_LEAST_32_CHARACTERS_HERE
   DEMO_AUTH_BYPASS=false
   DEMO_DATA_ENABLED=false
   ```

3. Generate `SESSION_SECRET` with a password manager or another cryptographically secure random generator. It must be at least 32 characters in production — a shorter or missing value makes sign-in fail. Never reuse the Slack secrets.

> **Sign-in credentials (temporary).** Credential verification is currently pinned
> to a fixed administrator account defined in `lib/auth/password.ts`, so
> `CEO_EMAIL` and `CEO_PASSWORD_HASH` are no longer read and can be removed from
> the environment. The account email is a server-side constant and the password is
> stored only as a scrypt hash in that server-only module. To rotate the password,
> run `pnpm auth:hash -- "<new password>"` and replace `ADMIN_PASSWORD_HASH`.
> `SESSION_SECRET` is still required from the environment.

### 3. Create tables and seed the organization

From `C:\Dashboard`, run:

```powershell
pnpm install
pnpm db:migrate
pnpm db:seed
```

The seed creates divisions, teams, employees, aliases, memberships, and all eight inactive channel definitions. It does not invent Slack IDs.

### 4. Map real Slack IDs

1. With the bot installed and invited to the reporting channels, run `pnpm slack:configure`. This discovers the eight channel IDs and safely maps exact employee display-name matches.
2. Start the app with `pnpm dev` and sign in at `http://localhost:3000`.
3. Open **Setup** in the left navigation.
4. Confirm all eight reporting channels show real IDs and **Events enabled**.
5. Review every employee. For an employee the exact-name pass could not match, paste the real Slack member ID (starts with `U`) and click **Save**. Never guess an identity match.
6. In Slack, channel/member IDs can be copied from each channel or profile's details menu. Names are only used by the one-time exact-match helper; production ingestion resolves immutable IDs.

### 5. Run the complete historical Slack sync

1. In the Slack app settings, add the bot scopes `channels:history`, `groups:history`, and `reactions:read`.
2. Reinstall the Slack app to the workspace after changing scopes. Slack does not grant a newly added scope to an already-installed app until it is reinstalled.
3. Invite the bot to all eight reporting channels, including private channels.
4. From `C:\Dashboard`, run:

   ```powershell
   pnpm slack:sync
   ```

5. Leave the window open until it prints a result for every configured channel and `Historical Slack sync complete`.
6. Re-running the command is safe: persisted event/message uniqueness prevents duplicates.

### 6. Start the application

Development:

```powershell
pnpm dev
```

Local production check:

```powershell
pnpm build
pnpm start
```

Open `http://localhost:3000`. If PostgreSQL is absent, the dashboard shows a setup state instead of sample metrics.

## Deploy and obtain the Slack Events URL

These steps use Vercel; any Node.js host with HTTPS and PostgreSQL works.

1. Push `C:\Dashboard` to a private Git repository. Confirm `.env.local` is not committed.
2. Create a managed PostgreSQL database (for example Neon, Supabase, Railway, or Vercel Postgres) and copy its production `DATABASE_URL`.
3. Import the repository into Vercel as a new project.
4. In **Project Settings → Environment Variables**, add the same production variables from `.env.local`. Keep `DEMO_AUTH_BYPASS=false` and `DEMO_DATA_ENABLED=false`.
5. Deploy.
6. Run `pnpm db:migrate` and `pnpm db:seed` once against the production `DATABASE_URL` from a trusted terminal. Then use the deployed **Setup** screen to map IDs and run `pnpm slack:sync` with that production environment.
7. Vercel shows the final domain on the deployment page, for example `https://dashboard.example.com`.
8. Append `/api/slack/events`. The final public Request URL is exactly:

   ```text
   https://YOUR_FINAL_DOMAIN/api/slack/events
   ```

9. Test that the domain opens over HTTPS before continuing.

## Paste the URL into Slack Event Subscriptions

1. Open `api.slack.com/apps` and select the existing Broadigo Slack app.
2. Open **Event Subscriptions**.
3. Turn **Enable Events** on.
4. Paste `https://YOUR_FINAL_DOMAIN/api/slack/events` into **Request URL**.
5. Wait for Slack to show **Verified**. URL verification is signature-checked and returns the challenge as plain text.
6. Under **Subscribe to bot events**, add `message.channels`, `message.groups`, `reaction_added`, and `reaction_removed`. The two reaction events keep lead KPI eligibility live; without them the dashboard only picks up reaction changes on the next history sync or backfill.
7. Click **Save Changes** and reinstall the app if Slack asks.
8. Post one valid reporting message in a mapped channel, then confirm it appears under **Slack data** and in the selected date period.

## Lead KPI eligibility (Slack reactions)

A structured lead in `#leads-reporting` counts toward ISA, team, and division lead KPIs unless the originating Slack message currently carries an `:x:` or `:arrow_left:` reaction. Every other reaction is irrelevant to counting.

| Reactions on the message | Counts toward KPIs |
| --- | --- |
| none, `:eyes:`, `:rocket:`, `:white_check_mark:` | Yes |
| `:x:` (alone or with others) | No — `X_REACTION` |
| `:arrow_left:` (alone or with others) | No — `ARROW_LEFT_REACTION` |

Excluded leads are never deleted. The raw Slack message, the structured lead, employee attribution, prospect details, and the original timestamp are all preserved; only the derived columns `leads.counts_toward_kpi` and `leads.exclusion_reasons` change. This keeps **Submitted** and **Counted** separable, and the evidence drawer badges each lead accordingly.

Eligibility is kept current by three paths, all idempotent:

- **Live** — `reaction_added` / `reaction_removed` events recompute the affected lead immediately. Adding `:x:` stops it counting; removing it restores counting unless `:arrow_left:` remains.
- **History sync** — `pnpm slack:sync` refreshes reactions on every message it pages through.
- **Backfill** — `pnpm leads:backfill-reactions` re-reads the whole channel and recomputes. Use `--dry-run` first.

```powershell
pnpm leads:audit-reactions      # read-only: what the rule does, vs the management sheet
pnpm leads:backfill-reactions --dry-run
pnpm leads:backfill-reactions
```

Requires the `reactions:read` bot scope and the `reaction_added` / `reaction_removed` event subscriptions described above.

## Verification commands

```powershell
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

The period choices Today, Yesterday, This Week, Last Week, This Month, Last Month, and inclusive Custom Range use operational workdays in Asia/Karachi. Each workday contains only the night shift from 7:00 PM through 5:00 AM (start-inclusive, end-exclusive) and is labeled with the date the shift started. Activity after midnight and before 5:00 AM is therefore assigned to the previous date; activity from 5:00 AM through 6:59:59 PM is outside the reporting shift. Weeks start Monday. Every dashboard response—KPIs, division/team/employee output, trends, activity, docks, and targets—uses the same operational range while retaining original UTC timestamps and raw Slack evidence.

## Visual implementation

The glossy card system is in `app/globals.css`. `AnimatedSection.tsx` loads GSAP and ScrollTrigger only when content is visible and motion is allowed. `NetworkCanvas.tsx` loads Three.js on capable desktop devices, uses observers to stop off-screen work, and disposes its renderer and geometry. Both honor reduced-motion behavior; mobile suppresses the decorative canvas.
