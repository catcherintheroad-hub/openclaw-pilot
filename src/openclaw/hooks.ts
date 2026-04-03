import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { PilotPluginConfig } from "../config/schema.js";

export function registerPilotHooks(api: OpenClawPluginApi, config: PilotPluginConfig): void {
  api.on("before_prompt_build", async () => {
    if (!config.standingOrders.length) {
      return;
    }
    return {
      prependSystemContext: [
        "Command Pilot standing orders:",
        ...config.standingOrders.map((entry) => `- ${entry}`)
      ].join("\n")
    };
  });
}
