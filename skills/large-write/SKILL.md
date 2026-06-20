---
description: Use large_write for files over 5KB to avoid tool call generation timeouts by splitting content into small chunks
---

# Large Write

When writing files larger than 5KB, use `large_write` instead of `write`. This prevents tool call generation timeouts by keeping each individual tool call small.

## How to use large_write

Split large file content into chunks under 10KB each. Call `large_write` multiple times:

1. **First call**: provide `path` and first chunk of `content`
2. **Middle calls**: provide only `content` (path is remembered)  
3. **Final call**: provide last `content` chunk and set `finalize: true`

Example for a 30KB file:
```
large_write(path="bigfile.txt", content="first 10KB of content...")
# result: Chunk 1 accumulated (10240 bytes so far)

large_write(content="second 10KB of content...")
# result: Chunk 2 accumulated (20480 bytes so far)

large_write(content="final 10KB of content...", finalize=true)
# result: Successfully wrote 30720 bytes to bigfile.txt
```

## Rules

- **NEVER** put more than 10KB of content in a single call
- **ALWAYS** set `finalize: true` on the last call
- **ALWAYS** provide the `path` on the first call only
- The tool accumulates chunks in memory and writes to disk only when finalized
- For files under 5KB, use regular `write` instead

## When to use

- Generated code files, documentation, data files over 5KB
- Any write where content would exceed 100 lines
- Wikipedia articles, long reports, configuration dumps
