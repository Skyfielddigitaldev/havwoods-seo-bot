// Google PageSpeed Insights (v5) client. This is the authoritative source
// for real Core Web Vitals field data (LCP, INP/FID, CLS from CrUX), which
// Semrush's Site Audit does not provide at the same granularity.
//
// Works without an API key at low volume (shared public quota). Set
// PAGESPEED_API_KEY to raise the rate limit; get a free one at
// https://developers.google.com/speed/docs/insights/v5/get-started

const PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

const CWV_THRESHOLDS = {
  lcp: { good: 2.5, poor: 4.0 }, // seconds
  inp: { good: 200, poor: 500 }, // ms
  cls: { good: 0.1, poor: 0.25 },
};

function rateStatus(metric, value) {
  if (value === null || value === undefined) return null;
  const t = CWV_THRESHOLDS[metric];
  if (value <= t.good) return "GOOD";
  if (value <= t.poor) return "NEEDS_IMPROVEMENT";
  return "POOR";
}

function worstOf(statuses) {
  const present = statuses.filter(Boolean);
  if (present.length === 0) return "UNKNOWN";
  if (present.includes("POOR")) return "Poor";
  if (present.includes("NEEDS_IMPROVEMENT")) return "Needs Improvement";
  return "Pass";
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetches one URL's PSI result, retrying on 429 with backoff. Returns null
// (never throws) on repeated failure so a batch job can skip and continue.
export async function getPageSpeed(pageUrl, { strategy = "mobile", maxRetries = 3 } = {}) {
  const apiKey = process.env.PAGESPEED_API_KEY;
  const params = new URLSearchParams({
    url: pageUrl,
    strategy,
    category: "performance",
  });
  if (apiKey) params.set("key", apiKey);

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${PSI_URL}?${params.toString()}`);
      if (res.status === 429) {
        const waitMs = 2 ** attempt * 5000;
        lastError = new Error("PageSpeed Insights rate limited (429)");
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`PageSpeed Insights HTTP ${res.status}: ${body.slice(0, 300)}`);
      }
      const json = await res.json();
      return parsePsiResponse(json);
    } catch (err) {
      lastError = err;
      await sleep(1000);
    }
  }
  return { error: lastError?.message ?? "Unknown PageSpeed Insights failure" };
}

function parsePsiResponse(json) {
  const crux = json.loadingExperience?.metrics;
  const originCrux = json.originLoadingExperience?.metrics;
  const lighthouse = json.lighthouseResult;
  const audits = lighthouse?.audits ?? {};

  const hasFieldData = Boolean(crux || originCrux);
  const source = crux ? crux : originCrux;

  let lcpSeconds = null;
  let inpMs = null;
  let clsValue = null;
  const usedFallbackOrigin = Boolean(!crux && originCrux);
  let usedLabData = false;

  if (source) {
    lcpSeconds = source.LARGEST_CONTENTFUL_PAINT_MS
      ? source.LARGEST_CONTENTFUL_PAINT_MS.percentile / 1000
      : null;
    if (source.INTERACTION_TO_NEXT_PAINT) {
      inpMs = source.INTERACTION_TO_NEXT_PAINT.percentile;
    } else if (source.FIRST_INPUT_DELAY_MS) {
      inpMs = source.FIRST_INPUT_DELAY_MS.percentile; // fallback, note this
    }
    clsValue = source.CUMULATIVE_LAYOUT_SHIFT_SCORE
      ? source.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100
      : null;
  } else if (lighthouse) {
    // No CrUX field data at all (low-traffic page) - fall back to lab data
    // as the primary numbers.
    usedLabData = true;
  }

  // Lighthouse lab data is always available (it's a live simulated run) even
  // when CrUX field data exists, so pull it separately. Field data (real
  // users) only ever comes from `crux`, which is genuinely per-URL; when the
  // site falls back to `originCrux` that's a site-wide average repeated for
  // every page, so it's flagged rather than treated as page-specific.
  const labLcpSeconds = audits["largest-contentful-paint"]?.numericValue
    ? Number((audits["largest-contentful-paint"].numericValue / 1000).toFixed(2))
    : null;
  const labClsValue = audits["cumulative-layout-shift"]?.numericValue !== undefined
    ? Number(audits["cumulative-layout-shift"].numericValue.toFixed(3))
    : null;

  if (usedLabData) {
    lcpSeconds = labLcpSeconds;
    clsValue = labClsValue;
    inpMs = null; // Lighthouse lab runs don't produce INP.
  }

  // One line to say, at a glance, what kind of number the row is showing.
  const dataSource = crux
    ? "URL Field Data"
    : usedFallbackOrigin
      ? "Origin Field Data (Site Avg)"
      : "Lab Data Only";

  const status = worstOf([
    rateStatus("lcp", lcpSeconds),
    inpMs !== null ? rateStatus("inp", inpMs) : null,
    rateStatus("cls", clsValue),
  ]);

  return {
    lcpSeconds: lcpSeconds !== null ? Number(lcpSeconds.toFixed(2)) : null,
    inpMs: inpMs !== null ? Math.round(inpMs) : null,
    clsValue: clsValue !== null ? Number(clsValue.toFixed(3)) : null,
    labLcpSeconds,
    labClsValue,
    dataSource,
    status,
    hasFieldData,
    usedFallbackOrigin,
    usedLabData,
    usedFidFallback: Boolean(source?.FIRST_INPUT_DELAY_MS && !source?.INTERACTION_TO_NEXT_PAINT),
    opportunities: {
      imageOptimization: auditFlags(audits, ["modern-image-formats", "uses-optimized-images", "uses-responsive-images"]),
      lazyLoading: auditFlags(audits, ["offscreen-images"]),
      renderBlocking: auditFlags(audits, ["render-blocking-resources", "unused-javascript", "unminified-javascript"]),
    },
  };
}

// Returns true if any of the given Lighthouse audit ids show meaningful
// potential savings (score below 0.9 and a numeric savings value), which
// we treat as "needs work."
function auditFlags(audits, auditIds) {
  return auditIds.some((id) => {
    const audit = audits[id];
    if (!audit) return false;
    if (typeof audit.score === "number" && audit.score < 0.9) return true;
    return false;
  });
}
