// Monthly Havwoods Core Web Vitals pull. Runs once per region (US or UK),
// selected by the REGION env var — see .github/workflows/
// monthly-core-web-vitals.yml (US) and monthly-core-web-vitals-uk.yml (UK).
//
// 1. Gets the current top 20 landing pages by organic traffic from Semrush
//    for this region, PLUS any brand-new page from the sitemap that has
//    never been checked before (so a page with zero traffic yet still gets
//    caught, not just pages that already rank). Both are filtered to this
//    region's URL path (/us/ or /uk/) since Semrush's top-pages report
//    isn't scoped by path on its own — without that filter, pages from
//    other locales (AU, INT, ...) can show up in a region's "top 20".
// 2. Runs each through a direct Lighthouse audit (mobile) for LCP / CLS /
//    accessibility and the render-blocking / image opportunities. No
//    Google API, no key, no rate limit, every number is a lab run rather
//    than real-user field data (see src/lib/lighthouse.js for why that
//    tradeoff was made).
// 3. Upserts each page as an item on this region's HW Mobile & Performance
//    board.
// 4. Rolls the pass rate into this region's HW KPI Dashboard.

import { boardsByRegion, regions, resolveRegion, DEFAULT_ASSIGNEE_ID, SEMRUSH_DOMAIN, monthGroupName, isoDate } from "./config.js";
import * as monday from "./lib/monday.js";
import { getTopOrganicPages } from "./lib/semrush.js";
import { getAllSitePages } from "./lib/sitemap.js";
import { getPageSpeed } from "./lib/lighthouse.js";
import { readState, writeState } from "./lib/state.js";

const REGION = resolveRegion();
const regionConfig = regions[REGION];
const boards = boardsByRegion[REGION];

const TOP_N = 20;
// Cap how many brand-new (zero-traffic) sitemap pages get added per run, so
// a big batch of new product pages doesn't blow up the job's runtime. Any
// excess rolls into next month's run since they stay "new" until checked.
const MAX_NEW_PAGES_PER_RUN = 15;
const DELAY_BETWEEN_REQUESTS_MS = 500; // let the previous Chrome instance fully exit

