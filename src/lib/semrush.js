// Semrush client.
//
// Two different Semrush surfaces are used here, and they are NOT equally
// solid:
//
// 1. The standard Analytics API (api.semrush.com) is well documented,
//    stable, and used for organic page / keyword / position data. This is
//    solid and safe to rely on.
//
// 2. Site Audit results come from the project-scoped reports API
//    (api.semrush.com/reports/v1/projects/{id}/siteaudit/...), which needs
//    the Havwoods project ID in SEMRUSH_PROJECT_ID and a plan with API
//    access to Site Audit.

const SEMRUSH_ANALYTICS_URL = "https://api.semrush.com/";
const SEMRUSH_REPORTS_URL = "https://api.semrush.com/reports/v1";

// Site Audit issue ids (from the project's meta/issues report) mapped to the
// categories used on the HW Technical SEO board.
const SITE_AUDIT_ISSUE_CATEGORIES = {
  2: "404",
  8: "broken_link",
  33: "redirect_chain",
  4: "indexing",
  125: "indexing",
  209: "indexing",
  7: "duplicate_content",
  45: "structured_data",
  23: "hreflang",
  24: "hreflang",
  25: "hreflang",
  204: "hreflang",
  38: "canonical",
  39: "canonical",
};

// Cap on URLs pulled per issue type so a large site-wide issue doesn't flood the board.
const SITE_AUDIT_ROWS_PER_ISSUE = 100;

async function reportsGet(path, key, params = {}) {
  const query = new URLSearchParams({ key, ...params });
  const res = await fetch(`${SEMRUSH_REPORTS_URL}${path}?${query}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Semrush Site Audit ${path} HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

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

// Pulls the latest Site Audit snapshot for the project and returns one entry
// per affected URL for the issue types we track on the Technical SEO board.
// Each entry carries `issue_id` set to the board category key.
export async function getSiteAuditIssues(projectId) {
  if (!projectId) {
    throw new Error("SEMRUSH_PROJECT_ID is not set, so Site Audit issues cannot be fetched.");
  }
  const key = requireKey();
  const base = `/projects/${projectId}/siteaudit`;

  const { snapshots } = await reportsGet(`${base}/snapshots`, key, { id: projectId });
  const latest = [...(snapshots ?? [])].sort((a, b) => b.finish_date - a.finish_date)[0];
  if (!latest) {
    throw new Error("No Site Audit snapshots found for this project yet.");
  }

  const snapshot = await reportsGet(`${base}/snapshot`, key, {
    id: projectId,
    snapshot_id: latest.snapshot_id,
  });
  const found = [...(snapshot.errors ?? []), ...(snapshot.warnings ?? []), ...(snapshot.notices ?? [])]
    .filter((issue) => issue.count > 0 && SITE_AUDIT_ISSUE_CATEGORIES[issue.id]);

  const issues = [];
  const seen = new Set();
  for (const issue of found) {
    const category = SITE_AUDIT_ISSUE_CATEGORIES[issue.id];
    const detail = await reportsGet(`${base}/snapshot/${latest.snapshot_id}/issue/${issue.id}`, key, {
      id: projectId,
      limit: SITE_AUDIT_ROWS_PER_ISSUE,
      page: 1,
    });
    for (const row of detail.data ?? []) {
      const url = row.target_url ?? row.url ?? row.source_url;
      if (!url || seen.has(`${category}::${url}`)) continue;
      seen.add(`${category}::${url}`);
      issues.push({
        issue_id: category,
        url,
        description: row.source_url && row.source_url !== url ? `Found on ${row.source_url}` : "",
        report_url: `https://www.semrush.com/siteaudit/?id=${projectId}`,
      });
    }
  }
  return issues;
}
