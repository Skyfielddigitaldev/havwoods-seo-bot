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
- Logs new issues onto the **HW Technical SEO** monday.com board as "Needs
  Review" (skips anything already logged and still open, so re-runs don't
  duplicate). Each issue's fingerprint (`category::url`) is written to a
  visible **Issue ID** column so dedup is checkable on the board itself,
  not just in the local state file.
- Issues needing a developer/CMS-template fix are **not** pushed to devs
  automatically — see "Approval workflow" below for how that now works.
- Upserts one row per priority category page (wall paneling, herringbone,
  chevron, parquet, wide plank, engineered) on **HW Priority Pages
  Performance**: its best-ranking keyword, current position, page 1
  status, and trend (Improved / Declined / Steady / New) versus last
  week. Previous position comes from what's already on the board, no
  separate state file.
- Updates the current month's row on **HW KPI Dashboard**, including how
  many priority pages moved from page 2+ to page 1 this run.

**Weekly** (`.github/workflows/weekly-geo-ai-tracking.yml`, Mondays 8:20am ET)
- Pulls the prompt set configured in the Havwoods Otterly AI brand report.
- For each prompt, gets the latest AI response on each engine (ChatGPT,
  Google AI Overview, Perplexity, Gemini, Copilot).
- Classifies each prompt/engine pair as Cited, Competitor Cited Instead, or
  Not Cited, based on whether a havwoods.com link shows up in the AI
  response's citations.
- Upserts one row per prompt/engine pair onto **HW GEO / AI Search
  Tracking**, keyed by a hidden Sync Key column (`promptId:engine`, a
  stable id from Otterly) so re-runs always update the same row rather
  than risking a duplicate if the prompt wording ever changes.

**Weekly** (`.github/workflows/weekly-geo-link-opportunities.yml`, Mondays
8:27am ET)
- Reuses the same Otterly prompt/citation data as the GEO/AI tracking job
  to suggest **backlink** and **internal link** opportunities.
- Backlink suggestions: when a competitor is cited instead of Havwoods for
  a "best of" listicle prompt (about products/styles) or a brand-ranking
  prompt (about companies/brands), the competitor's cited article becomes
  a draft row in the **GEO Suggestions (Bot)** group on **HW Off-Page
  SEO**, categorized GEO - Listicle or GEO - Brand Perception via the
  **Link Type** column, status **Needs Review**.
- Internal link suggestions: longer, natural-language prompts/questions
  become draft rows in the **GEO Suggestions (Bot)** group on **HW
  Internal Linking**, categorized GEO, suggesting either reinforcement of
  a page Havwoods is already cited on, or flagging that no page currently
  answers the prompt.
- Both halves of the board (the manually-run SEO rows and month groups)
  are left completely untouched; the bot only ever writes into its own
  group, and never changes a row's Review Status once a human has moved it
  off "Needs Review".

**Weekly** (`.github/workflows/weekly-geo-content-suggestions.yml`, Mondays
8:34am ET)
- For every Otterly prompt where Havwoods isn't cited by any engine,
  suggests which existing page should get expanded content to compete for
  that prompt (matched via **HW Priority Pages Performance**, so the
  target always points at whichever page currently represents that
  category), or flags that a new page is needed.
- Writes to the new **HW GEO Content Suggestions** board, status **Needs
  Review**, one row per prompt.

**Weekly** (`.github/workflows/weekly-approval-routing.yml`, Thursdays
10:00am ET — a few days after the Monday crawls, to give the team review
time)
- Scans **HW Technical SEO** for issues marked **Approved** that need a
  developer, and **HW Mobile & Performance** for rows marked **Approved**
  with a render-blocking or ADA fix flagged **Dev Needed**.
- Creates the **HW Tasks > Recurring Monthly Tasks** item for each one,
  linked back to the source row, and marks it **Routed to Dev** so it's
  never pushed twice.
- See "Approval workflow" below for the full picture, including what
  happens to the GEO suggestion boards.

**Monthly** (`.github/workflows/monthly-core-web-vitals.yml`, the 2nd of
each month, 8:13am ET)
- Gets the current top 20 US landing pages by organic traffic from Semrush,
  **plus** any brand-new page found by crawling havwoods.com's sitemap.xml
  that has never been checked before (capped at 15 new pages per run, so a
  batch of new product pages can't blow up the job's runtime — excess
  pages roll into next month's run). New pages land in their own **New
  Pages Discovered** group on the board until they start ranking.
- Runs each through a direct Lighthouse audit (mobile, headless Chrome in
  the Action runner) for LCP, CLS, accessibility, and the render-blocking /
  image opportunities. No external API or key involved, see "About the
  Core Web Vitals numbers" below for what this means for INP and for field
  vs. lab data.
- Upserts each page on **HW Mobile & Performance** with pass/fail status,
  LCP/CLS, an accessibility score (0-100) with the specific failing checks
  listed, and flags for image compression, lazy loading, and
  render-blocking work.
- Updates the CWV pass rate on **HW KPI Dashboard**.

Every item any job creates is assigned to Zevi Walsh (monday.com user id
`50429760`) so notifications route to one place. Change
`DEFAULT_ASSIGNEE_ID` in `src/config.js` if that should change.

## Approval workflow

Every board an automated job writes to now follows the same pattern:
**Needs Review -> Approved -> (routed to devs, or done by the team)**.

- A job never does anything on the strength of its own judgment beyond
  logging a draft row. New issues/suggestions always land as **Needs
  Review**.
- A human (Skyfield or Havwoods) reviews the row in monday.com and flips
  its status to **Approved** when it's worth acting on, or leaves it /
  marks it otherwise if not.
- What happens next depends on who does the work:
  - **Developer work** (HW Technical SEO's redirect/structured-data/
    hreflang/canonical issues, and HW Mobile & Performance's render-
    blocking or ADA fixes marked Dev Needed): the weekly approval-routing
    job automatically creates the HW Tasks item once a row is Approved, and
    marks it Routed to Dev so it's never duplicated.
  - **Skyfield/content-team work** (backlink outreach on HW Off-Page SEO,
    adding internal links on HW Internal Linking, writing content on HW
    GEO Content Suggestions, image compression / lazy loading on HW Mobile
    & Performance): there's no CMS or site-editing access wired up for
    this bot, so an Approved row just stays visible for a person to
    actually do the work and mark it Done/Published themselves. Nothing
    here is automated past the suggestion stage.
- A job re-run never resets a row's Review Status once a human has moved
  it off "Needs Review" — only the fields it's responsible for (notes,
  dates, links) get refreshed.

