// Thin, dependency-free client for the monday.com GraphQL API (v2).
// Every write is designed to be safe to re-run: callers look up existing
// items/groups before creating, so a job that fails partway through and
// retries does not produce duplicate items.

const MONDAY_API_URL = "https://api.monday.com/v2";

// monday.com occasionally returns a transient 5xx or an "Internal Server
// Error"/"Complexity budget exhausted" GraphQL error under load. These
// clear up on their own within a few seconds, and every write in this file
// is already safe to retry (callers look up existing items/groups first),
// so a short retry with backoff here saves an otherwise-healthy 15+ minute
// job from dying on one blip.
const MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable({ httpStatus, message }) {
  if (httpStatus && httpStatus >= 500) return true;
  if (httpStatus === 429) return true;
  if (!message) return false;
  return /internal server error|timeout|timed out|rate limit|complexity budget exhausted|try again/i.test(
    message
  );
}

function requireToken() {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    throw new Error(
      "MONDAY_API_TOKEN is not set. Add it as a GitHub Actions secret or " +
        "in a local .env file (see .env.example)."
    );
  }
  return token;
}

async function mondayRequestOnce(query, variables, token) {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`monday.com API HTTP ${res.status}: ${text.slice(0, 500)}`);
    err.httpStatus = res.status;
    throw err;
  }

  const json = await res.json();
  if (json.errors && json.errors.length > 0) {
    const message = json.errors.map((e) => e.message).join("; ");
    const err = new Error(`monday.com API error: ${message}`);
    err.graphqlMessage = message;
    throw err;
  }
  return json.data;
}

async function mondayRequest(query, variables = {}) {
  const token = requireToken();
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await mondayRequestOnce(query, variables, token);
    } catch (err) {
      lastError = err;
      const retryable = isRetryable({
        httpStatus: err.httpStatus,
        message: err.graphqlMessage ?? err.message,
      });
      if (!retryable || attempt === MAX_ATTEMPTS) throw err;

      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `  monday.com request failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.message}. Retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

export async function getBoardGroups(boardId) {
  const data = await mondayRequest(
    `query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        groups { id title }
      }
    }`,
    { boardId: [String(boardId)] }
  );
  return data.boards[0]?.groups ?? [];
}

export async function createGroup(boardId, groupName) {
  const data = await mondayRequest(
    `mutation ($boardId: ID!, $groupName: String!) {
      create_group(board_id: $boardId, group_name: $groupName) { id title }
    }`,
    { boardId: String(boardId), groupName }
  );
  return data.create_group;
}

// Returns the group id for the given name, creating it if it doesn't exist.
export async function findOrCreateGroup(boardId, groupName) {
  const groups = await getBoardGroups(boardId);
  const existing = groups.find(
    (g) => g.title.trim().toLowerCase() === groupName.trim().toLowerCase()
  );
  if (existing) return existing.id;
  const created = await createGroup(boardId, groupName);
  return created.id;
}

// Fetches all items in a board (optionally scoped to one group), with
// column values. Paginates automatically.
export async function getBoardItems(boardId, { groupId, columnIds } = {}) {
  const items = [];
  let cursor = null;

  do {
    const data = await mondayRequest(
      `query ($boardId: [ID!], $cursor: String, $columnIds: [String!]) {
        boards(ids: $boardId) {
          items_page(limit: 100, cursor: $cursor) {
            cursor
            items {
              id
              name
              group { id title }
              column_values(ids: $columnIds) { id text value }
            }
          }
        }
      }`,
      { boardId: [String(boardId)], cursor, columnIds: columnIds ?? null }
    );
    const page = data.boards[0]?.items_page;
    if (!page) break;
    for (const item of page.items) {
      if (!groupId || item.group.id === groupId) items.push(item);
    }
    cursor = page.cursor;
  } while (cursor);

  return items;
}

export async function createItem(boardId, groupId, name, columnValues = {}) {
  const data = await mondayRequest(
    `mutation ($boardId: ID!, $groupId: String, $name: String!, $columnValues: JSON) {
      create_item(
        board_id: $boardId
        group_id: $groupId
        item_name: $name
        column_values: $columnValues
        create_labels_if_missing: true
      ) { id }
    }`,
    {
      boardId: String(boardId),
      groupId: groupId ?? null,
      name,
      columnValues: JSON.stringify(columnValues),
    }
  );
  return data.create_item.id;
}

export async function createSubitem(parentItemId, name, columnValues = {}) {
  const data = await mondayRequest(
    `mutation ($parentItemId: ID!, $name: String!, $columnValues: JSON) {
      create_subitem(
        parent_item_id: $parentItemId
        item_name: $name
        column_values: $columnValues
        create_labels_if_missing: true
      ) { id }
    }`,
    {
      parentItemId: String(parentItemId),
      name,
      columnValues: JSON.stringify(columnValues),
    }
  );
  return data.create_subitem.id;
}

export async function changeColumnValues(boardId, itemId, columnValues) {
  await mondayRequest(
    `mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(
        board_id: $boardId
        item_id: $itemId
        column_values: $columnValues
        create_labels_if_missing: true
      ) { id }
    }`,
    {
      boardId: String(boardId),
      itemId: String(itemId),
      columnValues: JSON.stringify(columnValues),
    }
  );
}

export async function createUpdate(itemId, body) {
  await mondayRequest(
    `mutation ($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) { id }
    }`,
    { itemId: String(itemId), body }
  );
}

// Helper column-value builders, since monday's JSON shapes are easy to get
// wrong and this keeps every script consistent.
export const columnValue = {
  status: (label) => ({ label }),
  date: (isoDateString) => ({ date: isoDateString }),
  people: (userIds) => ({ personsAndTeams: userIds.map((id) => ({ id, kind: "person" })) }),
  link: (url, text) => ({ url, text: text ?? url }),
  text: (value) => String(value),
  numbers: (value) => (value === null || value === undefined ? "" : String(value)),
  checkbox: (checked) => ({ checked: checked ? "true" : "false" }),
};
