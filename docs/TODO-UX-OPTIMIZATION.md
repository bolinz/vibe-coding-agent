# UX Optimization Checklist

## Phase 1 — Thinking & Error Feedback

- [x] Router: publish `agent.thinking` event before pipeline execution
- [x] Router: publish `agent.tool_executing` during tool calls
- [x] Feishu: subscribe `agent.thinking` → send "🤔 思考中..." card
- [x] Feishu: subscribe `agent.error` → send error message to user
- [x] Feishu: subscribe `agent.response` → replace loading card with response
- [x] Web SSE: forward `agent.thinking` / `agent.tool_executing`
- [x] Web UI: show thinking text in typing indicator area

## Phase 2 — Robustness Fixes

- [x] Feishu: fix fire-and-forget `doNewSession` / `doSetAgent` / `doSetSession`
- [x] Feishu: sidecar crash auto-recovery (subscribe `exit` + reconnect with backoff)

## Phase 3 — Web UI Improvements

- [x] Web: cancel button (`POST /api/chat/:id/cancel` + `AbortController` in pipeline)
- [x] Web: agent switch dropdown in session sidebar
- [x] Web: connection status indicator (green/yellow/red dot)

## Verify

- [x] `bun run typecheck` passes
- [x] `bun test` passes (64 pass / 0 fail)
- [x] Remote deploy, health check, all 3 channels connected
