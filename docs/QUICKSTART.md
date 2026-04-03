# Quickstart

## 1. Install

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## 2. Install locally into OpenClaw

```bash
openclaw plugins install -l .
openclaw gateway restart
```

## 3. Verify the plugin is loaded

```bash
openclaw command-pilot:print-runtime-fingerprint
```

## 4. Try a first command

```text
/pilot 我想做一个针对跨境电商卖家的 AI 单证核对 MVP，只覆盖合同、发票、装箱单三类文档的自动比对。先不要执行，先给我一个最小可行版本的规划。
```

Expected behavior:
- message 1 contains A/C/D
- message 2 contains only the OpenClaw packet
- Chinese input defaults to Chinese output

## 5. Continue the same project

```text
/pilot next <pilot_id> 继续刚才同一个项目，下一阶段只收敛字段 schema 与差异判定规则，不要开始开发。
```
