---
name: research
description: >-
  Conduct thorough web research on any topic. Searches the web, fetches and
  analyzes multiple sources, cross-references findings, and produces a
  structured summary with citations. Use when the user asks to research,
  investigate, look up, find information about, or gather background on a
  topic.
---

# Research Skill

Conduct systematic web research using `mcp_searxng_search_web` and
`mcp_searxng_fetch_web`. Follow this workflow for every research task.

## Workflow

### Phase 1 — Define the scope

Before searching, clarify what you're looking for:

1. Identify the core question(s) from the user's request
2. Break complex topics into 2-4 sub-queries if needed
3. Note any constraints (date range, language, specific sources to avoid)

### Phase 2 — Initial search

Run broad searches first to map the landscape:

```
mcp_searxng_search_web(query="your query here", max_results=15)
```

- Use `max_results` between 10-20 for initial sweeps
- For niche topics, try multiple phrasings of the same question
- Note promising URLs and key claims from snippets

### Phase 3 — Deep dive

Fetch the most relevant pages (aim for 3-8 sources minimum):

```
mcp_searxng_fetch_web(url="https://example.com/article")
```

Prioritize:
1. Primary sources over secondary summaries
2. Recent content for time-sensitive topics
3. Diverse viewpoints when researching controversial subjects
4. Official documentation, academic papers, or authoritative sites

### Phase 4 — Cross-reference and verify

For each key claim you encounter:

1. Check if at least 2 independent sources agree
2. Note contradictions between sources explicitly
3. Flag information that appears in only one source as "unverified"
4. Prefer sources that cite their own references

### Phase 5 — Synthesize findings

Produce a structured report with this format:

```markdown
# Research Report: [Topic]

## Executive Summary
2-3 sentences capturing the main finding.

## Key Findings

### Finding 1: [Title]
Details and explanation...
**Sources:** [Source A](url), [Source B](url)

### Finding 2: [Title]
Details and explanation...
**Sources:** [Source C](url)

## Contradictions / Unresolved Questions
- Claim X appears in Source A but is contradicted by Source B.
- No reliable source found for Y.

## Sources Consulted
1. [Title](URL) — brief description of relevance
2. [Title](URL) — brief description of relevance

## Confidence Assessment
High / Medium / Low — and why (e.g., "Medium: most claims supported by 2+
sources but primary data is behind paywalls").
```

## Rules

- **NEVER fabricate sources or URLs.** Only cite pages you actually fetched.
- **ALWAYS include URLs** for every cited source.
- **Search in the user's language** unless they specify otherwise (use the `language` parameter).
- **Fetch before citing.** A snippet from search results is not enough — fetch the page to confirm details.
- **Limit fetches to relevant pages.** Don't waste time on pages that are clearly off-topic or low quality based on their snippet.
- **For news:** use `categories: "news"` in the search and note publication dates.
- **If a URL fails to fetch,** try an alternative source rather than skipping the topic entirely.

## Quick Research (abbreviated)

When the user asks for a quick answer or brief lookup, skip Phase 4 and keep
Phase 5 to just: Executive Summary + Key Findings (1-3 bullets each with
sources). Still fetch at least 2 pages before answering.
