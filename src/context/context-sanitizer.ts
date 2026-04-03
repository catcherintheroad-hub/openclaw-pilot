import type { GatheredContext, PilotContextSnapshot } from "../domain/types.js";
import { normalizeWhitespace, truncate } from "../utils/text.js";

type SnapshotMessage = PilotContextSnapshot["recentMessages"][number];
type RawMessageLike = {
  role?: string;
  type?: string;
  content?: unknown;
  text?: string;
  toolCall?: unknown;
  toolCalls?: unknown;
  toolResult?: unknown;
  toolResults?: unknown;
  name?: string;
};

const NOISE_PATTERNS = [
  /^command pilot brief\b/i,
  /\bnext_cmd\s*:/i,
  /\bstate\s*:/i,
  /gateway is draining(?: for restart)?/i,
  /conversation info \(untrusted metadata\)/i,
  /sender \(untrusted metadata\)/i,
  /\bqueued-message\b/i,
  /\bqueued message\b/i,
  /\brate_limit_error\b/i,
  /\bsurface_error\b/i,
  /\btoolcall\b/i,
  /\btoolresult\b/i,
];

const ASSISTANT_NOISE_PATTERNS = [
  /\brestart\b/i,
  /\bprobe\b/i,
  /\bhealth ?check\b/i,
  /\bqueue(?:d|ing)?\b/i,
  /\blog(?:s)?\b/i,
  /\bsuccessfully replaced\b/i,
  /\bgit status\b/i,
  /\bgit add\b/i,
  /\bgit commit\b/i,
  /\bgit push\b/i,
  /\bauto-pushing\b/i,
  /^to https?:\/\//i,
  /^\[main [a-f0-9]{5,}/i,
  /\btoolcall\b.*\bexec\b/i,
  /\btoolresult\b/i,
  /\bshell\b.*(?:stdout|stderr|exit code|command)/i,
  /\bpatch\b.*(?:applied|updated|replaced)/i,
  /\bdiff\b.*(?:@@|\+\+\+|---)/i,
  /\bstdout\b/i,
  /\bstderr\b/i,
];

const CONSTRAINT_PATTERNS = [
  /don't\b/i,
  /\bdo not\b/i,
  /\bavoid\b/i,
  /\bonly\b/i,
  /\bwithout\b/i,
  /\bfirst\b/i,
  /\bkeep\b/i,
  /不要/,
  /先/,
  /仅/,
  /只/,
  /别/,
];

const UI_PATTERNS = [
  /\bui\b/i,
  /\bpage\b/i,
  /\bhomepage\b/i,
  /\bhome page\b/i,
  /\broles?\b/i,
  /\blayout\b/i,
  /\bstyle\b/i,
  /\bfrontend\b/i,
  /\bdesign\b/i,
  /首页/,
  /页面/,
  /风格/,
];

const WORKSPACE_PATTERNS = [
  /\bworkspace\b/i,
  /\bproject\b/i,
  /\brepo\b/i,
  /\bcurrent project\b/i,
  /\bocax\b/i,
  /\bopenclaw\b/i,
  /当前项目/,
  /目录/,
  /仓库/,
];

function isToolLikeValue(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    "toolCall" in record ||
    "toolCalls" in record ||
    "toolResult" in record ||
    "toolResults" in record ||
    record.type === "toolCall" ||
    record.type === "toolResult" ||
    record.role === "tool" ||
    record.role === "toolcall" ||
    record.role === "toolresult"
  );
}

function extractNaturalLanguageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (!entry || typeof entry !== "object") {
          return "";
        }
        const record = entry as Record<string, unknown>;
        if (record.type && typeof record.type === "string" && /tool/i.test(record.type)) {
          return "";
        }
        if (typeof record.text === "string") {
          return record.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (isToolLikeValue(content)) {
    return "";
  }
  return "";
}

