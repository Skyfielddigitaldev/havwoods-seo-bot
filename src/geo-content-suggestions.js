// Weekly GEO content-gap pull. Runs once per region (US or UK), selected by
// the REGION env var — see .github/workflows/weekly-geo-content-
// suggestions.yml (US) and weekly-geo-content-suggestions-uk.yml (UK). The
// UK run is a no-op until OTTERLY_REPORT_ID_UK is set (see src/config.js).
//
// For every Otterly prompt where Havwoods is not cited anywhere (or a
// competitor is cited instead), suggests which existing Havwoods page
// should get expanded content to compete for that prompt, or flags that a
// new page is needed.
//
// Like the link-opportunities job, this only ever creates/updates rows with
// Review Status "Needs Review" on this region's HW GEO Content Suggestions
// board — it never writes to the live site. A re-run never touches Review
// Status on an existing row, so it can't undo a human's Approved/Done
// decision.
//
// Target-page matching reuses this region's HW Priority Pages Performance
// as its source of truth for "which URL currently represents each product
// category" — that board is already kept current by the weekly technical
// SEO job — so this stays correct without hardcoding URLs here.

import { boardsByRegion, regions, resolveRegion, otterlyConfigFor, BRAND_DOMAIN, promptCategoryKeywords, isoDate } from "./config.js";
import * as monday from "./lib/monday.js";
import { listPrompts, listAiResponses, latestRunPerEngine, classifyResponse, ENGINE_LABELS } from "./lib/otterly.js";

const REGION = resolveRegion();
const regionConfig = regions[REGION];
const boards = boardsByRegion[REGION];
const otterly = otterlyConfigFor(REGION);

const WINDOW_DAYS = 14;

function dateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return isoDate(d);
}

function guessCategory(promptText) {
  for (const { pattern, label } of promptCategoryKeywords) {
    if (pattern.test(promptText)) return label;
  }
  return null; // no confident category match -> likely needs a new page
}

// Builds { categoryLabel -> pageUrl } from the current HW Priority Pages
// Performance board, so target-page suggestions always point at whichever
// page is actually representing that category this week.
async function loadCategoryPageMap() {
  const items = await monday.getBoardItems(boards.priorityPages.id, {
    groupId: boards.priorityPages.groupId,
    columnIds: [boards.priorityPages.columns.priorityCategory, boards.priorityPages.columns.pageUrl],
  });
  const map = new Map();
  for (const item of items) {
    const category = item.column_values.find((c) => c.id === boards.priorityPages.columns.priorityCategory)?.text;
    const urlCol = item.column_values.find((c) => c.id === boards.priorityPages.columns.pageUrl);
    let url = null;
    try {
      url = urlCol?.value ? JSON.parse(urlCol.value).url : null;
    } catch {
      url = null;
    }
    if (category && url && !map.has(category)) map.set(category, url);
  }
  return map;
}

