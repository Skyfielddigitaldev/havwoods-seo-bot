// Central config: monday.com board/column IDs and other constants for the
// Havwoods US workflow. If a board gets restructured in monday.com, update
// the IDs here rather than hunting through the scripts.

export const WORKSPACE_ID = 9345982;

// The person every auto-created item gets assigned to, so notifications
// route to one place. monday.com numeric user id.
export const DEFAULT_ASSIGNEE_ID = 50429760; // Zevi Walsh

export const SEMRUSH_DOMAIN = "havwoods.com";
export const SEMRUSH_DATABASE = "us";

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
};

// Priority commercial categories for internal linking / position tracking,
// matched against page URL slugs.
export const priorityCategories = [
  "wall-paneling",
  "herringbone",
  "chevron",
  "parquet",
  "wide-plank",
  "engineered",
];

export function monthGroupName(date = new Date()) {
  return `${date.toLocaleString("en-US", { month: "long" })} ${date.getFullYear()}`;
}

export function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
