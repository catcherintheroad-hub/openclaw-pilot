export function mergeStandingRules(configRules: string[], dynamicRules: string[] = []): string[] {
  return [...new Set([...configRules, ...dynamicRules].map((entry) => entry.trim()).filter(Boolean))];
}
