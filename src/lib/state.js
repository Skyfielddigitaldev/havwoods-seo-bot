// Simple JSON file state store under data/. The GitHub Actions workflow
// commits changes to this directory back to the repo after each run, so
// the next run can tell what it already knows (already-logged issues,
// last known positions, last CWV numbers) without a database.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");

export async function readState(fileName, fallback) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!existsSync(filePath)) return fallback;
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`Could not read/parse ${filePath}, using fallback. (${err.message})`);
    return fallback;
  }
}

export async function writeState(fileName, data) {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  const filePath = path.join(DATA_DIR, fileName);
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
