// Monthly Havwoods (US) Core Web Vitals pull.
// Run by .github/workflows/monthly-core-web-vitals.yml on the 2nd of each
// month.
//
// 1. Gets the current top 20 US landing pages by organic traffic from
//    Semrush.
// 2. Runs each through Google PageSpeed Insights (mobile) for real
//    field-data LCP / INP / CLS.
// 3. Upserts each page as an item on HW Mobile & Performance.
// 4. Rolls the pass rate into HW KPI Dashboard.

import { boards, DEFAULT_ASSIGNEE_ID, SEMRUSH_DOMAIN, SEMRUSH_DATABASE, monthGroupName, isoDate } from "./config.js";
import * as monday from "./lib/monday.js";
import { getTopOrganicPages } from "./lib/semrush.js";
import { getPageSpeed } from "./lib/pagespeed.js";
import { readState, writeState } from "./lib/state.js";

const TOP_N = 20;
const DELAY_BETWEEN_REQUESTS_MS = 1500; // be polite to the shared PSI quota

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`Monthly Core Web Vitals pull starting for ${SEMRUSH_DOMAIN} (${isoDate()})`);

  const state = await readState("cwv-state.json", { pages: {} });

  const topPages = await getTopOrganicPages(SEMRUSH_DOMAIN, { database: SEMRUSH_DATABASE });
  const urls = topPages.slice(0, TOP_N).map((p) => p.url);
  console.log(`Top ${urls.length} landing pages pulled from Semrush.`);

  const existingItems = await monday.getBoardItems(boards.mobilePerformance.id, {
    groupId: boards.mobilePerformance.top20GroupId,
    columnIds: [boards.mobilePerformance.columns.pageUrl],
  });
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
    const psi = await getPageSpeed(url, { strategy: "mobile" });

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
    };

    const existingItemId = existingByUrl.get(url);
    if (existingItemId) {
      await monday.changeColumnValues(boards.mobilePerformance.id, existingItemId, columnValues);
    } else {
      await monday.createItem(
        boards.mobilePerformance.id,
        boards.mobilePerformance.top20GroupId,
        pageNameFromUrl(url),
        columnValues
      );
    }

    const previous = state.pages[url];
    results.push({
      url,
      status: psi.status,
      lcpSeconds: psi.lcpSeconds,
      inpMs: psi.inpMs,
      clsValue: psi.clsValue,
      usedLabData: psi.usedLabData,
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
  const notesLines = [
    `${isoDate()}: CWV pass rate ${passRate}% (${passCount}/${urls.length}).`,
    improved.length ? `Improved to Pass: ${improved.join(", ")}` : null,
    regressed.length ? `Regressed from Pass: ${regressed.join(", ")}` : null,
    failures.length ? `${failures.length} page(s) could not be checked (rate limited or errored).` : null,
  ].filter(Boolean).join(" ");

  if (!kpiItem) {
    const id = await monday.createItem(boards.kpiDashboard.id, kpiGroupId, monthName, {
      [boards.kpiDashboard.columns.cwvPassRate]: monday.columnValue.numbers(passRate),
      [boards.kpiDashboard.columns.reportDate]: monday.columnValue.date(isoDate()),
      [boards.kpiDashboard.columns.notes]: monday.columnValue.text(notesLines),
    });
    kpiItem = { id };
  } else {
    await monday.changeColumnValues(boards.kpiDashboard.id, kpiItem.id, {
      [boards.kpiDashboard.columns.cwvPassRate]: monday.columnValue.numbers(passRate),
      [boards.kpiDashboard.columns.reportDate]: monday.columnValue.date(isoDate()),
    });
    await monday.createUpdate(kpiItem.id, notesLines);
  }

  await writeState("cwv-state.json", state);

  const worst = [...results].sort((a, b) => (b.lcpSeconds ?? 0) - (a.lcpSeconds ?? 0)).slice(0, 5);
  console.log("Monthly Core Web Vitals pull complete.");
  console.log(`  Pass rate: ${passRate}% (${passCount}/${urls.length})`);
  console.log(`  Failures: ${failures.length}`);
  console.log("  Worst 5 by LCP:");
  for (const page of worst) {
    console.log(`    ${page.url} — LCP ${page.lcpSeconds}s, status ${page.status}`);
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
