// Central config: monday.com board/column IDs and other constants for the
// Havwoods US workflow. If a board gets restructured in monday.com, update
// the IDs here rather than hunting through the scripts.

export const WORKSPACE_ID = 9345982;

// The person every auto-created item gets assigned to, so notifications
// route to one place. monday.com numeric user id.
export const DEFAULT_ASSIGNEE_ID = 50429760; // Zevi Walsh

export const SEMRUSH_DOMAIN = "havwoods.com";
export const SEMRUSH_DATABASE = "us";

// Havwoods serves both the US and UK markets from the same domain, split by
// URL path (/us/..., /uk/...). Every Semrush-sourced job (technical SEO,
// Core Web Vitals, priority page tracking) runs once per region so a US
// page never lands on a UK board or vice versa. Semrush's own "database"
// parameter picks which country's search index to read positions from;
// pathPrefix is the client-side filter that keeps a run from picking up
// pages (or Site Audit issues) outside its own region.
export const regions = {
  us: { label: "US", database: "us", pathPrefix: "/us/" },
  uk: { label: "UK", database: "uk", pathPrefix: "/uk/" },
};

export function resolveRegion(envValue = process.env.REGION) {
  const key = (envValue || "us").toLowerCase();
  if (!regions[key]) {
    throw new Error(`Unknown REGION "${envValue}". Expected one of: ${Object.keys(regions).join(", ")}`);
  }
  return key;
}

// Bare domain (no protocol, no www) used to match citation links back to
// Havwoods in the Otterly AI tracking job.
export const BRAND_DOMAIN = "havwoods.com";
export const OTTERLY_REPORT_ID = "01M3CPWJ4THFDA5GXH9ZDEFAQ8";
export const OTTERLY_COUNTRY = "us";

// The UK Otterly brand report doesn't exist yet. Once it's set up, put its
// report id in the OTTERLY_REPORT_ID_UK repo secret — no code change
// needed. Until then this stays null and the GEO jobs skip the UK run with
// a clear log line instead of failing.
export const OTTERLY_REPORT_ID_UK = process.env.OTTERLY_REPORT_ID_UK || null;

// Resolves the Otterly report id + country for a region's GEO pull. Returns
// null when that region's report isn't configured yet, so callers can skip
// cleanly rather than crash.
export function otterlyConfigFor(region) {
  if (region === "uk") {
    return OTTERLY_REPORT_ID_UK ? { reportId: OTTERLY_REPORT_ID_UK, country: "uk" } : null;
  }
  return { reportId: OTTERLY_REPORT_ID, country: OTTERLY_COUNTRY };
}

// Column ids for the four Semrush-sourced boards. monday.com's
// duplicate_board_with_structure mutation (used to create the UK boards
// from the original US ones) keeps the same column ids on the copy, so one
// column map covers both regions; only the board id, group ids, and
// subitems board id differ per region below.
const technicalSeoColumns = {
  issueType: "color_mm7m1zpw",
  crawlDate: "date_mm7mpg7",
  usVersion: "color_mm7mk70h",
  linkToSemrush: "link_mkrwr0zt",
  issuesFixed: "status_Mjj4dlIM",
  assignee: "multiple_person_mm7mx792",
  issueId: "text_mm7r6xxk",
  routedToDev: "boolean_mm7r8jjw",
};

const technicalSeoSubitemColumns = {
  pageLink: "link_mkrwwn7r",
  errorPages: "long_text_mkrwfkwe",
  issueFixed: "status_Mjj4GNPv",
};

const mobilePerformanceColumns = {
  pageUrl: "link_mm7m2xtm",
  assignee: "multiple_person_mm7mty8n",
  lcp: "numeric_mm7mqd9s",
  inp: "numeric_mm7mx4dy",
  cls: "numeric_mm7mjymx",
  cwvStatus: "color_mm7mjz63",
  imageCompression: "color_mm7m5h7b",
  lazyLoading: "color_mm7mj8r9",
  renderBlockingFix: "color_mm7mqca",
  template: "text_mm7mrq5q",
  reviewDate: "date_mm7mhbs4",
  dataSource: "color_mm7n42g0",
  labLcp: "numeric_mm7nw4b7",
  labCls: "numeric_mm7njm6c",
  accessibilityScore: "numeric_mm7rj5qt",
  accessibilityIssues: "long_text_mm7rjdbs",
  adaFixNeeded: "color_mm7r24hd",
  reviewStatus: "color_mm7rwyzp",
  routedToDev: "boolean_mm7rfaa6",
};

