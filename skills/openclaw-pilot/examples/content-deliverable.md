# Example: content-style request

## Input

```text
/pilot 帮我做一个推荐这个 pilot skill 的抖音视频脚本，并告诉我怎么发更容易传播。
```

## Expected shape

### Message 1

For this kind of low-risk content request, message 1 should ship a real deliverable first, for example:

- a short video script
- title suggestions
- cover text direction
- publish timing suggestions
- comment CTA suggestions

It should not open by pretending this is a blueprint-only planning task.

### Message 2

A separate pure packet message:

```text
[OPENCLAW_EXECUTION_PACKET v1]
...
[END_OPENCLAW_EXECUTION_PACKET]
```

## Why this matters

Content-style requests are not helped by an empty planning shell. The user should get something directly usable first, while the packet remains available for continued OpenClaw execution.
