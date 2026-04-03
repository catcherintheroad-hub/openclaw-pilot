# OpenClaw Pilot

**OpenClaw Pilot — 把模糊想法编译成可执行的 AI 工作指令。**

OpenClaw Pilot 是一个面向 OpenClaw 的源码优先插件。它把用户的模糊目标编译成两段式交付：

1. 给人看的规划蓝图
2. 可直接发送给 OpenClaw 的执行指令包

这让 `/pilot` 更像一个“任务编译器”，而不是单纯的提示词润色器。

## 这是什么

很多任务失败，不是模型不行，而是输入太模糊、范围太散、阶段不清。

OpenClaw Pilot 的作用，是把模糊输入编译成：

- 收敛后的阶段目标
- 明确的范围内 / 范围外
- 可继续推进的 `pilot_id`
- 一份机器可执行的执行包

## 核心能力

- **`/pilot`：新任务编译**
- **`/pilot next <pilot_id>`：同项目续跑**
- **两条消息交付**
- **中文默认输出支持**
- **风险分级与执行前收敛**
- **structured professionalizer 稳定性增强**

## `/pilot` 和 `/pilot next` 是干什么的

### `/pilot`
用于开始一个新方向，输出阶段蓝图与执行包。

### `/pilot next <pilot_id>`
用于在同一个项目上继续推进下一阶段，不重新开题。

## 两条消息交付是什么

### 第一条
给人看，负责说明当前阶段、范围、约束和下一步。

### 第二条
给 OpenClaw 执行，使用：

- `[OPENCLAW_EXECUTION_PACKET v1]`
- `...`
- `[END_OPENCLAW_EXECUTION_PACKET]`

## 仓库现状

本仓库已经包含**真实可运行源码**、配置、测试与最小文档，不再只是 README 骨架。

当前公开版重点包括：

- `/pilot` 新任务编译流程
- `/pilot next` 续跑流程
- 两条消息交付
- 中文默认输出支持
- 风险分级与执行前收敛
- professionalizer 恢复与降级路径

## 仓库结构

```text
openclaw-pilot/
├─ src/
├─ test/
├─ tests/
├─ config/
├─ docs/
├─ examples/
├─ scripts/
├─ package.json
├─ tsconfig.json
├─ vitest.config.ts
└─ openclaw.plugin.json
```

## 安装

### 开发环境

```bash
pnpm install
pnpm typecheck
pnpm test
```

### 本地插件安装

```bash
openclaw plugins install -l .
openclaw gateway restart
```

## 基本安装/开发命令

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## 测试命令

```bash
pnpm typecheck
pnpm test
```

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [发布清单](docs/LAUNCH_CHECKLIST.md)
- [产品定位](docs/PRODUCT_POSITIONING.md)
- [配置说明](docs/configuration.md)
- [安装说明](docs/installation.md)

## 许可证

MIT，见 [LICENSE](LICENSE)。