const priorityPagesColumns = {
  pageUrl: "link_mm7ngzc4",
  priorityCategory: "color_mm7ncg7w",
  targetKeyword: "text_mm7nrxc3",
  currentPosition: "numeric_mm7n7m5q",
  previousPosition: "numeric_mm7nmgyp",
  page1Status: "color_mm7ntk07",
  positionTrend: "color_mm7ndpxx",
  assignee: "multiple_person_mm7nx8tf",
  lastChecked: "date_mm7n593e",
};

const kpiDashboardColumns = {
  technicalErrorCount: "numeric_mm7mzfc9",
  p2p1Moves: "numeric_mm7mtzs7",
  cwvPassRate: "numeric_mm7mrh7x",
  reportDate: "date_mm7mt4kv",
  notes: "long_text_mm7mxmvr",
};

// Column ids for the four Otterly-sourced GEO boards. Same deal as the
// Semrush boards above: the UK boards are structural duplicates of the US
// ones, so one column map covers both.
const geoAiTrackingColumns = {
  category: "color_mm7mj9x9",
  aiPlatform: "color_mm7mj9dj",
  havwoodsCited: "color_mm7mh7bk",
  citedUrl: "link_mm7msjyg",
  lastChecked: "date_mm7mjrmy",
  notes: "long_text_mm7mvmpg",
  citedPageType: "color_mm7m9pr0",
  // Stable promptId:engine key, hidden from normal view, used to match
  // existing rows on re-runs instead of the human-readable item name
  // (which could drift if Otterly ever reworks a prompt's wording).
  syncKey: "text_mm7r8w42",
};

const offPageSeoColumns = {
  assignee: "multiple_person_mm2ex4kz",
  websiteUrl: "website_url__1",
  articleLink: "article_link__1",
  linkType: "color_mm7r7n2d",
  reviewStatus: "status__1", // "Backlink Progress" — reused for Needs Review / Approved too
  notes: "long_text_mm7r118n",
  dateSuggested: "date_mm7rfv8g",
  syncKey: "text_mm7rzmga",
};

const internalLinkingColumns = {
  assignee: "multiple_person_mm2e32pr",
  linkType: "color_mm7r9nxp",
  reviewStatus: "status_Mjj4dlIM", // "Internal Links" — reused for Needs Review / Approved too
  targetPage: "link_mm7rqgzj",
  notes: "long_text_mm7rcyv4",
  dateSuggested: "date_mm7rz7pb",
  syncKey: "text_mm7rr8bx",
};

const geoContentSuggestionsColumns = {
  aiPlatform: "color_mm7rd4gw",
  gapType: "color_mm7rc82q",
  targetUrl: "link_mm7r5wbk",
  newPageNeeded: "boolean_mm7rd6kj",
  suggestedContent: "long_text_mm7rze6w",
  reviewStatus: "color_mm7rtczr",
  assignee: "multiple_person_mm7ryy4v",
  dateSuggested: "date_mm7r7dx",
  syncKey: "text_mm7rx546",
};