export function sanitizePromptBuildMessages(messages: unknown[]): SnapshotMessage[] {
  const normalized = messages.map((message) => {
    const record = message as RawMessageLike;
    if (isToolLikeValue(record)) {
      return { role: "ignored", text: "" };
    }
    const role = normalizeWhitespace(record.role ?? "").toLowerCase() || "unknown";
    const type = normalizeWhitespace(record.type ?? "").toLowerCase();
    if (type === "toolcall" || type === "toolresult" || role === "tool" || role === "toolcall" || role === "toolresult") {
      return { role: "ignored", text: "" };
    }
    const text = typeof record.text === "string" ? record.text : extractNaturalLanguageText(record.content);
    return {
      role,
      text: truncate(normalizeWhitespace(text), 600),
    };
  });

  return sanitizeTranscriptMessages(normalized);
}

function isNoiseMessage(message: SnapshotMessage): boolean {
  const text = normalizeWhitespace(message.text ?? "");
  if (!text) {
    return true;
  }
  if (NOISE_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (message.role !== "user" && ASSISTANT_NOISE_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  return false;
}

function isAllowedRole(role: string): boolean {
  return role === "user" || role === "assistant";
}

export function sanitizeTranscriptMessages(
  messages: SnapshotMessage[],
  limits: { maxUserMessages?: number; maxAssistantMessages?: number } = {},
): SnapshotMessage[] {
  const maxUserMessages = limits.maxUserMessages ?? 4;
  const maxAssistantMessages = limits.maxAssistantMessages ?? 2;
  const selected: SnapshotMessage[] = [];
  let userCount = 0;
  let assistantCount = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    const role = normalizeWhitespace(entry.role ?? "").toLowerCase() || "unknown";
    const text = truncate(normalizeWhitespace(entry.text ?? ""), 600);
    if (!isAllowedRole(role) || isNoiseMessage({ role, text })) {
      continue;
    }
    if (role === "user") {
      if (userCount >= maxUserMessages) {
        continue;
      }
      userCount += 1;
    } else {
      if (assistantCount >= maxAssistantMessages) {
        continue;
      }
      assistantCount += 1;
    }
    selected.push({ role, text });
  }

  return selected.reverse();
}

export function sanitizeSnapshot(snapshot: PilotContextSnapshot | undefined): PilotContextSnapshot | undefined {
  if (!snapshot) {
    return undefined;
  }
  return {
    ...snapshot,
    recentMessages: sanitizeTranscriptMessages(snapshot.recentMessages),
  };
}

function buildTranscriptSummary(messages: SnapshotMessage[]): string[] {
  if (messages.length === 0) {
    return ["current request only", "no strong prior constraints found"];
  }

  const joined = messages.map((entry) => entry.text).join("\n");
  const summary: string[] = [];

  if (UI_PATTERNS.some((pattern) => pattern.test(joined))) {
    summary.push("recent UI task discussion");
  }
  if (WORKSPACE_PATTERNS.some((pattern) => pattern.test(joined))) {
    summary.push("current workspace intent");
  }
  if (CONSTRAINT_PATTERNS.some((pattern) => pattern.test(joined))) {
    summary.push("constraints from recent discussion");
  } else {
    summary.push("no strong prior constraints found");
  }
  if (summary.length === 0) {
    summary.push("recent task discussion");
  }

  return Array.from(new Set(summary)).slice(0, 3);
}

export function buildContextSummary(context: GatheredContext): string[] {
  const messages = sanitizeTranscriptMessages(context.snapshot?.recentMessages ?? []);
  const summary = buildTranscriptSummary(messages);
  if (context.standingOrders.length > 0) {
    summary.push("standing orders applied");
  }
  return Array.from(new Set(summary)).slice(0, 4);
}

export function buildPromptConversationLines(context: GatheredContext): string[] {
  return sanitizeTranscriptMessages(context.snapshot?.recentMessages ?? [])
    .map((message) => `${message.role.toUpperCase()}: ${message.text}`)
    .slice(-6);
}
