// Weekly approval-routing sweep. Run by
// .github/workflows/weekly-approval-routing.yml, after the other weekly
// jobs have had a chance to log new items and a human has had a chance to
// review them.
//
// This is the "then we do it or send it to devs" half of the approval
// workflow: a human moves an item's status to "Approved" on whichever
// board it lives on, and this job is what actually creates the HW Tasks
// item for anything that needs a developer. It never creates work for
// anything marked Needs Review — only Approved — and it never re-routes an
// item it has already routed (tracked with a "Routed to Dev" checkbox on
// each source board).
//
// This job only handles the dev-needed half. Items on HW Off-Page SEO, HW
// Internal Linking, and HW GEO Content Suggestions that get Approved are
// Skyfield/content-team work (outreach, adding a link, writing content) —
// there is no CMS or site-editing access wired up for this bot, so those
// stay Approved for a person to actually go do and then mark Done/
// Published themselves. Nothing to automate there yet.

import { boards, DEFAULT_ASSIGNEE_ID, devNeededIssueLabels, priorityCategories, isoDate } from "./config.js";
import * as monday from "./lib/monday.js";

function columnText(item, columnId) {
  return item.column_values.find((c) => c.id === columnId)?.text ?? null;
}

function columnChecked(item, columnId) {
  const col = item.column_values.find((c) => c.id === columnId);
  if (!col?.value) return false;
  try {
    return JSON.parse(col.value).checked === "true";
  } catch {
    return false;
  }
}

function affectsPriorityPage(url) {
  return url ? priorityCategories.some((c) => url.includes(c.slug)) : false;
}

// HW Technical SEO item names are "<Issue Type>: <url>"; pull the url back
// out for priority matching, since that board doesn't store the url as its
// own column on the main item (only on the subitem).
function urlFromItemName(name) {
  const idx = name.indexOf(": ");
  return idx === -1 ? null : name.slice(idx + 2);
}

async function routeTechnicalSeoIssues() {
  const items = await monday.getBoardItems(boards.technicalSeo.id, {
    columnIds: [boards.technicalSeo.columns.issuesFixed, boards.technicalSeo.columns.issueType, boards.technicalSeo.columns.routedToDev],
  });

  let routed = 0;
  for (const item of items) {
    const status = columnText(item, boards.technicalSeo.columns.issuesFixed);
    const issueType = columnText(item, boards.technicalSeo.columns.issueType);
    const alreadyRouted = columnChecked(item, boards.technicalSeo.columns.routedToDev);

    if (status !== "Approved" || alreadyRouted || !devNeededIssueLabels.has(issueType)) continue;

    const url = urlFromItemName(item.name);
    await monday.createItem(boards.tasks.id, boards.tasks.recurringGroupId, `Fix: ${item.name}`, {
      [boards.tasks.columns.assignee]: monday.columnValue.people([DEFAULT_ASSIGNEE_ID]),
      [boards.tasks.columns.priority]: monday.columnValue.status(affectsPriorityPage(url) ? "High" : "Medium"),
      [boards.tasks.columns.source]: monday.columnValue.status("Semrush Weekly Crawl"),
      [boards.tasks.columns.relatedItem]: monday.columnValue.link(
        `https://skyfield-digital.monday.com/boards/${boards.technicalSeo.id}/pulses/${item.id}`,
        issueType
      ),
    });
    await monday.changeColumnValues(boards.technicalSeo.id, item.id, {
      [boards.technicalSeo.columns.routedToDev]: monday.columnValue.checkbox(true),
    });
    routed += 1;
  }
  return routed;
}

async function routeMobilePerformanceIssues() {
  const items = await monday.getBoardItems(boards.mobilePerformance.id, {
    columnIds: [
      boards.mobilePerformance.columns.reviewStatus,
      boards.mobilePerformance.columns.renderBlockingFix,
      boards.mobilePerformance.columns.adaFixNeeded,
      boards.mobilePerformance.columns.routedToDev,
      boards.mobilePerformance.columns.pageUrl,
    ],
  });

  let routed = 0;
  for (const item of items) {
    const reviewStatus = columnText(item, boards.mobilePerformance.columns.reviewStatus);
    const renderBlocking = columnText(item, boards.mobilePerformance.columns.renderBlockingFix);
    const ada = columnText(item, boards.mobilePerformance.columns.adaFixNeeded);
    const alreadyRouted = columnChecked(item, boards.mobilePerformance.columns.routedToDev);
    const needsDev = renderBlocking === "Dev Needed" || ada === "Dev Needed";

    if (reviewStatus !== "Approved" || alreadyRouted || !needsDev) continue;

    const reasons = [renderBlocking === "Dev Needed" ? "render-blocking fix" : null, ada === "Dev Needed" ? "ADA fix" : null]
      .filter(Boolean)
      .join(" + ");

    await monday.createItem(boards.tasks.id, boards.tasks.recurringGroupId, `Fix: ${item.name} (${reasons})`, {
      [boards.tasks.columns.assignee]: monday.columnValue.people([DEFAULT_ASSIGNEE_ID]),
      [boards.tasks.columns.priority]: monday.columnValue.status("Medium"),
      [boards.tasks.columns.source]: monday.columnValue.status("Lighthouse Audit"),
      [boards.tasks.columns.relatedItem]: monday.columnValue.link(
        `https://skyfield-digital.monday.com/boards/${boards.mobilePerformance.id}/pulses/${item.id}`,
        item.name
      ),
    });
    await monday.changeColumnValues(boards.mobilePerformance.id, item.id, {
      [boards.mobilePerformance.columns.routedToDev]: monday.columnValue.checkbox(true),
    });
    routed += 1;
  }
  return routed;
}

async function main() {
  console.log(`Approval-routing sweep starting (${isoDate()})`);

  const technicalSeoRouted = await routeTechnicalSeoIssues();
  const mobilePerformanceRouted = await routeMobilePerformanceIssues();

  console.log("Approval-routing sweep complete.");
  console.log(`  HW Technical SEO issues routed to HW Tasks: ${technicalSeoRouted}`);
  console.log(`  HW Mobile & Performance issues routed to HW Tasks: ${mobilePerformanceRouted}`);
}

main().catch((err) => {
  console.error("Approval-routing sweep failed:", err);
  process.exitCode = 1;
});
