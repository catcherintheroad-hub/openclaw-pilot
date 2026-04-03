import fs from "node:fs/promises";
import path from "node:path";
import type { PendingApproval } from "../domain/types.js";

type StoredApprovals = {
  approvals: PendingApproval[];
};

export class PendingApprovalsStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<PendingApproval[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoredApprovals;
      const now = Date.now();
      return (parsed.approvals ?? []).filter((entry) => entry.expiresAt > now);
    } catch {
      return [];
    }
  }

  async save(approval: PendingApproval): Promise<void> {
    const approvals = await this.list();
    const next = approvals.filter((entry) => entry.id !== approval.id);
    next.push(approval);
    await this.write(next);
  }

  async get(id: string): Promise<PendingApproval | undefined> {
    const approvals = await this.list();
    return approvals.find((entry) => entry.id === id);
  }

  async getByPilotId(pilotId: string): Promise<PendingApproval | undefined> {
    const approvals = await this.list();
    return approvals.find((entry) => entry.pilotId === pilotId);
  }

  async consume(id: string): Promise<PendingApproval | undefined> {
    const approvals = await this.list();
    const hit = approvals.find((entry) => entry.id === id);
    if (!hit) {
      return undefined;
    }
    await this.write(approvals.filter((entry) => entry.id !== id));
    return hit;
  }

  async discard(id: string): Promise<boolean> {
    const approvals = await this.list();
    const filtered = approvals.filter((entry) => entry.id !== id);
    if (filtered.length === approvals.length) {
      return false;
    }
    await this.write(filtered);
    return true;
  }

  async discardByPilotId(pilotId: string): Promise<boolean> {
    const approvals = await this.list();
    const filtered = approvals.filter((entry) => entry.pilotId !== pilotId);
    if (filtered.length === approvals.length) {
      return false;
    }
    await this.write(filtered);
    return true;
  }

  private async write(approvals: PendingApproval[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify({ approvals }, null, 2));
  }
}
