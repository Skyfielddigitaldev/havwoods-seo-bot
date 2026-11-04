// Refreshes Semrush metrics (search volume, keyword difficulty, CPC) for
// every keyword already on the HW Target Keywords board, for the given
// region. Run once per region (REGION=us or REGION=uk); each run only
// updates the group that belongs to that region.
//
// No new keywords are added — this job strictly refreshes existing rows.
// Add new keywords directly in monday.com; they'll be picked up on the
// next scheduled run.
//
// Rate limiting: Semrush's keyword_overview report accepts up to 100
// keywords per call. This job batches accordingly and adds a short pause
// between batches to stay inside the API's request-rate limit.

import "dotenv/config";
import { getBoardItems, changeColumnValues, columnValue } from "./lib/monday.js";
import { resolveRegion, regions, boardsByRegion } from "./config.js";

const SEMRUSH_ANALYTICS_URL = "https://api.semrush.com/";
const BATCH_SIZE = 100; // Semrush keyword_overview max per call
const BATCH_PAUSE_MS = 1200; // ~50 req/min safe margin

function requireSemrushKey() {
  const key = process.env.SEMRUSH_API_KEY;
  if (!key) {
    throw new Error(
      "SEMRUSH_API_KEY is not set. Add it as a GitHub Actions secret or in " +
        "a local .env file (see .env.example)."
    );
  }
  return key;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetches keyword_overview data for up to 100 keywords in one call.
// Returns a Map keyed by keyword phrase (lowercase) -> { volume, kd, cpc }.
// Keywords not found in Semrush for this database return null in the map.
async function fetchKeywordMetrics(keywords, database) {
  const key = requireSemrushKey();
  // Semrush expects a semicolon-delimited keyword list for phrase_this.
  // For multiple keywords in one call we use the keyword_overview endpoint
  // with the phrase parameter repeated — Semrush actually accepts a
  // semicolon-joined list as a single phrase param value for batch calls.
  const phrasesParam = keywords.map((k) => encodeURIComponent(k)).join("%3B");
  const url =
    `${SEMRUSH_ANALYTICS_URL}?type=phrase_these&key=${key}` +
    `&phrase=${phrasesParam}` +
    `&database=${database}` +
    `&export_columns=Ph,Nq,Kd,Cp`;

  const res = await fetch(url);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Semrush API HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (text.startsWith("ERROR")) {
    // ERROR 50 = no data for these keywords in this database — not fatal.
    if (text.includes("ERROR 50")) {
      console.log(`    Semrush returned no data for this batch in database "${database}".`);
      return new Map();
    }
    throw new Error(`Semrush API error: ${text.slice(0, 500)}`);
  }

  const lines = text.trim().split("\n").filter(Boolean);
  const result = new Map();
  for (const line of lines) {
    const [phrase, volume, kd, cpc] = line.split(";");
    if (!phrase) continue;
    result.set(phrase.trim().toLowerCase(), {
      volume: Number(volume) || 0,
      kd: Number(kd) || 0,
      cpc: parseFloat(cpc) || 0,
    });
  }
  return result;
}

async function run() {
  const regionKey = resolveRegion();
  const region = regions[regionKey];
  const board = boardsByRegion[regionKey];

  // The HW Target Keywords board is not in boardsByRegion yet — we keep it
  // separate here since it's driven by this script rather than a Semrush/
  // Otterly automated board. The board ID and group IDs are hardcoded below
  // because this board has no UK duplicate; both regions live on the same
  // board in separate groups.
  const TARGET_KEYWORDS_BOARD_ID = 8168240416;
  const groupIdByRegion = {
    us: "topics",
    uk: "group_mm8s1qzb",
  };
  const locationLabelByRegion = {
    us: "USA",
    uk: "United Kingdom",
  };

  const groupId = groupIdByRegion[regionKey];
  const locationLabel = locationLabelByRegion[regionKey];

  console.log(`\nHW Target Keywords refresh — ${region.label}`);
  console.log(`  Board:    ${TARGET_KEYWORDS_BOARD_ID}`);
  console.log(`  Group:    ${groupId}`);
  console.log(`  Database: ${region.database}`);

  // 1. Read all existing keyword items for this region's group.
  console.log("\nReading existing keywords from monday.com...");
  const items = await getBoardItems(TARGET_KEYWORDS_BOARD_ID, {
    groupId,
    columnIds: ["name", "location__1", "search_volume__1", "keyword_difficulty__1", "cost_per_click__1"],
  });
  console.log(`  Found ${items.length} keywords.`);

  if (items.length === 0) {
    console.log("  Nothing to refresh. Add keywords directly in monday.com.");
    return;
  }

  // 2. Batch keywords and fetch fresh Semrush metrics.
  console.log(`\nFetching Semrush keyword metrics (database: ${region.database})...`);
  const allMetrics = new Map();
  let batchNum = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batchNum += 1;
    const batch = items.slice(i, i + BATCH_SIZE);
    const keywords = batch.map((item) => item.name.toLowerCase());
    console.log(
      `  Batch ${batchNum}: ${batch.length} keywords (${i + 1}–${Math.min(i + BATCH_SIZE, items.length)} of ${items.length})`
    );
    const metrics = await fetchKeywordMetrics(keywords, region.database);
    for (const [k, v] of metrics) allMetrics.set(k, v);
    if (i + BATCH_SIZE < items.length) await sleep(BATCH_PAUSE_MS);
  }
  console.log(`  Received metrics for ${allMetrics.size} of ${items.length} keywords.`);

  // 3. Update each monday.com item with fresh metrics.
  console.log("\nUpdating monday.com items...");
  let updated = 0;
  let noData = 0;

  for (const item of items) {
    const key = item.name.toLowerCase();
    const metrics = allMetrics.get(key);

    if (!metrics) {
      console.log(`  [no data] ${item.name}`);
      noData += 1;
      continue;
    }

    const cols = item.column_values ?? {};
    const currentVolume = cols.search_volume__1 ? String(cols.search_volume__1) : "";
    const currentKd = cols.keyword_difficulty__1 ? String(cols.keyword_difficulty__1) : "";
    const currentCpc = cols.cost_per_click__1 ? String(cols.cost_per_click__1) : "";
    const currentLocation = cols.location__1 ?? "";

    const newVolume = String(metrics.volume);
    const newKd = String(metrics.kd);
    const newCpc = String(metrics.cpc);

    // Skip if nothing changed (avoids unnecessary monday.com mutations and
    // "updated_at" noise on rows that haven't changed).
    if (
      currentVolume === newVolume &&
      currentKd === newKd &&
      currentCpc === newCpc &&
      currentLocation === locationLabel
    ) {
      continue;
    }

    await changeColumnValues(TARGET_KEYWORDS_BOARD_ID, item.id, {
      location__1: locationLabel,
      search_volume__1: columnValue.numbers(metrics.volume),
      keyword_difficulty__1: columnValue.numbers(metrics.kd),
      cost_per_click__1: columnValue.numbers(metrics.cpc),
    });

    updated += 1;
    console.log(
      `  [updated] ${item.name}  vol=${metrics.volume}  kd=${metrics.kd}  cpc=${metrics.cpc}`
    );
  }

  console.log(`\nDone. Updated: ${updated}  No Semrush data: ${noData}  Unchanged: ${items.length - updated - noData}`);
}

run().catch((err) => {
  console.error("Keyword refresh failed:", err.message);
  process.exit(1);
});
