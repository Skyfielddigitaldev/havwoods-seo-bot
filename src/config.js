// Central config: monday.com board/column IDs and other constants for the
// Havwoods US workflow. If a board gets restructured in monday.com, update
// the IDs here rather than hunting through the scripts.

export const WORKSPACE_ID = 9345982;

// The person every auto-created item gets assigned to, so notifications
// route to one place. monday.com numeric user id.
export const DEFAULT_ASSIGNEE_ID = 50429760; // Zevi Walsh

export const SEMRUSH_DOMAIN = "havwoods.com";
export const SEMRUSH_DATABASE = "us";

// Bare domain (no protocol, no www) used to match citation links back to
// Havwoods in the Otterly AI tracking job.
export const BRAND_DOMAIN = "havwoods.com";
export const OTTERLY_REPORT_ID = "01M3CPWJ4THFDA5GXH9ZDEFAQ8";
export const OTTERLY_COUNTRY = "us";

export const boards = {
  technicalSeo: {
    id: 9420699962,
    subitemsBoardId: 9420700071,
    columns: {
      issueType: "color_mm7m1zpw",
      crawlDate: "date_mm7mpg7",
      usVersion: "color_mm7mk70h",
      linkToSemrush: "link_mkrwr0zt",
      issuesFixed: "status_Mjj4dlIM",
      assignee: "multiple_person_mm7mx792",
    },
    subitemColumns: {
      pageLink: "link_mkrwwn7r",
      errorPages: "long_text_mkrwfkwe",
      issueFixed: "status_Mjj4GNPv",
    },
  },
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
  kpiDashboard: {
    id: 18433047972,
    snapshotsGroupId: "group_mm7mgmd3",
    columns: {
      technicalErrorCount: "numeric_mm7mzfc9",
      p2p1Moves: "numeric_mm7mtzs7",
      cwvPassRate: "numeric_mm7mrh7x",
      reportDate: "date_mm7mt4kv",
      notes: "long_text_mm7mxmvr",
    },
  },
  mobilePerformance: {
    id: 18433047732,
    top20GroupId: "group_mm7mvdn",
    columns: {
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
    },
  },
  priorityPages: {
    id: 18433242728,
    groupId: "group_mm7ne1ex",
    columns: {
      pageUrl: "link_mm7ngzc4",
      priorityCategory: "color_mm7ncg7w",
      targetKeyword: "text_mm7nrxc3",
      currentPosition: "numeric_mm7n7m5q",
      previousPosition: "numeric_mm7nmgyp",
      page1Status: "color_mm7ntk07",
      positionTrend: "color_mm7ndpxx",
      assignee: "multiple_person_mm7nx8tf",
      lastChecked: "date_mm7n593e",
    },
  },
  geoAiTracking: {
    id: 18433047834,
    groupId: "group_mm7mnesc", // "Starter Prompt Set (Oct 2026)"
    columns: {
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
    },
  },
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

export function monthGroupName(date = new Date()) {
  return `${date.toLocaleString("en-US", { month: "long" })} ${date.getFullYear()}`;
}

export function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
