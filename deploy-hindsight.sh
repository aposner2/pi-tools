#!/usr/bin/env bash
# DEPRECATED SHIM — the one-command onboarding now lives in setup.sh
# (unified-memory Phase 3). Kept so older docs/commands keep working.
exec bash "$(cd "$(dirname "$0")" && pwd)/setup.sh" "$@"
