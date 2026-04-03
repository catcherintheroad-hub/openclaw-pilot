import fs from "node:fs/promises";
import path from "node:path";
import type { ProfessionalizedCommand } from "../contracts/professionalizer.js";
import type { SessionContextBundle } from "../contracts/context.js";
import { createApprovalId } from "../utils/ids.js";

export type PendingApproval = {
  approvalId: string;
  createdAt: number;
  expiresAt: number;
  session: SessionContextBundle;
  professionalized: ProfessionalizedCommand;
};

function resolvePendingPath(stateDir: string, approvalId: string): string {
  return path.join(stateDir, "plugins", "command-pilot", "pending", `${approvalId}.json`);
}

export async function createPendingApproval(params: {
  stateDir: string;
  ttlMs: number;
  session: SessionContextBundle;
  professionalized: ProfessionalizedCommand;
}): Promise<PendingApproval> {
  const approvalId = createApprovalId();
  const record: PendingApproval = {
    approvalId,
    createdAt: Date.now(),
    expiresAt: Date.now() + params.ttlMs,
    session: params.session,
    professionalized: params.professionalized
  };
  const filePath = resolvePendingPath(params.stateDir, approvalId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export async function readPendingApproval(stateDir: string, approvalId: string): Promise<PendingApproval | null> {
  try {
    const raw = await fs.readFile(resolvePendingPath(stateDir, approvalId), "utf8");
    const parsed = JSON.parse(raw) as PendingApproval;
    if (parsed.expiresAt < Date.now()) {
      await deletePendingApproval(stateDir, approvalId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function deletePendingApproval(stateDir: string, approvalId: string): Promise<void> {
  await fs.rm(resolvePendingPath(stateDir, approvalId), { force: true });
}
