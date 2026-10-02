// Weekly GEO link-opportunity pull: turns Otterly AI prompt/citation data
// into draft backlink and internal-link suggestions. Runs once per region
// (US or UK), selected by the REGION env var — see .github/workflows/
// weekly-geo-link-opportunities.yml (US) and
// weekly-geo-link-opportunities-uk.yml (UK). The UK run is a no-op until
// OTTERLY_REPORT_ID_UK is set (see src/config.js).
//
// This is a suggestion engine, not an auto-publisher: every row it creates
// lands with Review Status "Needs Review" on a manually-run board
// (HW Off-Page SEO or HW Internal Linking, or their UK twins), in a
// dedicated "GEO Suggestions (Bot)" group so it never touches the
// human-curated monthly groups. A Skyfield/Havwoods reviewer approves (or
// rejects) each one; the bot never flips a row's Review Status on a re-run
// once it has been set, so it can't undo a human decision.
//
// Backlink suggestions (HW Off-Page SEO): when a competitor is cited
// instead of Havwoods for a prompt that reads as either a "best of"
// listicle (about products/collections) or a brand-ranking question (about
// companies/brands), the cited article is a real backlink/placement target
// worth pursuing.
//
// Internal link suggestions (HW Internal Linking): for longer, natural-
// language prompts/questions pulled from the same Otterly data, reinforcing
// or building the page that should answer that prompt with more internal
// links.
//
// Both classifications are keyword heuristics over the prompt text, not a
// deep content analysis. They are meant to surface candidates for a human
// to confirm, not to be perfectly precise.

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

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// "Best hardwood flooring brands", "top 5 wood flooring companies" — prompts
// asking AI to rank or recommend companies/brands rather than products.
function isBrandPerceptionPrompt(text) {
  return /\b(brand|brands|company|companies|manufacturer|manufacturers)\b/i.test(text) &&
    /\b(best|top|leading|recommend)\b/i.test(text);
}

// "Best herringbone flooring for a kitchen", "top wide plank options" —
// "best of" prompts about products/styles rather than companies.
function isListiclePrompt(text) {
  return /\b(best|top\s*\d*)\b/i.test(text) && !isBrandPerceptionPrompt(text);
}

// Longer natural-language prompts/questions are the ones worth reinforcing
// with internal links (short head-term keywords belong to the SEO half of
// the board instead, which the team manages directly).
function isQuestionOrLongPrompt(text) {
  const wordCount = text.trim().split(/\s+/).length;
  return /^(how|what|why|which|can|does|do|is|are|when|where|should)\b/i.test(text.trim()) || wordCount >= 6;
}

function guessPriorityCategory(promptText) {
  for (const { pattern, label } of promptCategoryKeywords) {
    if (pattern.test(promptText)) return label;
  }
  return "Other Commercial Page";
}

