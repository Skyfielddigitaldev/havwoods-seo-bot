// Direct Lighthouse runner, replacing the Google PageSpeed Insights API.
//
// PSI is just a hosted wrapper around Lighthouse plus CrUX field data. Most
// Havwoods pages never had enough real-user traffic to get their own CrUX
// numbers anyway (see the old README section on origin fallback), so the
// field-data upside was thin, and PSI's shared quota kept rate-limiting
// this job. Running Lighthouse directly against a local headless Chrome
// removes the quota and the API key entirely. The tradeoff: every number
// here is now a synthetic lab run, never real-user field data, and INP
// specifically cannot be measured in a lab run at all (it needs a real
// interaction), so it is left null rather than approximated.

import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

const CWV_THRESHOLDS = {
  lcp: { good: 2.5, poor: 4.0 }, // seconds
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

// Returns true if any of the given Lighthouse audit ids show meaningful
// potential savings (score below 0.9), treated as "needs work."
function auditFlags(audits, auditIds) {
  return auditIds.some((id) => {
    const audit = audits[id];
    if (!audit) return false;
    return typeof audit.score === "number" && audit.score < 0.9;
  });
}

function parseLighthouseResult(lhr) {
  const audits = lhr.audits ?? {};

  const lcpSeconds = audits["largest-contentful-paint"]?.numericValue
    ? Number((audits["largest-contentful-paint"].numericValue / 1000).toFixed(2))
    : null;
  const clsValue = audits["cumulative-layout-shift"]?.numericValue !== undefined
    ? Number(audits["cumulative-layout-shift"].numericValue.toFixed(3))
    : null;
  const tbtMs = audits["total-blocking-time"]?.numericValue !== undefined
    ? Math.round(audits["total-blocking-time"].numericValue)
    : null;

  const status = worstOf([rateStatus("lcp", lcpSeconds), rateStatus("cls", clsValue)]);

  return {
    lcpSeconds,
    inpMs: null, // not measurable from a lab run, see module comment above
    clsValue,
    tbtMs,
    labLcpSeconds: lcpSeconds,
    labClsValue: clsValue,
    dataSource: "Lighthouse Lab Run",
    status,
    opportunities: {
      imageOptimization: auditFlags(audits, ["modern-image-formats", "uses-optimized-images", "uses-responsive-images"]),
      lazyLoading: auditFlags(audits, ["offscreen-images"]),
      renderBlocking: auditFlags(audits, ["render-blocking-resources", "unused-javascript", "unminified-javascript"]),
    },
  };
}

// Runs a single Lighthouse performance pass against pageUrl on a fresh
// headless Chrome instance. Mirrors the old getPageSpeed() shape so the
// callers barely change. Never throws; returns { error } on failure so a
// batch job can skip and continue.
export async function getPageSpeed(pageUrl, { maxRetries = 2 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let chrome;
    try {
      chrome = await chromeLauncher.launch({
        chromePath: process.env.CHROME_PATH || undefined,
        chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
      });

      const result = await lighthouse(pageUrl, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance"],
      });

      if (!result?.lhr) {
        throw new Error("Lighthouse returned no result");
      }
      if (result.lhr.runtimeError) {
        throw new Error(`Lighthouse runtime error: ${result.lhr.runtimeError.message}`);
      }

      return parseLighthouseResult(result.lhr);
    } catch (err) {
      lastError = err;
    } finally {
      if (chrome) {
        try {
          await chrome.kill();
        } catch {
          // best-effort cleanup, nothing more to do if it fails
        }
      }
    }
  }

  return { error: lastError?.message ?? "Unknown Lighthouse failure" };
}
