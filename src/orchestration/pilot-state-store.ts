import fs from "node:fs/promises";
import path from "node:path";
import type { PilotState } from "../domain/types.js";

type StoredPilotStates = {
  states: PilotState[];
};

export class PilotStateStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<PilotState[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoredPilotStates;
      return parsed.states ?? [];
    } catch {
      return [];
    }
  }

  async get(pilotId: string): Promise<PilotState | undefined> {
    const states = await this.list();
    return states.find((entry) => entry.pilot_id === pilotId);
  }

  async save(state: PilotState): Promise<void> {
    const states = await this.list();
    const next = states.filter((entry) => entry.pilot_id !== state.pilot_id);
    next.push(state);
    await this.write(next);
  }

  async discard(pilotId: string): Promise<PilotState | undefined> {
    const states = await this.list();
    const index = states.findIndex((entry) => entry.pilot_id === pilotId);
    if (index < 0) {
      return undefined;
    }
    const current = states[index];
    const next = [...states];
    next[index] = {
      ...current,
      status: "discarded",
      updated_at: Date.now(),
    };
    await this.write(next);
    return next[index];
  }

  async update(pilotId: string, updater: (state: PilotState) => PilotState): Promise<PilotState | undefined> {
    const states = await this.list();
    const index = states.findIndex((entry) => entry.pilot_id === pilotId);
    if (index < 0) {
      return undefined;
    }
    const updated = updater(states[index]);
    const next = [...states];
    next[index] = updated;
    await this.write(next);
    return updated;
  }

  private async write(states: PilotState[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify({ states }, null, 2));
  }
}
