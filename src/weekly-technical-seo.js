// Weekly Havwoods (US) technical SEO sync.
// Run by .github/workflows/weekly-technical-seo.yml every Monday.
//
// 1. Pulls Site Audit issues from Semrush (404s, redirect chains, broken
//    internal links, indexing issues, duplicate content, structured data
//    errors) and hreflang/canonical problems.
// 2. Logs new issues to the HW Technical SEO board (skips ones already
//    logged and still open).
// 3. Routes dev/CMS-level fixes to HW Tasks > Recurring Monthly Tasks.
// 4. Checks priority category pages for page-2-to-page-1 movement.
// 5. Updates the HW KPI Dashboard's row for the current month.
// 6. Posts a summary update on the newest logged item.

import { boards, DEFAULT_ASSIGNEE_ID, SEMRUSH_DOMAIN, SEMRUSH_DATABASE, priorityCategories, monthGroupName, isoDate } from "./config.js";
import * as monday from "./lib/monday.js";
import { getSiteAuditIssues, getPositionsForUrlPatterns } from "./lib/semrush.js";
import { readState, writeState } from "./lib/state.js";

const ISSUE_TYPE_LABELS = {
  "404": "404",
  broken_link: "Broken Internal Link",
  redirect_chain: "Redirect Chain",
  indexing: "Indexing Issue",
  duplicate_content: "Duplicate Content",
  structured_data: "Structured Data Error",
  hreflang: "Hreflang Issue",
  canonical: "Canonical Issue",
};

// Issue categories that need a developer/CMS-template fix rather than a
// content-editor fix. Adjust this list as you learn the CMS's real
// limitations.
const DEV_NEEDED_CATEGORIES = new Set([
  "redirect_chain",
  "structured_data",
  "hreflang",
  "canonical",
]);

function fingerprint(issue) {
  return `${issue.category}::${issue.url}`;
}

async function main() {
  console.log(`Weekly technical SEO sync starting for ${SEMRUSH_DOMAIN} (${isoDate()})`);

  const state = await readState("technical-seo-state.json", { loggedIssues: {} });
  const monthGroup = monthGroupName();
  const groupId = await monday.findOrCreateGroup(boards.technicalSeo.id, monthGroup);

  let issues = [];
  let siteAuditError = null;
  try {
    const projectId = process.env.SEMRUSH_PROJECT_ID;
    const raw = await getSiteAuditIssues(projectId);
    issues = normalizeSiteAuditIssues(raw);
    console.log(`Semrush Site Audit returned ${issues.length} issue(s).`);
  } catch (err) {
    siteAuditError = err.message;
    console.error(`Site Audit fetch failed, continuing without it: ${siteAuditError}`);
  }

  const newlyLogged = [];
  const pushedToTasks = [];

  for (const issue of issues) {
    const fp = fingerprint(issue);
    if (state.loggedIssues[fp] && state.loggedIssues[fp].status !== "Fixed") {
      continue; // already logged and still open, do not duplicate
    }

    const issueLabel = ISSUE_TYPE_LABELS[issue.category] ?? issue.category;
    const itemName = `${issueLabel}: ${issue.url}`;

    const itemId = await monday.createItem(boards.technicalSeo.id, groupId, itemName, {
      [boards.technicalSeo.columns.issueType]: monday.columnValue.status(issueLabel),
      [boards.technicalSeo.columns.crawlDate]: monday.columnValue.date(isoDate()),
      [boards.technicalSeo.columns.linkToSemrush]: monday.columnValue.link(issue.reportUrl ?? issue.url),
      [boards.technicalSeo.columns.assignee]: monday.columnValue.people([DEFAULT_ASSIGNEE_ID]),
      [boards.technicalSeo.columns.issuesFixed]: monday.columnValue.status("Working on It"),
      ...(issue.category === "hreflang" || issue.category === "canonical"
        ? { [boards.technicalSeo.columns.usVersion]: monday.columnValue.status("Needs Fix") }
        : {}),
    });

    await monday.createSubitem(itemId, issue.url, {
      [boards.technicalSeo.subitemColumns.pageLink]: monday.columnValue.link(issue.url),
      [boards.technicalSeo.subitemColumns.errorPages]: monday.columnValue.text(issue.detail ?? ""),
      [boards.technicalSeo.subitemColumns.issueFixed]: monday.columnValue.status("Working on it"),
    });

    state.loggedIssues[fp] = { itemId, status: "Working on It", loggedAt: isoDate() };
    newlyLogged.push({ ...issue, itemId, label: issueLabel });

    if (DEV_NEEDED_CATEGORIES.has(issue.category)) {
      const taskId = await monday.createItem(
        boards.tasks.id,
        boards.tasks.recurringGroupId,
        `Fix: ${issueLabel}: ${issue.url}`,
        {
          [boards.tasks.columns.assignee]: monday.columnValue.people([DEFAULT_ASSIGNEE_ID]),
          [boards.tasks.columns.priority]: monday.columnValue.status(
            issue.affectsPriorityPage ? "High" : "Medium"
          ),
          [boards.tasks.columns.source]: monday.columnValue.status("Semrush Weekly Crawl"),
          [boards.tasks.columns.relatedItem]: monday.columnValue.link(
            `https://skyfield-digital.monday.com/boards/${boards.technicalSeo.id}/pulses/${itemId}`,
            issueLabel
          ),
        }
      );
      pushedToTasks.push(taskId);
    }
  }

  // Priority category position tracking (page 2 -> page 1).
  let p2p1Moves = 0;
  let positionError = null;
  try {
    const previousPositions = await readState("position-state.json", {});
    const current = await getPositionsForUrlPatterns(
      SEMRUSH_DOMAIN,
      priorityCategories,
      { database: SEMRUSH_DATABASE }
    );
    const currentByKeyword = {};
    for (const row of current) {
      currentByKeyword[row.keyword] = row.position;
      const prevPosition = previousPositions[row.keyword];
      if (prevPosition && prevPosition > 10 && row.position <= 10) {
        p2p1Moves += 1;
      }
    }
    await writeState("position-state.json", currentByKeyword);
  } catch (err) {
    positionError = err.message;
    console.error(`Position tracking failed, continuing without it: ${positionError}`);
  }

  // Update KPI dashboard.
  const kpiGroupName = monthGroupName();
  const kpiGroupId = boards.kpiDashboard.snapshotsGroupId;
  const kpiItems = await monday.getBoardItems(boards.kpiDashboard.id, { groupId: kpiGroupId });
  let kpiItem = kpiItems.find((i) => i.name === kpiGroupName);

  const openIssueCount = Object.values(state.loggedIssues).filter(
    (i) => i.status !== "Fixed"
  ).length;

  if (!kpiItem) {
    const id = await monday.createItem(boards.kpiDashboard.id, kpiGroupId, kpiGroupName, {
      [boards.kpiDashboard.columns.technicalErrorCount]: monday.columnValue.numbers(openIssueCount),
      [boards.kpiDashboard.columns.p2p1Moves]: monday.columnValue.numbers(p2p1Moves),
      [boards.kpiDashboard.columns.reportDate]: monday.columnValue.date(isoDate()),
      [boards.kpiDashboard.columns.notes]: monday.columnValue.text(
        `${isoDate()}: initial weekly sync, ${newlyLogged.length} new issue(s) logged.`
      ),
    });
    kpiItem = { id };
  } else {
    await monday.changeColumnValues(boards.kpiDashboard.id, kpiItem.id, {
      [boards.kpiDashboard.columns.technicalErrorCount]: monday.columnValue.numbers(openIssueCount),
      [boards.kpiDashboard.columns.p2p1Moves]: monday.columnValue.numbers(p2p1Moves),
      [boards.kpiDashboard.columns.reportDate]: monday.columnValue.date(isoDate()),
    });
    await monday.createUpdate(
      kpiItem.id,
      `${isoDate()}: +${newlyLogged.length} technical issue(s) logged this week, ${openIssueCount} open total, ${p2p1Moves} priority keyword(s) moved to page 1.`
    );
  }

  await writeState("technical-seo-state.json", state);

  // Summary update on the first item logged this run (or skip if nothing to report on).
  if (newlyLogged.length > 0) {
    const summaryLines = [
      `Weekly crawl summary (${isoDate()}):`,
      `- ${newlyLogged.length} new issue(s) logged`,
      `- ${pushedToTasks.length} pushed to HW Tasks for dev/CMS action`,
      ...Object.entries(countBy(newlyLogged, (i) => i.label)).map(([label, count]) => `  - ${label}: ${count}`),
      p2p1Moves > 0 ? `- ${p2p1Moves} priority keyword(s) moved from page 2 to page 1` : null,
      siteAuditError ? `- Site Audit fetch failed: ${siteAuditError}` : null,
      positionError ? `- Position tracking failed: ${positionError}` : null,
    ].filter(Boolean);
    await monday.createUpdate(newlyLogged[0].itemId, summaryLines.join("\n"));
  }

  console.log("Weekly technical SEO sync complete.");
  console.log(`  New issues logged: ${newlyLogged.length}`);
  console.log(`  Pushed to HW Tasks: ${pushedToTasks.length}`);
  console.log(`  Page 2 -> page 1 moves: ${p2p1Moves}`);
  if (siteAuditError) console.log(`  Site Audit error: ${siteAuditError}`);
  if (positionError) console.log(`  Position tracking error: ${positionError}`);
}

