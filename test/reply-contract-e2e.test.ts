import { describe, expect, it } from "vitest";
import type { PilotCommandPacket, PilotFeedbackContract, PilotState } from "../src/domain/types.js";
import { renderPlanResponseParts } from "../src/orchestration/response-renderer.js";

function buildState(language: "zh-CN" | "en", pilotId = "pilot-e2e-1"): PilotState {
  return {
    pilot_id: pilotId,
    project_goal: language === "zh-CN" ? "把模糊想法变成可执行工作包" : "Turn rough ideas into executable work packets",
    core_thesis: language === "zh-CN" ? "先给人看蓝图，再给 OpenClaw 干净 packet" : "Blueprint first, then a clean packet for OpenClaw",
    project_blueprint: {
      pilot_id: pilotId,
      project_goal: language === "zh-CN" ? "把模糊想法变成可执行工作包" : "Turn rough ideas into executable work packets",
      core_thesis: language === "zh-CN" ? "先给人看蓝图，再给 OpenClaw 干净 packet" : "Blueprint first, then a clean packet for OpenClaw",
      current_stage: {
        stage_id: "stage-1",
        stage_name: language === "zh-CN" ? "蓝图阶段" : "Blueprint stage",
        stage_objective: language === "zh-CN" ? "编译第一阶段执行包" : "Compile the first-stage execution packet",
        why_this_stage_now: language === "zh-CN" ? "先锁定范围和交付 contract。" : "Lock scope and delivery contract first.",
        in_scope_now: language === "zh-CN" ? ["蓝图", "packet", "continuation"] : ["blueprint", "packet", "continuation"],
        out_of_scope_now: language === "zh-CN" ? ["无关宿主集成"] : ["unrelated host integration"],
        success_criteria: language === "zh-CN" ? ["严格输出两条消息"] : ["Emit exactly two messages"],
        key_risks: language === "zh-CN" ? ["packet 被混入说明文字"] : ["Packet drifts back into prose"],
        constraints: language === "zh-CN" ? ["最小改造"] : ["minimum change"],
      },
      run_mode: "plan_only",
    },
    current_stage_id: "stage-1",
    current_stage_name: language === "zh-CN" ? "蓝图阶段" : "Blueprint stage",
    current_stage_objective: language === "zh-CN" ? "编译第一阶段执行包" : "Compile the first-stage execution packet",
    generated_command: "",
    generated_command_preview: "",
    run_mode: "plan_only",
    execution_feedback_history: [],
    latest_feedback_summary: "",
    next_step_rationale: language === "zh-CN" ? "先锁定范围和交付 contract。" : "Lock scope and delivery contract first.",
    risk_level: "low",
    confirmation_required: false,
    created_at: 1,
    updated_at: 1,
    status: "active",
    output_language: language,
    response_strategy: "blueprint-first",
  };
}

function buildPacket(language: "zh-CN" | "en", pilotId = "pilot-e2e-1"): PilotCommandPacket {
  return {
    packet_version: "v1",
    pilot_id: pilotId,
    project: language === "zh-CN" ? "把模糊想法变成可执行工作包" : "Turn rough ideas into executable work packets",
    stage: language === "zh-CN" ? "蓝图阶段" : "Blueprint stage",
    stage_objective: language === "zh-CN" ? "编译第一阶段执行包" : "Compile the first-stage execution packet",
    why_this_stage_now: language === "zh-CN" ? "先锁定范围和交付 contract。" : "Lock scope and delivery contract first.",
    known_context: language === "zh-CN" ? ["channel: webchat"] : ["channel: webchat"],
    in_scope: language === "zh-CN" ? ["蓝图", "packet", "continuation"] : ["blueprint", "packet", "continuation"],
    out_of_scope: language === "zh-CN" ? ["无关宿主集成"] : ["unrelated host integration"],
    constraints: language === "zh-CN" ? ["最小改造"] : ["minimum change"],
    execution_plan: language === "zh-CN" ? ["先出蓝图", "再单独输出 packet"] : ["Emit blueprint first", "Emit packet separately"],
    deliverables: language === "zh-CN" ? ["蓝图", "packet"] : ["blueprint", "packet"],
    validation: language === "zh-CN" ? ["严格输出两条消息"] : ["Emit exactly two messages"],
    stop_conditions: language === "zh-CN" ? ["发现 contract 漂移就停止"] : ["Stop if the contract drifts"],
    do_not: language === "zh-CN" ? ["不要把说明混进 packet"] : ["Do not mix prose into the packet"],
    return_format: language === "zh-CN" ? ["状态：done | blocked"] : ["STATUS: done | blocked"],
  };
}

