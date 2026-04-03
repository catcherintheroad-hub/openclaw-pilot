import type { PilotOutputLanguage } from "../domain/types.js";

const CJK_PATTERN = /[\u3400-\u9FFF\uF900-\uFAFF]/g;

export function detectPilotOutputLanguage(input: string | undefined): PilotOutputLanguage {
  if (!input) {
    return "en";
  }
  const normalized = input.trim();
  if (!normalized) {
    return "en";
  }
  const cjkMatches = normalized.match(CJK_PATTERN) ?? [];
  return cjkMatches.length > 0 ? "zh-CN" : "en";
}

export function isChinesePilotOutput(language: PilotOutputLanguage): boolean {
  return language === "zh-CN";
}
