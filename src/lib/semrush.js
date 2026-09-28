// Semrush client.
//
// Two different Semrush surfaces are used here, and they are NOT equally
// solid:
//
// 1. The standard Analytics API (api.semrush.com) is well documented,
//    stable, and used for organic page / keyword / position data. This is
//    solid and safe to rely on.
//
// 2. Site Audit crawl results (404s, redirect chains, duplicate content,
//    structured data errors, hreflang/canonical issues) are NOT exposed
//    through that same public Analytics API. Semrush only exposes Site
//    Audit data through your account's Projects, which requires a
//    project-scoped call and a plan that includes API access to it.
//    Semrush does not publish a single stable public endpoint for this the
//    way it does for Analytics reports.
//
//    IMPORTANT: verify `getSiteAuditIssues()` below against your actual
//    Semrush plan and project before trusting it in production. You will
//    likely need to:
//      a) Create (or find) the Site Audit project for havwoods.com in your
//         Semrush account and put its numeric project ID in
//         SEMRUSH_PROJECT_ID (repo variable or secret), and
//      b) Confirm your plan includes API access to Site Audit snapshot
//         data, and adjust the endpoint/response parsing below to match
//         what your account actually returns.
//    Until that's confirmed, this function is written to fail loudly and
//    distinctly (a clearly labeled error) rather than silently return
//    empty/wrong data, so a broken integration here does not look like
//    "no issues found."

const SEMRUSH_ANALYTICS_URL = "https://api.semrush.com/";
const SEMRUSH_MANAGEMENT_URL = "https://api.semrush.com/management/v1";

function requireKey() {
  const key = process.env.SEMRUSH_API_KEY;
  if (!key) {
    throw new Error(
      "SEMRUSH_API_KEY is not set. Add it as a GitHub Actions secret or in " +
        "a local .env file (see .env.example)."
    );
  }
  return key;
}

async function fetchText(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Semrush API HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (text.startsWith("ERROR")) {
    throw new Error(`Semrush API error: ${text.slice(0, 500)}`);
  }
  return text;
}

// Parses Semrush's semicolon-delimited export format into row objects.
function parseSemicolonRows(text, columns) {
  const lines = text.trim().split("\n").filter(Boolean);
  return lines.map((line) => {
    const values = line.split(";");
    const row = {};
    columns.forEach((col, i) => {
      row[col] = values[i];
    });
    return row;
  });
}

// Top organic pages by traffic, aggregated client-side from the top
// keyword rows (Semrush's domain_organic report is keyword-level, not
// page-level, so we group by URL and sum traffic).
export async function getTopOrganicPages(domain, { database = "us", sampleSize = 500 } = {}) {
  const key = requireKey();
  const url =
    `${SEMRUSH_ANALYTICS_URL}?type=domain_organic&key=${key}` +
    `&domain=${encodeURIComponent(domain)}&database=${database}` +
    `&display_limit=${sampleSize}&display_sort=tr_desc` +
    `&export_columns=Ur,Po,Tr,Nq,Ph`;

  const text = await fetchText(url);
  const rows = parseSemicolonRows(text, ["url", "position", "traffic", "volume", "keyword"]);

  const byUrl = new Map();
  for (const row of rows) {
    const traffic = Number(row.traffic) || 0;
    const existing = byUrl.get(row.url);
    if (existing) {
      existing.traffic += traffic;
      existing.keywordCount += 1;
      existing.bestPosition = Math.min(existing.bestPosition, Number(row.position) || 999);
    } else {
      byUrl.set(row.url, {
        url: row.url,
        traffic,
        keywordCount: 1,
        bestPosition: Number(row.position) || 999,
      });
    }
  }

  return [...byUrl.values()].sort((a, b) => b.traffic - a.traffic);
}

// Organic positions for pages/keywords matching the given URL substrings
// (used to spot page-2-to-page-1 movement on priority categories). Returns
// one row per keyword with its current position.
export async function getPositionsForUrlPatterns(domain, urlPatterns, { database = "us" } = {}) {
  const key = requireKey();
  const url =
    `${SEMRUSH_ANALYTICS_URL}?type=domain_organic&key=${key}` +
    `&domain=${encodeURIComponent(domain)}&database=${database}` +
    `&display_limit=1000&export_columns=Ph,Po,Ur,Tr`;

  const text = await fetchText(url);
  const rows = parseSemicolonRows(text, ["keyword", "position", "url", "traffic"]);

  return rows
    .filter((row) => urlPatterns.some((pattern) => row.url?.includes(pattern)))
    .map((row) => ({
      keyword: row.keyword,
      position: Number(row.position),
      url: row.url,
      traffic: Number(row.traffic) || 0,
    }));
}

// See the module-level warning above: this endpoint is a best-effort
// implementation and needs to be confirmed against your Semrush plan.
export async function getSiteAuditIssues(projectId) {
  if (!projectId) {
    throw new Error(
      "SEMRUSH_PROJECT_ID is not set. Site Audit issue data cannot be " +
        "fetched without your Havwoods project's numeric ID from Semrush " +
        "(Projects > Site Audit > Settings). See the comment at the top of " +
        "src/lib/semrush.js before relying on this in production."
    );
  }
  const key = requireKey();

  // Get the latest snapshot for the project.
  const snapshotsRes = await fetch(
    `${SEMRUSH_MANAGEMENT_URL}/projects/${projectId}/siteaudit/snapshots?key=${key}`
  );
  if (!snapshotsRes.ok) {
    const body = await snapshotsRes.text().catch(() => "");
    throw new Error(
      `Semrush Site Audit snapshots HTTP ${snapshotsRes.status}: ${body.slice(0, 500)}. ` +
        "This most likely means your Semrush plan/API key does not have " +
        "Site Audit API access, or SEMRUSH_PROJECT_ID is wrong. Verify in " +
        "your Semrush account before assuming there are simply no issues."
    );
  }
  const snapshots = await snapshotsRes.json();
  const latest = snapshots?.[0];
  if (!latest) {
    throw new Error("No Site Audit snapshots found for this project yet.");
  }

  const issuesRes = await fetch(
    `${SEMRUSH_MANAGEMENT_URL}/projects/${projectId}/siteaudit/snapshots/${latest.id}/issues?key=${key}`
  );
  if (!issuesRes.ok) {
    const body = await issuesRes.text().catch(() => "");
    throw new Error(`Semrush Site Audit issues HTTP ${issuesRes.status}: ${body.slice(0, 500)}`);
  }
  return issuesRes.json();
}