// Normalizes whatever the Semrush Site Audit API returns into a flat list
// of { category, url, detail, reportUrl, affectsPriorityPage }. This will
// need adjusting once you confirm the real response shape for your account
// (see the warning at the top of src/lib/semrush.js).
function normalizeSiteAuditIssues(raw) {
  const items = Array.isArray(raw) ? raw : raw?.issues ?? raw?.data ?? [];
  return items.map((item) => {
    const url = item.url ?? item.page_url ?? item.source_url ?? "unknown-url";
    return {
      category: mapSemrushIssueId(item.issue_id ?? item.type ?? item.code),
      url,
      detail: item.description ?? item.message ?? JSON.stringify(item).slice(0, 300),
      reportUrl: item.report_url,
      affectsPriorityPage: priorityCategoriesMatch(url),
    };
  });
}

function priorityCategoriesMatch(url) {
  return priorityCategories.some((slug) => url.includes(slug));
}

// Best-effort mapping from Semrush's internal issue ids/types to our
// categories. Extend this as you see real issue ids come through.
function mapSemrushIssueId(id) {
  const idStr = String(id ?? "").toLowerCase();
  if (idStr.includes("404") || idStr.includes("not_found")) return "404";
  if (idStr.includes("redirect")) return "redirect_chain";
  if (idStr.includes("broken") && idStr.includes("link")) return "broken_link";
  if (idStr.includes("index")) return "indexing";
  if (idStr.includes("duplicate")) return "duplicate_content";
  if (idStr.includes("structured") || idStr.includes("schema")) return "structured_data";
  if (idStr.includes("hreflang")) return "hreflang";
  if (idStr.includes("canonical")) return "canonical";
  return idStr || "unknown";
}

function countBy(list, keyFn) {
  const out = {};
  for (const item of list) {
    const key = keyFn(item);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

main().catch((err) => {
  console.error("Weekly technical SEO sync failed:", err);
  process.exitCode = 1;
});
