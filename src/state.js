import { readFile, writeFile } from "node:fs/promises";

export async function readState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { availableKeys: [] };
    throw error;
  }
}

export async function writeState(path, state) {
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function diffAvailability(previousState, currentItems) {
  const previous = new Set(previousState.availableKeys || []);
  const current = new Set(currentItems.map((item) => item.key));
  const newItems = currentItems.filter((item) => !previous.has(item.key));
  return {
    newItems,
    nextState: { ...previousState, availableKeys: [...current].sort() }
  };
}
