# havwoods-seo-bot

Runs the Havwoods US technical SEO and Core Web Vitals workflow on a
schedule, entirely in GitHub Actions. No third-party service (including
Claude) needs to be running for this to work; GitHub's own scheduler fires
the workflows.

## What it does

**Weekly** (`.github/workflows/weekly-technical-seo.yml`, Mondays 8:07am ET)
- Pulls Site Audit issues from Semrush for havwoods.com: 404s, redirect
  chains, broken internal links, indexing issues, duplicate content,
  structured data errors, and hreflang/canonical problems.
- Logs new issues onto the **HW Technical SEO** monday.com board (skips
  anything already logged and still open, so re-runs don't duplicate).
- Anything needing a developer/CMS-template fix also gets pushed to
  **HW Tasks > Recurring Monthly Tasks**, linked back to the source item.
- Checks priority category pages (wall paneling, herringbone, chevron,
  parquet, wide plank, engineered) for page-2-to-page-1 movement.
- Updates the current month's row on **HW KPI Dashboard**.

**Monthly** (`.github/workflows/monthly-core-web-vitals.yml`, the 2nd of
each month, 8:13am ET)
- Gets the current top 20 US landing pages by organic traffic from Semrush.
- Runs each through Google PageSpeed Insights (mobile) for real field-data
  LCP / INP / CLS — Semrush's Site Audit does not carry true CWV field
  data, PSI/CrUX is the authoritative source for that.
- Upserts each page on **HW Mobile & Performance** with pass/fail status
  and flags for image compression, lazy loading, and render-blocking work.
- Updates the CWV pass rate on **HW KPI Dashboard**.

Every item either job creates is assigned to Zevi Walsh (monday.com user
id `50429760`) so notifications route to one place. Change
`DEFAULT_ASSIGNEE_ID` in `src/config.js` if that should change.

## Required secrets

Set these in **Settings > Secrets and variables > Actions > Secrets** on
this repo:

| Secret | What it's for |
|---|---|
| `SEMRUSH_API_KEY` | Semrush account API key (Semrush dashboard > Profile > API Keys) |
| `MONDAY_API_TOKEN` | monday.com API token with write access to the Havwoods workspace (monday.com > Avatar > Admin > API, or Profile > Developers) |
| `PAGESPEED_API_KEY` | Optional. PageSpeed Insights works without a key at low volume; a free key removes the shared rate limit. Get one at [developers.google.com/speed/docs/insights/v5/get-started](https://developers.google.com/speed/docs/insights/v5/get-started) |

And one **repo variable** (Settings > Secrets and variables > Actions >
Variables, not Secrets — it isn't sensitive):

| Variable | What it's for |
|---|---|
| `SEMRUSH_PROJECT_ID` | The numeric Semrush project ID for Havwoods' Site Audit project. Needed for the weekly job's Site Audit call. See the warning below. |

## Important: verify the Site Audit integration before trusting it

Semrush's Site Audit crawl results (the 404s/redirects/duplicate
content/etc.) are **not** exposed through the same public Analytics API
used for keyword and traffic data. They only come from your account's
Site Audit **Projects**, and API access to that data depends on your
Semrush plan.

`src/lib/semrush.js`'s `getSiteAuditIssues()` is a best-effort
implementation. Before relying on it in production:

1. In Semrush, find (or create) the Site Audit project for havwoods.com
   and copy its numeric project ID into the `SEMRUSH_PROJECT_ID` repo
   variable.
2. Confirm your Semrush plan includes API access to Site Audit snapshot
   data (this is a Business/Guru+API-addon-tier feature on most plans, not
   available on every plan).
3. Run the weekly workflow manually once (see below) and check the Action
   log. If the Site Audit call fails, it fails loudly with a clear error
   rather than silently reporting "no issues" — the rest of the job
   (position tracking, KPI update) still completes.
4. If your account's actual API response shape differs from what
   `normalizeSiteAuditIssues()` in `src/weekly-technical-seo.js` expects,
   adjust that function to match. The Action log will show you the raw
   error/response to work from.

Everything else (organic pages/positions from Semrush, PageSpeed
Insights, monday.com) uses stable, documented public APIs and should work
as-is.

## How state works (no database)

Both jobs need to remember things between runs (which issues are already
logged, last month's CWV numbers, etc.). Rather than a database, they read
and write small JSON files in `data/`, and the workflow commits any
changes back to the repo at the end of each run. That's the
`git add data/ && git commit && git push` step at the end of each
workflow file.

## Running manually / testing

**From GitHub** (easiest, no local setup): go to the **Actions** tab on
this repo, pick either workflow in the left sidebar, and click **Run
workflow**. This uses the real secrets and writes to the real monday.com
boards, so treat it as a real run, not a sandbox.

**Locally**:
```bash
cp .env.example .env
# fill in .env with real values
npm run weekly    # or: npm run monthly
```

## Board / column IDs

All the monday.com board and column IDs this bot writes to live in
`src/config.js`. If a board gets restructured (a column renamed, a group
renamed), update the IDs there — nothing else needs to change.
