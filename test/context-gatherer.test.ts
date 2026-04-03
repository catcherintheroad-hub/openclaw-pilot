import { describe, expect, it } from "vitest";
import { ConversationCache } from "../src/context/conversation-cache.js";
import { sanitizePromptBuildMessages } from "../src/context/context-sanitizer.js";

describe("conversation cache", () => {
  it("finds snapshots by conversation id", () => {
    const cache = new ConversationCache("/tmp/unused.json", 50);
    cache.remember({
      sessionKey: "agent:main:web:demo",
      channel: "web",
      accountId: "default",
      conversationId: "conversation-1",
      senderId: "user-1",
      recentMessages: [{ role: "user", text: "hello" }],
      updatedAt: Date.now(),
    });

    const hit = cache.find({
      channel: "web",
      accountId: "default",
      conversationId: "conversation-1",
    });
    expect(hit?.sessionKey).toBe("agent:main:web:demo");
  });

  it("drops tool messages and execution receipts from prompt-build transcript snapshots", () => {
    const sanitized = sanitizePromptBuildMessages([
      { role: "user", text: "把当前项目直接推到远程主分支" },
      { role: "assistant", type: "toolCall", content: [{ type: "toolCall", text: "exec git push origin main" }] },
      { role: "tool", text: "toolResult: auto-pushing main to origin..." },
      { role: "assistant", text: "toolResult: Successfully replaced 2 block(s) in src/index.ts" },
      { role: "assistant", text: "assistant: toolCall exec git commit -m 'ship it'" },
      { role: "assistant", text: "To https://github.com/example/repo.git" },
      { role: "assistant", text: "[main abc1234] chore: update plugin" },
      { role: "assistant", text: "We should review the repo state first and wait for confirmation before any remote mutation." },
    ]);

    expect(sanitized).toEqual([
      { role: "user", text: "把当前项目直接推到远程主分支" },
      {
        role: "assistant",
        text: "We should review the repo state first and wait for confirmation before any remote mutation.",
      },
    ]);
  });
});