function buildFeedbackContract(language: "zh-CN" | "en", pilotId = "pilot-e2e-1"): PilotFeedbackContract {
  return {
    what_to_send_back: language === "zh-CN"
      ? [`pilot_id: ${pilotId}`, "current_stage_id: stage-1", "latest_feedback_summary: <OpenClaw 反馈摘要>"]
      : [`pilot_id: ${pilotId}`, "current_stage_id: stage-1", "latest_feedback_summary: <OpenClaw feedback summary>"],
    if_blocked: language === "zh-CN"
      ? ["如果被阻塞，回传精确阻塞点。"]
      : ["If blocked, return the exact blocker."],
    next_command_template: `/pilot next ${pilotId} ${language === "zh-CN" ? "<OpenClaw 反馈>" : "<OpenClaw feedback>"}`,
  };
}

describe("reply contract e2e rendering", () => {
  it("renders new-task delivery as two final user-visible messages in Chinese", () => {
    const rendered = renderPlanResponseParts({
      state: buildState("zh-CN", "pilot-e2e-zh"),
      packet: buildPacket("zh-CN", "pilot-e2e-zh"),
      feedbackContract: buildFeedbackContract("zh-CN", "pilot-e2e-zh"),
    });

    expect(rendered.messages).toHaveLength(2);
    expect(rendered.messages[0].text).toContain("A. Command Pilot 蓝图");
    expect(rendered.messages[0].text).toContain("可直接发送给 OpenClaw 的命令已在下一条消息单独发送");
    expect(rendered.messages[0].text).not.toContain("[OPENCLAW_EXECUTION_PACKET v1]");
    expect(rendered.messages[1].text).toBe(rendered.packetText);
    expect(rendered.messages[1].text.startsWith("[OPENCLAW_EXECUTION_PACKET v1]\n")).toBe(true);
    expect(rendered.messages[1].text.trim().endsWith("[END_OPENCLAW_EXECUTION_PACKET]")).toBe(true);
    expect(rendered.messages[1].text).not.toContain("A. Command Pilot 蓝图");
    expect(rendered.messages[1].text).not.toContain("B. 可直接发送给 OpenClaw 的命令");
    expect(rendered.messages[1].text).not.toContain("C. 应回传给 /pilot 的内容");
    expect(rendered.messages[1].text).not.toContain("D. 下一条命令");
  });

  it("renders continuation delivery as the same final two-message contract", () => {
    const rendered = renderPlanResponseParts({
      state: buildState("zh-CN", "pilot-e2e-next"),
      packet: buildPacket("zh-CN", "pilot-e2e-next"),
      feedbackContract: buildFeedbackContract("zh-CN", "pilot-e2e-next"),
    });

    expect(rendered.messages).toHaveLength(2);
    expect(rendered.messages[0].text).not.toContain("[OPENCLAW_EXECUTION_PACKET v1]");
    expect(rendered.messages[1].text).toBe(rendered.packetText);
    expect(rendered.messages[1].text).toMatch(/^\[OPENCLAW_EXECUTION_PACKET v1\][\s\S]*\[END_OPENCLAW_EXECUTION_PACKET\]\s*$/);
    expect(rendered.messages[1].text).not.toContain("可直接发送给 OpenClaw 的命令已在下一条消息单独发送");
  });

  it("keeps the packet-only second message clean in English too", () => {
    const rendered = renderPlanResponseParts({
      state: buildState("en", "pilot-e2e-en"),
      packet: buildPacket("en", "pilot-e2e-en"),
      feedbackContract: buildFeedbackContract("en", "pilot-e2e-en"),
    });

    expect(rendered.messages).toHaveLength(2);
    expect(rendered.messages[0].text).toContain("A. Command Pilot Blueprint");
    expect(rendered.messages[0].text).toContain("The ready-to-send OpenClaw command has been sent as a separate message below");
    expect(rendered.messages[0].text).not.toContain("[OPENCLAW_EXECUTION_PACKET v1]");
    expect(rendered.messages[1].text).toBe(rendered.packetText);
    expect(rendered.messages[1].text.startsWith("[OPENCLAW_EXECUTION_PACKET v1]\n")).toBe(true);
    expect(rendered.messages[1].text.trim().endsWith("[END_OPENCLAW_EXECUTION_PACKET]")).toBe(true);
    expect(rendered.messages[1].text).not.toContain("A. Command Pilot Blueprint");
    expect(rendered.messages[1].text).not.toContain("B. Ready-to-send OpenClaw Command");
    expect(rendered.messages[1].text).not.toContain("C. What to send back");
    expect(rendered.messages[1].text).not.toContain("D. Next command");
  });
});
