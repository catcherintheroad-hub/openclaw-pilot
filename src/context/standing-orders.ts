import fs from "node:fs/promises";
import path from "node:path";
import type { StandingOrderExcerpt } from "../domain/types.js";
import { truncate } from "../utils/text.js";

export async function readStandingOrders(params: {
  workspacePath: string;
  paths: string[];
  maxCharsPerFile: number;
}): Promise<StandingOrderExcerpt[]> {
  const excerpts: StandingOrderExcerpt[] = [];
  for (const entry of params.paths) {
    const resolved = path.isAbsolute(entry) ? entry : path.resolve(params.workspacePath, entry);
    try {
      const raw = await fs.readFile(resolved, "utf8");
      excerpts.push({
        path: resolved,
        content: truncate(raw.trim(), params.maxCharsPerFile),
      });
    } catch {
      // Ignore missing files.
    }
  }
  return excerpts;
}
