# Pi "Write Terminated" Issue — Research Findings
> Created: 2026-06-18
> Status: Known issue, partially fixed in newer versions, workarounds available

## Summary

The "terminated" error during `write` and `edit` tool calls is a **known, well-documented issue** with pi. It manifests as tool calls aborting with the message `terminated` after approximately 5 minutes of slow LLM streaming. It primarily affects users of **local/slow models** (llama.cpp, vLLM, etc.) where token generation is slow.

## Root Cause

The underlying cause is **undici's default `bodyTimeout: 300000` (5 minutes)** on the global HTTP dispatcher. When an LLM stream has a gap >5 minutes between SSE chunks (e.g., during long thinking/prefill stalls or slow token generation), undici severs the fetch socket regardless of the `retry.provider.timeoutMs` setting.

The `retry.provider.timeoutMs` setting flows into the OpenAI SDK's `AbortController`-based total-request timeout, **not** undici's per-socket idle timer. Setting it to 1 hour or 1 day does not help.

Source: `packages/coding-agent/src/cli.ts` — `setGlobalDispatcher(new EnvHttpProxyAgent())` with no options.

## Affected GitHub Issues

| Issue | Title | Status | Key Detail |
|-------|-------|--------|------------|
| [#2257](https://github.com/earendil-works/pi/issues/2257) | Local model call has 300 second timeout | Closed | Original report; proposed `bodyTimeout: 0` fix |
| [#3159](https://github.com/earendil-works/pi/issues/3159) | edit tool terminated - timeout | Closed | Qwen 27b local; constant failures |
| [#3715](https://github.com/earendil-works/pi/issues/3715) | local-llm streams terminate at 5 min from undici bodyTimeout | Closed | Detailed root cause analysis; confirmed proxy-side |
| [#4519](https://github.com/earendil-works/pi/issues/4519) | edit timeout after 5 minutes with "terminated" | Closed | Appeared in v0.73-0.74; timeoutMs workaround doesn't work |
| [#5089](https://github.com/earendil-works/pi/issues/5089) | Doesn't respect timeoutMs past a certain value | Closed | Confirmed timeoutMs is read but capped by undici |
| [#845](https://github.com/earendil-works/pi/issues/845) | "Error: terminated" with glm-4.7 from z.ai | Open | Provider-specific; backend flakiness |

## Fixes in Pi's Changelog

- **"Fixed interactive mode freezes during large streaming write tool calls"** — incremental syntax highlighting while partial arguments stream, final highlight on complete
- **"Auto-retry now handles 'terminated' errors from Codex API mid-stream failures"** — `terminated` is matched as retryable in the retry path

## Current Workarounds

### 1. Use a Proxy with Timeout Bypass
Route through a vLLM proxy or similar with `timeout: 0` (no timeout):
```
# vLLM proxy config
timeout: 0
```
Confirmed to work with 600+ second stream gaps.

### 2. Increase Retry Attempts
In `~/.pi/agent/settings.json`:
```json
{
  "retry": {
    "enabled": true,
    "maxRetries": 5,
    "baseDelayMs": 2000,
    "provider": {
      "timeoutMs": 3600000,
      "maxRetries": 3,
      "maxRetryDelayMs": 60000
    }
  }
}
```
Note: This doesn't prevent the initial termination but gives more retry budget.

### 3. Smaller Tool Calls
Break large file writes into smaller chunks. The `write` tool call fails when the **LLM's streaming response** takes >5 min, not the write itself. Smaller files = shorter generation = less chance of timeout.

### 4. Faster Model / Hardware
If using local models, increase token throughput (better GPU, smaller model, quantized model) to stay under the 5-minute gap threshold.

## What Doesn't Work

- ❌ Setting `retry.provider.timeoutMs` to very high values (it doesn't control undici's bodyTimeout)
- ❌ Disabling retry entirely (the error still occurs, just without retries)
- ❌ Using `--no-retry` flag (same)

## Status as of June 2026

Multiple issues are labeled `closed-because-refactor` or `closed-because-weekend`, suggesting the project is undergoing architectural changes that may address the root cause. The latest pi versions (0.75+) include auto-retry for `terminated` errors, which mitigates the impact but doesn't prevent the underlying timeout.

## Recommendations for pi-chat Package

Since pi-chat involves network communication between agents:
1. **Set reasonable WebSocket timeouts** — use heartbeat/ping-pong to keep connections alive
2. **Implement reconnection logic** — if a peer disconnects, retry automatically
3. **Keep messages short** — long messages increase the chance of LLM-side timeouts during generation
4. **Consider message chunking** — for very long messages, split into multiple shorter sends
