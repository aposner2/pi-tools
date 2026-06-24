---
name: init
description: Initialize or update AGENTS.md. Guides the agent to autonomously analyze the codebase and generate a high-quality context file.
---

# Init Skill

This skill defines the standard for creating an `AGENTS.md` file. Instead of following a rigid script, use your judgment and exploration tools to understand the project deeply before documenting it.

## Objective
Create a "readme for robots" (`AGENTS.md`) that accelerates understanding for future AI sessions. It must include the project's stack, structure, workflows, and coding standards.

## Workflow

### 1. Autonomous Discovery
Explore the repository to build a mental model of the project. You determine which files to read.

*   **Identify Stack**: Determine the languages, frameworks, and build tools in use.
*   **Extract Workflows**: Find the commands for **installing dependencies**, **running tests**, **building**, and **starting** the project.
*   **Map Structure**: Understand the layout. Identify source roots, test directories, and documentation.
*   **Infer Conventions**: Read sample source files to identify coding styles, formatting rules (prettier/eslint/ruff), and architectural patterns (e.g., "functional components", "repository pattern").

### 2. Synthesize & Generate
Create or update `AGENTS.md` with your findings.

#### Target Structure (Template)
Use this structure as a baseline, but adapt it if the project has unique needs.

```markdown
# PROJECT KNOWLEDGE BASE

**Generated:** {CURRENT_DATE}

## OVERVIEW
Project: **{PROJECT_NAME}**
Stack: {TECHNOLOGIES_AND_VERSIONS}

## STRUCTURE
{TREE_VIEW_OR_KEY_DIRECTORIES_LIST}
*   `{DIR}`: {DESCRIPTION}

## COMMANDS
| Action | Command |
|--------|---------|
| Install| `{CMD}` |
| Test   | `{CMD}` |
| Build  | `{CMD}` |
| Run    | `{CMD}` |

## CODING STANDARDS
*   **Language**: {LANGUAGE_DETAILS}
*   **Style**: {OBSERVED_PATTERNS}
*   **Rules**: {LINTER_OR_FORMATTER_INFO}

## WHERE TO LOOK
*   **Source**: `{PATH}`
*   **Tests**: `{PATH}`
*   **Docs**: `{PATH}`

## NOTES
*   {CRITICAL_CONTEXT_OR_GOTCHAS}
```

### 3. Integration
*   **Update intelligently**: If `AGENTS.md` exists, read it first. Merge new insights without overwriting human-authored context.
*   **Context sharing**: If meaningful, mention other context files found (e.g., `.cursorrules`, `CLAUDE.md`).