async function main() {
  if (!otterly) {
    console.log(
      `GEO link-opportunity pull skipped [${regionConfig.label}]: OTTERLY_REPORT_ID_UK is not set yet. ` +
        `Set it once the UK Otterly brand report exists and this job will start running automatically.`
    );
    return;
  }

  console.log(`GEO link-opportunity pull starting for ${BRAND_DOMAIN} [${regionConfig.label}] (${isoDate()})`);
  const startDate = dateDaysAgo(WINDOW_DAYS);
  const endDate = isoDate();
  const prompts = await listPrompts(otterly.reportId, { startDate, endDate, country: otterly.country });
  console.log(`${prompts.length} prompt(s) configured on the Otterly brand report.`);

  const [existingBacklinkItems, existingInternalLinkItems] = await Promise.all([
    monday.getBoardItems(boards.offPageSeo.id, {
      groupId: boards.offPageSeo.botGroupId,
      columnIds: [boards.offPageSeo.columns.syncKey],
    }),
    monday.getBoardItems(boards.internalLinking.id, {
      groupId: boards.internalLinking.botGroupId,
      columnIds: [boards.internalLinking.columns.syncKey],
    }),
  ]);
  const existingBacklinkByKey = new Map();
  for (const item of existingBacklinkItems) {
    const key = item.column_values.find((c) => c.id === boards.offPageSeo.columns.syncKey)?.text;
    if (key) existingBacklinkByKey.set(key, item.id);
  }
  const existingInternalLinkByKey = new Map();
  for (const item of existingInternalLinkItems) {
    const key = item.column_values.find((c) => c.id === boards.internalLinking.columns.syncKey)?.text;
    if (key) existingInternalLinkByKey.set(key, item.id);
  }

  let backlinksSuggested = 0;
  let backlinksUpdated = 0;
  let internalLinksSuggested = 0;
  let internalLinksUpdated = 0;
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
    const alreadyCited = classified.find((c) => c.status === "Cited");
    const competitorHit = classified.find((c) => c.status === "Competitor Cited Instead" && c.citation);

    // --- Backlink opportunity: only when a competitor is winning a
    // listicle/brand-ranking prompt and Havwoods isn't cited anywhere else
    // for it.
    if (!alreadyCited && competitorHit) {
      const isListicle = isListiclePrompt(prompt.prompt);
      const isBrandPerception = isBrandPerceptionPrompt(prompt.prompt);
      if (isListicle || isBrandPerception) {
        const linkType = isBrandPerception ? "GEO - Brand Perception" : "GEO - Listicle";
        const citation = competitorHit.citation;
        const domain = hostnameOf(citation.link) ?? citation.link;
        const engineLabel = ENGINE_LABELS[competitorHit.run.engine] ?? competitorHit.run.engine;
        const syncKey = `${prompt.id}:backlink`;
        const notes = [
          `Prompt: "${prompt.prompt}" (${engineLabel}, checked ${isoDate(new Date(competitorHit.run.runDate))}).`,
          `A competitor is cited instead of Havwoods via ${citation.title ?? domain} (${citation.link}).`,
          `Opportunity: get Havwoods listed/linked on this article, or pursue an equivalent placement.`,
        ].join(" ");

        const existingId = existingBacklinkByKey.get(syncKey);
        if (existingId) {
          await monday.changeColumnValues(boards.offPageSeo.id, existingId, {
            [boards.offPageSeo.columns.websiteUrl]: monday.columnValue.link(`https://${domain}`, domain),
            [boards.offPageSeo.columns.articleLink]: monday.columnValue.link(citation.link, citation.title ?? citation.link),
            [boards.offPageSeo.columns.notes]: monday.columnValue.text(notes),
            [boards.offPageSeo.columns.dateSuggested]: monday.columnValue.date(isoDate()),
            // Review Status is deliberately NOT included here: once a human
            // has moved this off "Needs Review", a re-run must not reset it.
          });
          backlinksUpdated += 1;
        } else {
          await monday.createItem(
            boards.offPageSeo.id,
            boards.offPageSeo.botGroupId,
            `${domain}: ${prompt.prompt}`.slice(0, 250),
            {
              [boards.offPageSeo.columns.websiteUrl]: monday.columnValue.link(`https://${domain}`, domain),
              [boards.offPageSeo.columns.articleLink]: monday.columnValue.link(citation.link, citation.title ?? citation.link),
              [boards.offPageSeo.columns.linkType]: monday.columnValue.status(linkType),
              [boards.offPageSeo.columns.reviewStatus]: monday.columnValue.status("Needs Review"),
              [boards.offPageSeo.columns.notes]: monday.columnValue.text(notes),
              [boards.offPageSeo.columns.dateSuggested]: monday.columnValue.date(isoDate()),
              [boards.offPageSeo.columns.syncKey]: monday.columnValue.text(syncKey),
            }
          );
          backlinksSuggested += 1;
        }
      }
    }

    // --- Internal link opportunity: longer/question-style prompts, whether
    // Havwoods is already cited somewhere (reinforce that page) or not yet
    // cited anywhere (flag the gap for the team to pick a target page once
    // content exists; see HW GEO Content Suggestions for the content side).
    if (isQuestionOrLongPrompt(prompt.prompt)) {
      const category = guessPriorityCategory(prompt.prompt);
      const syncKey = `${prompt.id}:internal-link`;
      const notes = alreadyCited
        ? `Prompt: "${prompt.prompt}". Havwoods is already cited here (${ENGINE_LABELS[alreadyCited.run.engine] ?? alreadyCited.run.engine}) via ${alreadyCited.citation?.link ?? "a brand mention"}. Add internal links from related ${category} pages to reinforce topical relevance for this prompt.`
        : `Prompt: "${prompt.prompt}". No Havwoods page is currently cited for this prompt. Check HW GEO Content Suggestions for a content recommendation; once a page exists, link to it from related ${category} pages.`;

      const existingId = existingInternalLinkByKey.get(syncKey);
      const columnValues = {
        [boards.internalLinking.columns.notes]: monday.columnValue.text(notes),
        [boards.internalLinking.columns.dateSuggested]: monday.columnValue.date(isoDate()),
        ...(alreadyCited?.citation?.link
          ? { [boards.internalLinking.columns.targetPage]: monday.columnValue.link(alreadyCited.citation.link) }
          : {}),
      };

      if (existingId) {
        await monday.changeColumnValues(boards.internalLinking.id, existingId, columnValues);
        internalLinksUpdated += 1;
      } else {
        await monday.createItem(boards.internalLinking.id, boards.internalLinking.botGroupId, prompt.prompt.slice(0, 250), {
          ...columnValues,
          [boards.internalLinking.columns.linkType]: monday.columnValue.status("GEO"),
          [boards.internalLinking.columns.reviewStatus]: monday.columnValue.status("Needs Review"),
          [boards.internalLinking.columns.syncKey]: monday.columnValue.text(syncKey),
        });
        internalLinksSuggested += 1;
      }
    }
  }

  console.log(`GEO link-opportunity pull complete [${regionConfig.label}].`);
  console.log(`  Backlink suggestions: ${backlinksSuggested} new, ${backlinksUpdated} refreshed.`);
  console.log(`  Internal link suggestions: ${internalLinksSuggested} new, ${internalLinksUpdated} refreshed.`);
  if (failures.length > 0) {
    console.log(`  ${failures.length} prompt(s) could not be checked:`);
    for (const f of failures) console.log(`    ${f.prompt}: ${f.error}`);
  }
}

main().catch((err) => {
  console.error("GEO link-opportunity pull failed:", err);
  process.exitCode = 1;
});