// Individual product detail pages are too numerous (1000+) and too
// low-value individually to track one-by-one here; the collection/category
// pages that list and link to them matter far more for CWV monitoring.
function isTrackablePage(pathname) {
  return !pathname.includes("/products/");
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInRegion(url) {
  try {
    return new URL(url).pathname.startsWith(regionConfig.pathPrefix);
  } catch {
    return false;
  }
}

async function main() {
  console.log(`Monthly Core Web Vitals pull starting for ${SEMRUSH_DOMAIN} [${regionConfig.label}] (${isoDate()})`);

  const state = await readState(`cwv-state-${REGION}.json`, { pages: {} });

  // Semrush's domain_organic report isn't scoped by URL path, so the raw
  // top-pages list can include pages from other locales (AU, INT, ...).
  // Filter to this region's path prefix before taking the top 20.
  const topPages = await getTopOrganicPages(SEMRUSH_DOMAIN, { database: regionConfig.database });
  const topUrls = topPages
    .filter((p) => isInRegion(p.url))
    .slice(0, TOP_N)
    .map((p) => p.url);
  console.log(`Top ${topUrls.length} ${regionConfig.label} landing pages pulled from Semrush.`);

  let newUrls = [];
  try {
    const sitemapUrls = await getAllSitePages({ pathPrefix: regionConfig.pathPrefix });
    const trackedAlready = new Set([...topUrls, ...Object.keys(state.pages)]);
    newUrls = sitemapUrls
      .filter((url) => {
        try {
          return isTrackablePage(new URL(url).pathname) && !trackedAlready.has(url);
        } catch {
          return false;
        }
      })
      .slice(0, MAX_NEW_PAGES_PER_RUN);
    console.log(
      `Sitemap crawl found ${sitemapUrls.length} ${regionConfig.label} page(s); ${newUrls.length} brand-new page(s) added this run.`
    );
  } catch (err) {
    console.warn(`Sitemap crawl failed, continuing with Semrush top pages only: ${err.message}`);
  }

  const newUrlSet = new Set(newUrls);
  const urls = [...topUrls, ...newUrls];

  // Pull existing items from both groups, since a page can live in either
  // (new pages move into the Top 20 group naturally once they start
  // ranking; until then they stay put, matched the same way by URL).
  const existingItems = [
    ...(await monday.getBoardItems(boards.mobilePerformance.id, {
      groupId: boards.mobilePerformance.top20GroupId,
      columnIds: [boards.mobilePerformance.columns.pageUrl],
    })),
    ...(await monday.getBoardItems(boards.mobilePerformance.id, {
      groupId: boards.mobilePerformance.newPagesGroupId,
      columnIds: [boards.mobilePerformance.columns.pageUrl],
    })),
  ];
  const existingByUrl = new Map();
  for (const item of existingItems) {
    const urlCol = item.column_values.find((c) => c.id === boards.mobilePerformance.columns.pageUrl);
    let url;
    try {
      url = urlCol?.value ? JSON.parse(urlCol.value).url : null;
    } catch {
      url = null;
    }
    if (url) existingByUrl.set(url, item.id);
  }

  const results = [];
  const failures = [];

  for (const [index, url] of urls.entries()) {
    console.log(`[${index + 1}/${urls.length}] Checking ${url}`);
    const psi = await getPageSpeed(url);

    if (psi.error) {
      console.warn(`  Failed: ${psi.error}`);
      failures.push({ url, error: psi.error });
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
      continue;
    }

    const template = guessTemplate(url);
    const columnValues = {
      [boards.mobilePerformance.columns.pageUrl]: monday.columnValue.link(url),
      [boards.mobilePerformance.columns.assignee]: monday.columnValue.people([DEFAULT_ASSIGNEE_ID]),
      [boards.mobilePerformance.columns.lcp]: monday.columnValue.numbers(psi.lcpSeconds),
      [boards.mobilePerformance.columns.inp]: monday.columnValue.numbers(psi.inpMs),
      [boards.mobilePerformance.columns.cls]: monday.columnValue.numbers(psi.clsValue),
      [boards.mobilePerformance.columns.cwvStatus]: monday.columnValue.status(psi.status),
      [boards.mobilePerformance.columns.imageCompression]: monday.columnValue.status(
        psi.opportunities.imageOptimization ? "Needs Work" : "Done"
      ),
      [boards.mobilePerformance.columns.lazyLoading]: monday.columnValue.status(
        psi.opportunities.lazyLoading ? "Needs Work" : "Done"
      ),
      [boards.mobilePerformance.columns.renderBlockingFix]: monday.columnValue.status(
        psi.opportunities.renderBlocking ? "Dev Needed" : "Done"
      ),
      [boards.mobilePerformance.columns.template]: monday.columnValue.text(template),
      [boards.mobilePerformance.columns.reviewDate]: monday.columnValue.date(isoDate()),
      [boards.mobilePerformance.columns.dataSource]: monday.columnValue.status(psi.dataSource),
      [boards.mobilePerformance.columns.labLcp]: monday.columnValue.numbers(psi.labLcpSeconds),
      [boards.mobilePerformance.columns.labCls]: monday.columnValue.numbers(psi.labClsValue),
      [boards.mobilePerformance.columns.accessibilityScore]: monday.columnValue.numbers(psi.accessibilityScore),
      [boards.mobilePerformance.columns.accessibilityIssues]: monday.columnValue.text(
        psi.accessibilityFindings.length ? psi.accessibilityFindings.join("; ") : "None found"
      ),
      [boards.mobilePerformance.columns.adaFixNeeded]: monday.columnValue.status(psi.adaStatus),
    };

    const needsAnyFix =
      psi.opportunities.imageOptimization || psi.opportunities.lazyLoading ||
      psi.opportunities.renderBlocking || psi.adaStatus !== "Done";

    const existingItemId = existingByUrl.get(url);
    if (existingItemId) {
      // Review Status is deliberately left out of this update: once a human
      // has moved it off "Needs Review" (e.g. to Approved), a re-run must
      // not reset it, even if the underlying fix flags change.
      await monday.changeColumnValues(boards.mobilePerformance.id, existingItemId, columnValues);
    } else {
      await monday.createItem(
        boards.mobilePerformance.id,
        newUrlSet.has(url) ? boards.mobilePerformance.newPagesGroupId : boards.mobilePerformance.top20GroupId,
        pageNameFromUrl(url),
        {
          ...columnValues,
          [boards.mobilePerformance.columns.reviewStatus]: monday.columnValue.status(
            needsAnyFix ? "Needs Review" : "No Action Needed"
          ),
        }
      );
    }

    const previous = state.pages[url];
    results.push({
      url,
      status: psi.status,
      lcpSeconds: psi.lcpSeconds,
      inpMs: psi.inpMs,
      clsValue: psi.clsValue,
      accessibilityScore: psi.accessibilityScore,
      adaStatus: psi.adaStatus,
      isNewPage: newUrlSet.has(url),
      changedFromPass: previous === "Pass" && psi.status !== "Pass",
      changedToPass: previous !== "Pass" && psi.status === "Pass",
    });
    state.pages[url] = psi.status;

    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  const passCount = results.filter((r) => r.status === "Pass").length;
  const passRate = urls.length > 0 ? Math.round((passCount / urls.length) * 100) : null;

  // Update KPI dashboard.
  const kpiGroupId = boards.kpiDashboard.snapshotsGroupId;
  const monthName = monthGroupName();
  const kpiItems = await monday.getBoardItems(boards.kpiDashboard.id, { groupId: kpiGroupId });
  let kpiItem = kpiItems.find((i) => i.name === monthName);

  const regressed = results.filter((r) => r.changedFromPass).map((r) => r.url);
  const improved = results.filter((r) => r.changedToPass).map((r) => r.url);
  const newPageCount = results.filter((r) => r.isNewPage).length;
  const adaIssueCount = results.filter((r) => r.adaStatus !== "Done").length;
  const notesLines = [
    `${isoDate()}: CWV pass rate ${passRate}% (${passCount}/${urls.length}).`,
    improved.length ? `Improved to Pass: ${improved.join(", ")}` : null,
    regressed.length ? `Regressed from Pass: ${regressed.join(", ")}` : null,
    newPageCount ? `${newPageCount} brand-new page(s) added from the sitemap crawl.` : null,
    adaIssueCount ? `${adaIssueCount} page(s) have an accessibility issue flagged.` : null,
    failures.length ? `${failures.length} page(s) could not be checked (Lighthouse run failed).` : null,
  ].filter(Boolean).join(" ");

  const kpiColumnValues = {
    [boards.kpiDashboard.columns.cwvPassRate]: monday.columnValue.numbers(passRate),
    [boards.kpiDashboard.columns.reportDate]: monday.columnValue.date(isoDate()),
    [boards.kpiDashboard.columns.notes]: monday.columnValue.text(notesLines),
  };

  if (!kpiItem) {
    const id = await monday.createItem(boards.kpiDashboard.id, kpiGroupId, monthName, kpiColumnValues);
    kpiItem = { id };
  } else {
    // Overwrite the Notes column rather than posting an Update, so the
    // latest run's summary lives on the board itself instead of in the
    // activity feed.
    await monday.changeColumnValues(boards.kpiDashboard.id, kpiItem.id, kpiColumnValues);
  }

  await writeState(`cwv-state-${REGION}.json`, state);

  const worst = [...results].sort((a, b) => (b.lcpSeconds ?? 0) - (a.lcpSeconds ?? 0)).slice(0, 5);

  console.log(`Monthly Core Web Vitals pull complete [${regionConfig.label}].`);
  console.log(`  Pass rate: ${passRate}% (${passCount}/${urls.length})`);
  console.log(`  Failures: ${failures.length}`);
  console.log("  Worst 5 by LCP:");
  for (const page of worst) {
    console.log(`    ${page.url}: LCP ${page.lcpSeconds}s, status ${page.status}`);
  }
  if (failures.length > 0) {
    console.log("  Pages that could not be checked this run (left with prior data):");
    for (const f of failures) console.log(`    ${f.url}: ${f.error}`);
  }
}

function pageNameFromUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return path === "" ? u.hostname : path;
  } catch {
    return url;
  }
}

function guessTemplate(url) {
  let pathname = "/";
  try {
    pathname = new URL(url).pathname;
  } catch {
    // leave default
  }
  const lower = pathname.toLowerCase();
  if (lower === "" || lower === "/") return "homepage";
  if (lower.includes("/blog/") || lower.includes("/news/")) return "blog-post";
  if (lower.includes("/collections/") || lower.includes("/products/")) return "product-collection";
  return "category";
}

main().catch((err) => {
  console.error("Monthly Core Web Vitals pull failed:", err);
  process.exitCode = 1;
});
