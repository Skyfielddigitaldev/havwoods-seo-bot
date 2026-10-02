// Otterly AI client. Pulls brand-report prompt results (per AI engine, per
// run) so the GEO/AI tracking job can tell whether Havwoods got cited for a
// given prompt, on a given engine, and what URL won the citation instead.
//
// Base URL is data.otterly.ai, not api.otterly.ai. The docs site
// (docs.otterly.ai) does not state this anywhere obvious; it only shows up
// in the OpenAPI spec link and the example auth header.

const OTTERLY_API_URL = "https://data.otterly.ai/v1";

// Engines Otterly supports today, mapped to the status labels already set
// up on the HW GEO / AI Search Tracking board. Engines with no mapping
// (currently "claude") are skipped rather than guessed at.
export const ENGINE_LABELS = {
  chatgpt: "ChatGPT",
  google: "Google AI Overview",
  google_ai_mode: "Google AI Overview",
  perplexity: "Perplexity",
  gemini: "Gemini",
  copilot: "Copilot",
};

function requireKey() {
  const key = process.env.OTTERLY_API_KEY;
  if (!key) {
    throw new Error(
      "OTTERLY_API_KEY is not set. Add it as a GitHub Actions secret or in " +
        "a local .env file (see .env.example)."
    );
  }
  return key;
}

async function otterlyRequest(path, params = {}) {
  const key = requireKey();
  const url = new URL(`${OTTERLY_API_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Otterly API HTTP ${res.status} on ${path}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

// All prompts configured on a brand report, paginated.
export async function listPrompts(reportId, { startDate, endDate, country = "us" } = {}) {
  const prompts = [];
  let offset = 0;
  const limit = 50;

  for (;;) {
    const data = await otterlyRequest(`/reports/brand/${reportId}/prompts`, {
      startDate,
      endDate,
      country,
      limit,
      offset,
    });
    prompts.push(...data.items);
    if (!data.paging?.hasMore) break;
    offset += limit;
  }

  return prompts;
}

// Every AI response recorded for one prompt in the date window, across all
// engines Otterly ran it against.
export async function listAiResponses(reportId, promptId, { startDate, endDate, country = "us" } = {}) {
  const responses = [];
  let cursor;

  for (;;) {
    const data = await otterlyRequest(`/reports/brand/${reportId}/prompts/${promptId}/ai-responses`, {
      startDate,
      endDate,
      country,
      cursor,
    });
    responses.push(...data.items);
    if (!data.paging?.hasMore || !data.paging?.nextCursor) break;
    cursor = data.paging.nextCursor;
  }

  return responses;
}

// Reduces a prompt's AI responses to the single most recent run per engine,
// since the same engine can appear more than once across a wide date
// window and only the latest result matters for "is Havwoods cited today."
export function latestRunPerEngine(responses) {
  const latest = new Map();
  for (const r of responses) {
    const existing = latest.get(r.engine);
    if (!existing || new Date(r.runDate) > new Date(existing.runDate)) {
      latest.set(r.engine, r);
    }
  }
  return [...latest.values()];
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Classifies one AI response against the brand's own domain: cited (our
// domain shows up in the citations or we're flagged as the main brand with
// mentions), competitor cited instead (someone else's link shows up but we
// don't), or not cited at all (no citations either way).
export function classifyResponse(response, brandDomain) {
  const citations = response.citations ?? [];
  const ownCitation = citations.find((c) => hostnameOf(c.link).includes(brandDomain));
  const ownBrandMention = (response.brandMentions ?? []).find((b) => b.isMainBrand && b.mentions > 0);

  if (ownCitation || ownBrandMention) {
    return { status: "Cited", citation: ownCitation ?? null };
  }
  if (citations.length > 0) {
    return { status: "Competitor Cited Instead", citation: citations[0] };
  }
  return { status: "Not Cited", citation: null };
}