## Required secrets

Set these in **Settings > Secrets and variables > Actions > Secrets** on
this repo:

| Secret | What it's for |
|---|---|
| `SEMRUSH_API_KEY` | Semrush account API key (Semrush dashboard > Profile > API Keys) |
| `MONDAY_API_TOKEN` | monday.com API token with write access to the Havwoods workspace (monday.com > Avatar > Admin > API, or Profile > Developers) |
| `OTTERLY_API_KEY` | Otterly AI account API key, needed for the GEO/AI search tracking job (Otterly dashboard > Settings > API Keys) |

The monthly Core Web Vitals job needs no secret at all. It runs Lighthouse
directly against a headless Chrome the workflow installs on the runner.

And one **repo variable** (Settings > Secrets and variables > Actions >
Variables, not Secrets, it isn't sensitive):

| Variable | What it's for |
|---|---|
| `SEMRUSH_PROJECT_ID` | The numeric Semrush project ID for Havwoods' Site Audit project. Needed for the weekly job's Site Audit call. See the warning below. |

## About the Core Web Vitals numbers (Mobile & Performance)

This job used to call Google PageSpeed Insights, which mixes real-user
CrUX field data with a Lighthouse lab run. It now runs Lighthouse directly
against a local headless Chrome instead, dropping the PSI dependency
entirely (no API key, no shared quota, no rate limiting). The tradeoff:

- Every LCP and CLS number on the board is now a single simulated
  Lighthouse run, not real-user field data. Most Havwoods pages never had
  enough traffic to get real per-page CrUX data from PSI anyway, so this
  is a small loss in practice, but treat the numbers as directional, not
  as what real visitors experienced.
- The **INP** column is left blank. INP can only be measured from a real
  user interacting with the page; a lab run has nothing to measure it
  against. If per-page real-user INP matters, it would need pulling from
  Google Search Console's Core Web Vitals report or CrUX directly, as a
  separate job.
- The **Data Source** column always reads "Lighthouse Lab Run" now, kept
  on the board for consistency rather than removed.

The accessibility score and findings come from the same Lighthouse pass (no
extra cost). Only a handful of audits are surfaced by name (missing alt
text, low color contrast, missing ARIA attributes, etc.) rather than every
possible accessibility check; see `ADA_AUDIT_LABELS` in
`src/lib/lighthouse.js` to add more. Issues that need a template/code
change (invalid ARIA, missing `lang` attribute, etc.) are flagged **Dev
Needed** in the **ADA Fix Needed** column rather than **Needs Work**.

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
   rather than silently reporting "no issues", and the rest of the job
   (position tracking, KPI update) still completes.
4. If your account's actual API response shape differs from what
   `normalizeSiteAuditIssues()` in `src/weekly-technical-seo.js` expects,
   adjust that function to match. The Action log will show you the raw
   error/response to work from.

Everything else (organic pages/positions from Semrush, the Lighthouse
run, monday.com) uses stable, documented interfaces and should work
as-is.

## How state works (no database)

The weekly technical SEO and monthly CWV jobs need to remember things
between runs (which issues are already logged, last month's CWV numbers,
etc.). Rather than a database, they read and write small JSON files in
`data/`, and the workflow commits any changes back to the repo at the end
of each run. That's the `git add data/ && git commit && git push` step at
the end of those two workflow files.

The newer jobs (GEO/AI tracking, GEO link opportunities, GEO content
suggestions, approval routing) need no state file at all — each one reads
the board itself (matched by a hidden Sync Key or Issue ID column) to
decide what already exists, so the board is the only source of truth.

## Running manually / testing

**From GitHub** (easiest, no local setup): go to the **Actions** tab on
this repo, pick either workflow in the left sidebar, and click **Run
workflow**. This uses the real secrets and writes to the real monday.com
boards, so treat it as a real run, not a sandbox.

**Locally**:
```bash
cp .env.example .env
# fill in .env with real values
npm run weekly                     # HW Technical SEO + Priority Pages + KPI
npm run monthly                    # HW Mobile & Performance (Lighthouse)
npm run geo-ai-tracking            # HW GEO / AI Search Tracking
npm run geo-link-opportunities     # HW Off-Page SEO + HW Internal Linking (GEO rows)
npm run geo-content-suggestions    # HW GEO Content Suggestions
npm run approval-routing           # Routes Approved dev-needed items to HW Tasks
```

## Board / column IDs

All the monday.com board and column IDs this bot writes to live in
`src/config.js`. If a board gets restructured (a column renamed, a group
renamed), update the IDs there. Nothing else needs to change.
