export function collectAssistantText(result: unknown): string {
  const payloads = (result as { payloads?: Array<{ text?: string; isError?: boolean }> }).payloads;
  return (payloads ?? [])
    .filter((entry) => !entry.isError && typeof entry.text === "string")
    .map((entry) => entry.text ?? "")
    .join("\n")
    .trim();
}