async function main() {
  if (!otterly) {
    console.log(
      `GEO content-gap pull skipped [${regionConfig.label}]: OTTERLY_REPORT_ID_UK is not set yet. ` +
        `Set it once the UK Otterly brand report exists and this job will start running automatically.`
    );
    return;
  }

  console.log(`GEO content-gap pull starting for ${BRAND_DOMAIN} [${regionConfig.label}] (${isoDate()})`);
  const startDate = dateDaysAgo(WINDOW_DAYS);
  const endDate = isoDate();
  const prompts = await listPrompts(otterly.reportId, { startDate, endDate, country: otterly.country });
  console.log(`${prompts.length} prompt(s) configured on the Otterly brand report.`);

  const categoryPageMap = await loadCategoryPageMap();

  const existingItems = await monday.getBoardItems(boards.geoContentSuggestions.id, {
    groupId: boards.geoContentSuggestions.groupId,
    columnIds: [boards.geoContentSuggestions.columns.syncKey],
  });
  const existingByKey = new Map();
  for (const item of existingItems) {
    const key = item.column_values.find((c) => c.id === boards.geoContentSuggestions.columns.syncKey)?.text;
    if (key) existingByKey.set(key, item.id);
  }

  let suggested = 0;
  let updated = 0;
  let skippedAlreadyCited = 0;
  const failures = [];

  for (const prompt of prompts) {
    let responses;
    try {
      responses = await listAiResponses(otterly.reportId, prompt.id, { startDate, endDate, country: otterly.country });
    } catch (err) {
      failures.push({ prompt: prompt.prompt, error: err.message });
      continue;
    }

    const latestRuns = latestRunPerEngine(responses);
    const classified = latestRuns.map((run) => ({ run, ...classifyResponse(run, BRAND_DOMAIN) }));
    if (classified.some((c) => c.status === "Cited")) {
      skippedAlreadyCited += 1;
      continue; // already winning this prompt somewhere, no content gap to flag
    }
    if (classified.length === 0) continue;

    const gapType = classified.some((c) => c.status === "Competitor Cited Instead")
      ? "Competitor Cited Instead"
      : "Not Cited";
    const representative = classified.find((c) => c.status === "Competitor Cited Instead") ?? classified[0];
    const engineLabel = ENGINE_LABELS[representative.run.engine] ?? representative.run.engine;

    const category = guessCategory(prompt.prompt);
    const targetUrl = category ? categoryPageMap.get(category) : null;
    const newPageNeeded = !targetUrl;

    const suggestedContent = newPageNeeded
      ? `No existing Havwoods page closely matches this prompt's category${category ? ` (${category})` : ""}. Consider a new page or blog post that directly answers: "${prompt.prompt}".`
      : `Expand ${targetUrl} with a section or FAQ directly answering: "${prompt.prompt}". ${
          representative.citation
            ? `Competitor currently cited for this: ${representative.citation.title ?? representative.citation.link} (${representative.citation.link}) — match or exceed the specificity of that answer.`
            : "No competitor citation found either; this is an open opportunity."
        }`;

    const syncKey = prompt.id;
    const columnValues = {
      [boards.geoContentSuggestions.columns.aiPlatform]: monday.columnValue.status(engineLabel),
      [boards.geoContentSuggestions.columns.gapType]: monday.columnValue.status(gapType),
      [boards.geoContentSuggestions.columns.newPageNeeded]: monday.columnValue.checkbox(newPageNeeded),
      [boards.geoContentSuggestions.columns.suggestedContent]: monday.columnValue.text(suggestedContent),
      [boards.geoContentSuggestions.columns.dateSuggested]: monday.columnValue.date(isoDate()),
      ...(targetUrl ? { [boards.geoContentSuggestions.columns.targetUrl]: monday.columnValue.link(targetUrl) } : {}),
    };

    const existingId = existingByKey.get(syncKey);
    if (existingId) {
      // Review Status is deliberately left out of this update: once a human
      // has moved it off "Needs Review", a re-run must not reset it.
      await monday.changeColumnValues(boards.geoContentSuggestions.id, existingId, columnValues);
      updated += 1;
    } else {
      await monday.createItem(
        boards.geoContentSuggestions.id,
        boards.geoContentSuggestions.groupId,
        prompt.prompt.slice(0, 250),
        {
          ...columnValues,
          [boards.geoContentSuggestions.columns.reviewStatus]: monday.columnValue.status("Needs Review"),
          [boards.geoContentSuggestions.columns.syncKey]: monday.columnValue.text(syncKey),
        }
      );
      suggested += 1;
    }
  }

  console.log(`GEO content-gap pull complete [${regionConfig.label}].`);
  console.log(`  New suggestions: ${suggested}, refreshed: ${updated}, already cited (skipped): ${skippedAlreadyCited}`);
  if (failures.length > 0) {
    console.log(`  ${failures.length} prompt(s) could not be checked:`);
    for (const f of failures) console.log(`    ${f.prompt}: ${f.error}`);
  }
}

main().catch((err) => {
  console.error("GEO content-gap pull failed:", err);
  process.exitCode = 1;
});
