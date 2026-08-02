/**
 * Pi TEI Reranker Extension
 *
 * Provides a `rerank` tool that uses Text Embeddings Inference (TEI) to
 * rerank documents by relevance to a query. Useful for improving retrieval
 * quality in RAG workflows before feeding results to the LLM.
 */

import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ─── Configuration ───────────────────────────────────────────────────────────

interface RerankerConfig {
  teiUrl: string;
  modelId: string;
  timeoutMs: number;
}

const DEFAULT_CONFIG: RerankerConfig = {
  teiUrl: process.env.TEI_RERANK_URL || "http://192.168.1.4:4321/rerank",
  modelId: process.env.TEI_RERANK_MODEL || "BAAI/bge-reranker-base",
  timeoutMs: 30_000,
};

async function loadConfig(): Promise<RerankerConfig> {
  return DEFAULT_CONFIG;
}

// ─── Rerank logic ────────────────────────────────────────────────────────────

interface RerankResult {
  index: number;
  score: number;
}

async function rerank(query: string, documents: string[]): Promise<RerankResult[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_CONFIG.timeoutMs);

  try {
    const response = await fetch(DEFAULT_CONFIG.teiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, texts: documents }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `TEI rerank failed with HTTP ${response.status}: ${text.slice(0, 500)}`
      );
    }

    const data: RerankResult[] = await response.json();
    // Sort by score descending for better UX (most relevant first)
    return [...data].sort((a, b) => b.score - a.score).map((r) => ({
      index: r.index,
      score: Math.round(r.score * 10_000) / 10_000,
    }));
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Extension registration ──────────────────────────────────────────────────

export default function teiReranker(pi: ExtensionAPI): void {
  let configPromise: Promise<RerankerConfig> | null = null;

  async function getConfig(): Promise<RerankerConfig> {
    if (!configPromise) configPromise = loadConfig();
    return configPromise;
  }

  pi.registerTool({
    name: "tei_rerank",
    label: "TEI Reranker",
    description: `Rerank documents by relevance to a query using TEI reranker model "${DEFAULT_CONFIG.modelId}". Returns results sorted by score descending. Best for improving retrieval quality before feeding context to the LLM.`,
    promptSnippet:
      'tei_rerank({ query: "search query", documents: ["doc1 text", "doc2 text"] })',
    parameters: Type.Object(
      {
        query: Type.String({ description: "The search query or intent to match against" }),
        documents: Type.Array(Type.String(), {
          description: "Array of document texts to rerank by relevance to the query",
        }),
      },
      { additionalProperties: false }
    ),

    async execute(toolCallId, params) {
      const cfg = await getConfig();

      if (!params.query || typeof params.query !== "string") {
        return {
          content: [{ type: "text", text: "Error: 'query' parameter is required and must be a string" }],
          details: { error: "invalid_query" },
        };
      }

      if (!Array.isArray(params.documents) || params.documents.length === 0) {
        return {
          content: [{ type: "text", text: "Error: 'documents' parameter is required and must be a non-empty array of strings" }],
          details: { error: "invalid_documents" },
        };
      }

      const maxDocs = 100;
      if (params.documents.length > maxDocs) {
        return {
          content: [{ type: "text", text: `Error: Too many documents. Maximum is ${maxDocs}` }],
          details: { error: "too_many_documents" },
        };
      }

      try {
        const results = await rerank(params.query, params.documents);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query: params.query,
                  model: cfg.modelId,
                  count: results.length,
                  results: results.map((r) => ({
                    index: r.index,
                    score: r.score,
                    text: params.documents[r.index],
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error during reranking: ${message}` }],
          details: { error: "rerank_failed" },
        };
      }
    },
  });
}
