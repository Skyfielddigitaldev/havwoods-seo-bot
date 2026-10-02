// Lightweight sitemap.xml crawler, used by the monthly Core Web Vitals job
// to catch brand-new pages that have no organic traffic yet (and so never
// show up in Semrush's top-pages-by-traffic report). No XML parsing
// dependency needed: sitemap <loc> entries are simple enough to pull out
// with a regex, and a sitemap index just points at more sitemaps.

const MAX_SITEMAP_DEPTH = 2; // sitemap index -> per-section sitemaps, no deeper
const FETCH_TIMEOUT_MS = 15000;

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Sitemap fetch HTTP ${res.status} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function extractLocs(xml) {
  const matches = xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi);
  return [...matches].map((m) => m[1].trim());
}

function isSitemapIndex(xml) {
  return /<sitemapindex[\s>]/i.test(xml);
}

async function crawlSitemap(url, depth, seenSitemaps) {
  if (depth > MAX_SITEMAP_DEPTH || seenSitemaps.has(url)) return [];
  seenSitemaps.add(url);

  let xml;
  try {
    xml = await fetchText(url);
  } catch (err) {
    console.warn(`  Sitemap fetch failed for ${url}: ${err.message}`);
    return [];
  }

  const locs = extractLocs(xml);
  if (isSitemapIndex(xml)) {
    const pages = [];
    for (const sitemapUrl of locs) {
      pages.push(...(await crawlSitemap(sitemapUrl, depth + 1, seenSitemaps)));
    }
    return pages;
  }
  return locs;
}

// Returns every URL in havwoods.com's sitemap(s) that lives under pathPrefix
// (defaults to the US section, "/us/"). Starts from the root sitemap and
// follows a sitemap index if present.
export async function getAllSitePages({
  rootSitemapUrl = "https://www.havwoods.com/sitemap.xml",
  pathPrefix = "/us/",
} = {}) {
  const seenSitemaps = new Set();
  const allUrls = await crawlSitemap(rootSitemapUrl, 0, seenSitemaps);
  const unique = [...new Set(allUrls)];

  if (!pathPrefix) return unique;

  return unique.filter((url) => {
    try {
      return new URL(url).pathname.startsWith(pathPrefix);
    } catch {
      return false;
    }
  });
}
