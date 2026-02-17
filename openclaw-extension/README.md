# Lean OpenClaw DCP Extension

Standalone OpenClaw runner extension that adds lean dynamic context pruning primitives without changing this repository's existing OpenCode plugin behavior.

## What It Adds

- Tools: `dcp_prune`, `dcp_distill`
- Slash command: `/dcp` with subcommands:
    - `/dcp context`
    - `/dcp stats`
    - `/dcp sweep [n]`
- Non-destructive pruning semantics:
    - tracks pruned message IDs in in-memory state
    - tracks a per-view prunable inventory with stable numeric IDs (`"1"`, `"2"`, ...)
    - returns transformed-view placeholders/summaries
    - does not rewrite persisted conversation history files

## Package Layout

- `openclaw.plugin.json` - extension manifest with required `id` and inline `configSchema`
- `src/index.js` - plugin entrypoint (`default(api)`), host registration, and factory helpers
- `src/core.js` - prune inventory, protection checks, sweep logic, transformed view generation
- `src/tools.js` - `dcp_prune` and `dcp_distill`
- `src/commands.js` - `/dcp` command router (`context`, `stats`, `sweep [n]`)
- `tests/*.test.js` - minimal behavior coverage

## Install and Enable

This package now exports a real OpenClaw plugin entrypoint (`default export (api) => {}`) that self-registers tools and commands when the host exposes registration APIs.

Command registration expects the logical command name `dcp` (no leading slash). User-facing chat usage is still `/dcp ...`.

### 1) Install from local path

From repository root:

```bash
openclaw plugins install ./openclaw-extension
```

### 2) Install from npm (published package form)

If the package is published to npm:

```bash
openclaw plugins install openclaw-dcp-extension
```

### 3) Enable and configure

Set plugin config under `plugins.entries.<id>.config` using this plugin ID:

- `openclaw-dcp-extension`

Example config shape:

```json
{
    "plugins": {
        "entries": {
            "openclaw-dcp-extension": {
                "enabled": true,
                "config": {
                    "enabled": true,
                    "protectedTools": [],
                    "protectedFilePatterns": [],
                    "commands": {
                        "enabled": true
                    }
                }
            }
        }
    }
}
```

### 4) Restart gateway

After install or config changes, restart your OpenClaw gateway/runtime so plugin registration is reloaded.

### 5) Verify plugin registration

```bash
openclaw plugins list
openclaw plugins info openclaw-dcp-extension
```

In a chat/session, run:

```text
/dcp context
```

Note: plugin adapters may register `dcp` internally while the runtime still parses slash-invocation text from users.

You should see inventory lines like `#1 ...`, `#2 ...` when prunable tool messages are present.

## Config (Lean)

Supported config keys only:

```json
{
    "enabled": true,
    "protectedTools": [],
    "protectedFilePatterns": [],
    "commands": {
        "enabled": true
    }
}
```

## Coexistence Guidance

This extension can coexist with OpenClaw built-in context features, but avoid overlapping automation to reduce duplicate pruning decisions.

- If OpenClaw built-in `agent.contextPruning` is enabled, prefer using this extension in a more manual mode (`/dcp sweep`, targeted `dcp_prune`, `dcp_distill`) instead of aggressive automatic policies in both places.
- If users rely on built-in `/compact`, treat it as a separate summarization path. This extension does not intercept or alter `/compact`; it only manages its own `dcp_*` tools and `/dcp` command.
- Recommended practice: pick one primary auto-pruning authority per session (either built-in pruning or this extension), and use the other only for explicit/manual operations.

## ID-First Workflow

1. Run `/dcp context` to inspect prunable entries.
2. Pick inventory IDs from the numbered list.
3. Call `dcp_prune` or `dcp_distill` with those IDs.

Example context output (shape):

```text
context rawMessages=42 viewMessages=42 rawChars=30210 viewChars=30210 savedChars=0
prunable count=3 chars=9800 estTokens=2450
#1 bash chars=4200 estTokens=1050
#2 read chars=3100 estTokens=775
#3 grep chars=2500 estTokens=625
```

Example `dcp_prune` input:

```json
{
    "ids": ["1", "3"],
    "reason": "manual"
}
```

If `ids` is omitted or empty, `dcp_prune` performs sweep behavior.

Example `dcp_distill` input:

```json
{
    "targets": [
        {
            "id": "1",
            "distillation": "Build succeeded except for one snapshot mismatch in auth tests."
        },
        {
            "id": "3",
            "distillation": "Search confirms all remaining TODOs are in docs only."
        }
    ]
}
```

Each target distillation is stored and the matching inventory entry is pruned non-destructively.

## Test

From repository root:

```bash
npm --prefix openclaw-extension test
```
