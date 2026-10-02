// Weekly Havwoods GEO / AI search visibility pull. Runs once per region
// (US or UK), selected by the REGION env var — see .github/workflows/
// weekly-geo-ai-tracking.yml (US) and weekly-geo-ai-tracking-uk.yml (UK).
// The UK run is a no-op until OTTERLY_REPORT_ID_UK is set (see
// src/config.js) — there's no UK Otterly brand report yet, so it just logs
// that it's skipping rather than failing the workflow.
//
// 1. Reads the prompt set configured in this region's Otterly AI brand
//    report.
// 2. For each prompt, gets the latest AI response per engine (ChatGPT,
//    Google AI Overview, Perplexity, Gemini, Copilot).
// 3. Classifies each prompt/engine pair: is Havwoods cited, is a
//    competitor cited instead, or is nothing cited at all.
// 4. Upserts one row per prompt/engine pair onto this region's HW GEO / AI
//    Search Tracking board, keyed by a hidden Sync Key column
//    (promptId:engine) so re-runs always update the same row instead of
//    duplicating it, even if the prompt wording or display name ever
//    changes.

import { boardsByRegion, regions, resolveRegion, otterlyConfigFor, BRAND_DOMAIN, promptCategoryKeywords, isoDate } from "./config.js";
import * as monday from "./lib/monday.js";
import { listPrompts, listAiResponses, latestRunPerEngine, classifyResponse, ENGINE_LABELS } from "./lib/otterly.js";

const REGION = resolveRegion();
const regionConfig = regions[REGION];
const boards = boardsByRegion[REGION];
const otterly = otterlyConfigFor(REGION);

// Otterly keeps running the same prompt on a rolling basis rather than on a
// fixed daily schedule, so a 14-day trailing window is used to reliably
// catch the latest run per engine even if a given engine skipped a week.
const WINDOW_DAYS = 14;

function dateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return isoDate(d);
}

function guessPageType(url) {
  if (!url) return "N/A";
  let pathname = "/";
  try {
    pathname = new URL(url).pathname;
  } catch {
    return "N/A";
  }
  const lower = pathname.toLowerCase();
  if (lower === "" || lower === "/") return "Homepage";
  if (lower.includes("/blog/") || lower.includes("/advice/") || lower.includes("/news/")) return "Blog / Advice";
  if (lower.includes("/collections/") || lower.includes("/products/")) return "Product / Collection Page";
  return "Category Page";
}

function guessCategory(promptText) {
  for (const { pattern, label } of promptCategoryKeywords) {
    if (pattern.test(promptText)) return label;
  }
  return "General / Brand";
}

async function main() {
  if (!otterly) {
    console.log(
      `GEO / AI search tracking pull skipped [${regionConfig.label}]: OTTERLY_REPORT_ID_UK is not set yet. ` +
        `Set it once the UK Otterly brand report exists and this job will start running automatically.`
    );
    return;
  }

  console.log(`GEO / AI search tracking pull starting for ${BRAND_DOMAIN} [${regionConfig.label}] (${isoDate()})`);

  const startDate = dateDaysAgo(WINDOW_DAYS);
  const endDate = isoDate();

  const prompts = await listPrompts(otterly.reportId, { startDate, endDate, country: otterly.country });
  console.log(`${prompts.length} prompt(s) configured on the Otterly brand report.`);

  const existingItems = await monday.getBoardItems(boards.geoAiTracking.id, {
    groupId: boards.geoAiTracking.groupId,
    columnIds: [boards.geoAiTracking.columns.syncKey],
  });
  const existingByKey = new Map();
  for (const item of existingItems) {
    const key = item.column_values.find((c) => c.id === boards.geoAiTracking.columns.syncKey)?.text;
    if (key) existingByKey.set(key, item.id);
  }

  let citedCount = 0;
  let competitorCount = 0;
  let notCitedCount = 0;
  let rowsWritten = 0;
  const failures = [];

  for (const prompt of prompts) {
    let responses;
    try {
      responses = await listAiResponses(otterly.reportId, prompt.id, {
        startDate,
        endDate,
        country: otterly.country,
      });
    } catch (err) {
      console.warn(`  Failed to pull AI responses for "${prompt.prompt}": ${err.message}`);
      failures.push({ prompt: prompt.prompt, error: err.message });
      continue;
    }

    const latestRuns = latestRunPerEngine(responses);
    const category = guessCategory(prompt.prompt);

    for (const run of latestRuns) {
      const engineLabel = ENGINE_LABELS[run.engine];
      if (!engineLabel) continue; // engine not mapped to a board label, skip it

      const { status, citation } = classifyResponse(run, BRAND_DOMAIN);
      const citedUrl = citation?.link ?? null;

      if (status === "Cited") citedCount += 1;
      else if (status === "Competitor Cited Instead") competitorCount += 1;
      else notCitedCount += 1;

      const brandMentionCount = (run.brandMentions ?? []).find((b) => b.isMainBrand)?.mentions ?? 0;
      const notesLines = [
        `Checked ${isoDate(new Date(run.runDate))}.`,
        citation ? `Top citation: ${citation.title} (${citation.link}).` : "No citations returned.",
        brandMentionCount > 0 ? `Havwoods mentioned ${brandMentionCount} time(s) in the response text.` : null,
      ].filter(Boolean).join(" ");

      const syncKey = `${prompt.id}:${run.engine}`;
      const itemName = `${prompt.prompt} (${engineLabel})`;
      const columnValues = {
        [boards.geoAiTracking.columns.category]: monday.columnValue.status(category),
        [boards.geoAiTracking.columns.aiPlatform]: monday.columnValue.status(engineLabel),
        [boards.geoAiTracking.columns.havwoodsCited]: monday.columnValue.status(status),
        [boards.geoAiTracking.columns.citedUrl]: citedUrl ? monday.columnValue.link(citedUrl) : "",
        [boards.geoAiTracking.columns.citedPageType]: monday.columnValue.status(
          status === "Not Cited" ? "N/A" : guessPageType(citedUrl)
        ),
        [boards.geoAiTracking.columns.lastChecked]: monday.columnValue.date(isoDate(new Date(run.runDate))),
        [boards.geoAiTracking.columns.notes]: monday.columnValue.text(notesLines),
        [boards.geoAiTracking.columns.syncKey]: monday.columnValue.text(syncKey),
      };

      const existingItemId = existingByKey.get(syncKey);
      if (existingItemId) {
        await monday.changeColumnValues(boards.geoAiTracking.id, existingItemId, columnValues);
      } else {
        await monday.createItem(boards.geoAiTracking.id, boards.geoAiTracking.groupId, itemName, columnValues);
      }
      rowsWritten += 1;
    }
  }

  console.log(`GEO / AI search tracking pull complete [${regionConfig.label}].`);
  console.log(`  Rows written: ${rowsWritten}`);
  console.log(`  Cited: ${citedCount}, Competitor cited instead: ${competitorCount}, Not cited: ${notCitedCount}`);
  if (failures.length > 0) {
    console.log(`  ${failures.length} prompt(s) could not be checked:`);
    for (const f of failures) console.log(`    ${f.prompt}: ${f.error}`);
  }
}

main().catch((err) => {
  console.error("GEO / AI search tracking pull failed:", err);
  process.exitCode = 1;
});
