// Thin, dependency-free client for the monday.com GraphQL API (v2).
// Every write is designed to be safe to re-run: callers look up existing
// items/groups before creating, so a job that fails partway through and
// retries does not produce duplicate items.

const MONDAY_API_URL = "https://api.monday.com/v2";

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

async function mondayRequest(query, variables = {}) {
  const token = requireToken();
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
    throw new Error(`monday.com API HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = await res.json();
  if (json.errors && json.errors.length > 0) {
    throw new Error(
      `monday.com API error: ${json.errors.map((e) => e.message).join("; ")}`
    );
  }
  return json.data;
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
};
