/**
 * Large Write Extension
 *
 * Solves the "timeout on large file writes" problem by providing a tool that
 * accepts content in small incremental chunks across multiple tool calls.
 *
 * Root cause: When the LLM generates a single `write` call with 50KB+ content,
 * the output token generation phase can exceed provider idle timeouts (undici
 * bodyTimeout ~300s). The fix is to keep each individual tool call small.
 *
 * Strategy: The LLM calls `large_write` multiple times, each with a small
 * chunk (~10KB). The tool appends to a session-tracked file state. A final
 * `large_write` with `finalize: true` writes all accumulated chunks to disk.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

const MAX_CHUNK_BYTES = 10 * 1024; // 10KB per chunk
const LARGE_THRESHOLD = 5 * 1024;  // above this, recommend large_write

// Session-state key for tracking pending writes
const STATE_KEY = "large-write-pending";

interface PendingWrite {
  path: string;
  chunks: string[];
  totalBytes: number;
  totalLines: number;
}

export default function (pi: ExtensionAPI) {
  let pendingWrites: Map<string, PendingWrite> = new Map();

  pi.on("session_start", async (_event, ctx) => {
    // Restore any pending state from session
    const entries = ctx.sessionManager.getBranch();
    for (const entry of entries) {
      if (entry.type === "custom" && entry.customType === STATE_KEY) {
        const data = entry.data as PendingWrite | undefined;
        if (data) {
          pendingWrites.set(data.path, data);
        }
      }
    }
    ctx.ui.notify("large_write extension loaded", "info");
  });

  pi.on("session_shutdown", async () => {
    // Flush any pending writes on shutdown
    pendingWrites.clear();
  });

  pi.registerTool({
    name: "large_write",
    label: "large_write",
    description:
      "Write large files incrementally in chunks to avoid timeouts. Call this tool multiple times with small content chunks (under 10KB each). Set finalize=true on the last call to write the accumulated content to disk. Use instead of write for files over 5KB.",
    promptSnippet: "Write large files incrementally in small chunks to avoid timeouts",
    promptGuidelines: [
      "Use large_write for files over 5KB - split content into chunks under 10KB each",
      "Call large_write multiple times with small content, then finalize=true on the last call",
      "NEVER put more than 10KB of content in a single large_write call",
      "For the first call, just provide path and content. For subsequent calls, provide content only (path is remembered). For the final call, set finalize=true.",
    ],
    parameters: Type.Object({
      path: Type.Optional(Type.String({
        description: "File path (required on first call, remembered for subsequent calls)",
      })),
      content: Type.Optional(Type.String({
        description: "Content chunk (keep under 10KB per call to avoid timeouts)",
      })),
      finalize: Type.Optional(Type.Boolean({
        description: "Set to true on the last call to write all accumulated content to disk",
      })),
      reset: Type.Optional(Type.Boolean({
        description: "Set to true to discard any previously accumulated chunks and start fresh. Use when switching to a new file or restarting after an error.",
      })),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const { path, content, finalize, reset } = params;

      // Handle explicit reset — discard all pending chunks and start fresh
      if (reset) {
        if (!path) {
          // Reset everything
          pendingWrites.clear();
          return {
            content: [{ type: "text", text: "All pending writes cleared. Ready for a new file." }],
          };
        }
        // Reset only the specified path
        const wasCleared = pendingWrites.delete(path);
        return {
          content: [{
            type: "text",
            text: wasCleared
              ? `Pending chunks for ${path} cleared. Ready to start fresh.`
              : `No pending chunks found for ${path}. Ready to start fresh.`,
          }],
        };
      }

      // First call must provide path and content
      if (!path && !finalize) {
        const existing = pendingWrites.size > 0
          ? Array.from(pendingWrites.values())[0]
          : null;

        if (existing && !finalize) {
          // Continue existing write
          existing.chunks.push(content!);
          existing.totalBytes += Buffer.byteLength(content!, "utf8");
          existing.totalLines += content!.split("\n").length;

          pi.appendEntry(STATE_KEY, existing);

          onUpdate?.({
            content: [{
              type: "text",
              text: `Chunk accumulated (${existing.chunks.length} chunks, ${existing.totalBytes} bytes so far)`,
            }],
          });

          return {
            content: [{
              type: "text",
              text: `Accumulated chunk ${existing.chunks.length} (${Buffer.byteLength(content!, "utf8")} bytes). Total so far: ${existing.totalBytes} bytes. Set finalize=true when done.`,
            }],
          };
        }

        return {
          content: [{
            type: "text",
            text: "Error: path is required on the first call.",
          }],
          isError: true,
        };
      }

      const targetPath = path || (pendingWrites.size > 0 ? Array.from(pendingWrites.values())[0].path : null);
      if (!targetPath) {
        return {
          content: [{ type: "text", text: "Error: no path provided and no pending write." }],
          isError: true,
        };
      }

      // Auto-clear stale entries when starting a new file with a different path
      if (path && pendingWrites.size > 0) {
        const existingPath = Array.from(pendingWrites.keys())[0];
        if (existingPath !== targetPath) {
          console.log(`[large_write] Discarding ${pendingWrites.size} stale pending write(s) for new path: ${targetPath}`);
          pendingWrites.clear();
        }
      }

      const absPath = resolve(ctx.cwd, targetPath);

      if (finalize) {
        // Finalize: write accumulated content to disk
        const pending = pendingWrites.get(targetPath);
        const allContent = pending
          ? [...pending.chunks, content].join("\n")
          : content;

        const totalBytes = Buffer.byteLength(allContent, "utf8");
        const totalLines = allContent.split("\n").length;

        onUpdate?.({
          content: [{
            type: "text",
            text: `Writing ${totalBytes} bytes (${totalLines} lines) to ${targetPath}...`,
          }],
        });

        return withFileMutationQueue(absPath, async () => {
          if (signal?.aborted) throw new Error("Aborted");
          await mkdir(dirname(absPath), { recursive: true });
          if (signal?.aborted) throw new Error("Aborted");
          await writeFile(absPath, allContent, "utf8");

          // Clear pending state
          pendingWrites.delete(targetPath);

          return {
            content: [{
              type: "text",
              text: `Successfully wrote ${totalBytes} bytes (${totalLines} lines) to ${targetPath}.`,
            }],
            details: { path: targetPath, bytes: totalBytes, lines: totalLines },
          };
        });
      }

      // Accumulate chunk
      if (!pendingWrites.has(targetPath)) {
        pendingWrites.set(targetPath, {
          path: targetPath,
          chunks: [content],
          totalBytes: Buffer.byteLength(content, "utf8"),
          totalLines: content.split("\n").length,
        });
      } else {
        const p = pendingWrites.get(targetPath)!;
        p.chunks.push(content);
        p.totalBytes += Buffer.byteLength(content, "utf8");
        p.totalLines += content.split("\n").length;
      }

      const state = pendingWrites.get(targetPath)!;
      pi.appendEntry(STATE_KEY, state);

      return {
        content: [{
          type: "text",
          text: `Chunk ${state.chunks.length} accumulated for ${targetPath} (${state.totalBytes} bytes so far, ${state.totalLines} lines). Continue with more chunks or set finalize=true when done.`,
        }],
        details: {
          path: targetPath,
          chunks: state.chunks.length,
          bytesSoFar: state.totalBytes,
          linesSoFar: state.totalLines,
        },
      };
    },
  });

  // Intercept oversized regular write calls and warn
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "write") return;
    const content = event.input?.content;
    if (typeof content === "string" && Buffer.byteLength(content, "utf8") > LARGE_THRESHOLD) {
      console.log(`[large_write] Warning: write of ${Buffer.byteLength(content, "utf8")} bytes to ${event.input?.path} - consider using large_write instead`);
    }
  });
}
