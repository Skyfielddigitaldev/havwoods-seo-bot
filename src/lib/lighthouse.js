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
//
// Also runs the accessibility category in the same pass (no extra cost,
// Lighthouse computes it from the same trace), surfacing a 0-100 score plus
// a short list of the specific failing checks (missing alt text, low
// contrast, etc.) so ADA fixes show up on the same board row as performance.

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

// Accessibility audits worth surfacing by name when they fail. Lighthouse's
// accessibility category has ~50 audits; most Havwoods pages will only ever
// trip a handful of these, so this is a readable top-level summary rather
// than a dump of every audit id.
const ADA_AUDIT_LABELS = {
  "image-alt": "Images missing alt text",
  "color-contrast": "Insufficient color contrast",
  "link-name": "Links with no discernible text",
  "button-name": "Buttons with no accessible name",
  "aria-allowed-attr": "Invalid ARIA attributes",
  "aria-required-attr": "Missing required ARIA attributes",
  "aria-valid-attr-value": "Invalid ARIA attribute values",
  label: "Form elements missing labels",
  "document-title": "Missing or empty page title",
  "html-has-lang": "Missing html lang attribute",
  "meta-viewport": "Viewport disables zoom (not mobile-accessible)",
  "target-size": "Tap targets too small or too close together",
  "heading-order": "Headings not in a logical order",
  "duplicate-id-aria": "Duplicate ARIA ids",
  "frame-title": "Iframes missing a title",
};

function accessibilityFindings(audits) {
  const failing = Object.entries(ADA_AUDIT_LABELS)
    .filter(([id]) => audits[id] && typeof audits[id].score === "number" && audits[id].score < 1)
    .map(([, label]) => label);
  return failing;
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

// Accessibility issues that need a template/code change (not just content
// edits like adding alt text) and so should route to the dev team rather
// than be marked "Needs Work" for a content editor to pick up.
const ADA_DEV_NEEDED_AUDITS = new Set([
  "aria-allowed-attr",
  "aria-required-attr",
  "aria-valid-attr-value",
  "html-has-lang",
  "meta-viewport",
  "duplicate-id-aria",
  "frame-title",
]);

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

  const accessibilityScore = lhr.categories?.accessibility?.score !== undefined
    ? Math.round(lhr.categories.accessibility.score * 100)
    : null;
  const accessibilityFailures = accessibilityFindings(audits);
  const adaNeedsDev = Object.keys(ADA_DEV_NEEDED_AUDITS).length > 0 &&
    [...ADA_DEV_NEEDED_AUDITS].some(
      (id) => audits[id] && typeof audits[id].score === "number" && audits[id].score < 1
    );
  const adaStatus = accessibilityFailures.length === 0 ? "Done" : adaNeedsDev ? "Dev Needed" : "Needs Work";

  return {
    lcpSeconds,
    inpMs: null, // not measurable from a lab run, see module comment above
    clsValue,
    tbtMs,
    labLcpSeconds: lcpSeconds,
    labClsValue: clsValue,
    dataSource: "Lighthouse Lab Run",
    status,
    accessibilityScore,
    accessibilityFindings: accessibilityFailures,
    adaStatus,
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
        onlyCategories: ["performance", "accessibility"],
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