// Per-region board ids and group ids for the four Semrush-sourced boards.
// The UK boards were created by duplicating the US ones with
// duplicate_board_with_structure, so their group ids happen to match too
// (group ids are scoped per board, so reusing the same literal id across
// two different boards is fine).
export const boardsByRegion = {
  us: {
    technicalSeo: {
      id: 9420699962,
      subitemsBoardId: 9420700071,
      columns: technicalSeoColumns,
      subitemColumns: technicalSeoSubitemColumns,
    },
    mobilePerformance: {
      id: 18433047732,
      top20GroupId: "group_mm7mvdn",
      newPagesGroupId: "topics",
      columns: mobilePerformanceColumns,
    },
    priorityPages: {
      id: 18433242728,
      groupId: "group_mm7ne1ex",
      columns: priorityPagesColumns,
    },
    kpiDashboard: {
      id: 18433047972,
      snapshotsGroupId: "group_mm7mgmd3",
      columns: kpiDashboardColumns,
    },
    geoAiTracking: {
      id: 18433047834,
      groupId: "group_mm7mnesc", // "Starter Prompt Set (Oct 2026)"
      columns: geoAiTrackingColumns,
    },
    // Manually-run backlink board. The bot only writes to the "GEO
    // Suggestions (Bot)" group with Review Status "Needs Review"; the
    // SEO-sourced rows and the month groups stay entirely human-managed.
    offPageSeo: {
      id: 8168231374,
      botGroupId: "group_mm7rspyq", // "GEO Suggestions (Bot)"
      columns: offPageSeoColumns,
    },
    // Manually-run internal linking board. Same bot-group convention as
    // offPageSeo above.
    internalLinking: {
      id: 8168232621,
      botGroupId: "group_mm7r87js", // "GEO Suggestions (Bot)"
      columns: internalLinkingColumns,
    },
    geoContentSuggestions: {
      id: 18433744120,
      groupId: "topics", // "Weekly Suggestions"
      columns: geoContentSuggestionsColumns,
    },
  },
  uk: {
    technicalSeo: {
      id: 18433772490,
      subitemsBoardId: 18433772500,
      columns: technicalSeoColumns,
      subitemColumns: technicalSeoSubitemColumns,
    },
    mobilePerformance: {
      id: 18433772516,
      top20GroupId: "group_mm7mvdn",
      newPagesGroupId: "topics",
      columns: mobilePerformanceColumns,
    },
    priorityPages: {
      id: 18433772521,
      groupId: "group_mm7ne1ex",
      columns: priorityPagesColumns,
    },
    kpiDashboard: {
      id: 18433772542,
      snapshotsGroupId: "group_mm7mgmd3",
      columns: kpiDashboardColumns,
    },
    geoAiTracking: {
      id: 18433776446,
      groupId: "group_mm7mnesc", // "Starter Prompt Set (Oct 2026)"
      columns: geoAiTrackingColumns,
    },
    offPageSeo: {
      id: 18433776471,
      botGroupId: "group_mm7rspyq", // "GEO Suggestions (Bot)"
      columns: offPageSeoColumns,
    },
    internalLinking: {
      id: 18433776486,
      botGroupId: "group_mm7r87js", // "GEO Suggestions (Bot)"
      columns: internalLinkingColumns,
    },
    geoContentSuggestions: {
      id: 18433776458,
      groupId: "topics", // "Weekly Suggestions"
      columns: geoContentSuggestionsColumns,
    },
  },
};

export const boards = {
  // Kept as plain aliases to the US boards so code that isn't region-aware
  // (e.g. the Otterly-driven GEO jobs, which only ever run for the US
  // report) can keep referencing boards.priorityPages etc. directly.
  technicalSeo: boardsByRegion.us.technicalSeo,
  mobilePerformance: boardsByRegion.us.mobilePerformance,
  priorityPages: boardsByRegion.us.priorityPages,
  kpiDashboard: boardsByRegion.us.kpiDashboard,
  tasks: {
    id: 8168296808,
    recurringGroupId: "group_mm2fhfwy",
    columns: {
      assignee: "person",
      status: "status",
      dueDate: "date4",
      priority: "color_mm7mtesb",
      source: "color_mm7mvkzz",
      relatedItem: "link_mm7m4bvh",
    },
  },
  geoAiTracking: boardsByRegion.us.geoAiTracking,
  offPageSeo: boardsByRegion.us.offPageSeo,
  internalLinking: boardsByRegion.us.internalLinking,
  geoContentSuggestions: boardsByRegion.us.geoContentSuggestions,
};

// Keyword matches used to guess a prompt's product category for the
// HW GEO / AI Search Tracking board. Checked in order; first match wins.
// Falls back to "General / Brand" when nothing matches.
export const promptCategoryKeywords = [
  { pattern: /herringbone/i, label: "Herringbone" },
  { pattern: /chevron/i, label: "Chevron" },
  { pattern: /parquet/i, label: "Parquet" },
  { pattern: /wall paneling|wall panelling/i, label: "Wall Paneling" },
  { pattern: /wide plank/i, label: "Wide Plank" },
  { pattern: /engineered/i, label: "Engineered" },
  { pattern: /bathroom/i, label: "Bathroom Flooring" },
];

// Priority commercial categories for internal linking / position tracking,
// matched against page URL slugs. `label` is the status option on the
// HW Priority Pages Performance board's Priority Category column.
export const priorityCategories = [
  { slug: "wall-paneling", label: "Wall Paneling" },
  { slug: "herringbone", label: "Herringbone" },
  { slug: "chevron", label: "Chevron" },
  { slug: "parquet", label: "Parquet" },
  { slug: "wide-plank", label: "Wide Plank" },
  { slug: "engineered", label: "Engineered" },
];

// HW Technical SEO "Issue Type" labels that need a developer/CMS-template
// fix rather than a content-editor fix. Used by approval-routing.js to
// decide which "Approved" issues get pushed to HW Tasks. Adjust this list
// as you learn the CMS's real limitations.
export const devNeededIssueLabels = new Set([
  "Redirect Chain",
  "Structured Data Error",
  "Hreflang Issue",
  "Canonical Issue",
]);

export function monthGroupName(date = new Date()) {
  return `${date.toLocaleString("en-US", { month: "long" })} ${date.getFullYear()}`;
}

export function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
