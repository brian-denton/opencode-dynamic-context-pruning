import { createTransformedView, getPrunableInventory, sweep } from "./core.js"

/**
 * @param {Object} ctx
 * @param {import("./types.js").DcpState} ctx.state
 * @param {import("./types.js").ExtensionConfig} ctx.config
 */
export function createCommandHandler(ctx) {
    return async function dcpCommand(rawInput, runtime) {
        const text = typeof rawInput === "string" ? rawInput.trim() : ""
        const args = text
            .replace(/^\/dcp\s*/i, "")
            .trim()
            .split(/\s+/)
            .filter(Boolean)
        const subcommand = (args[0] || "").toLowerCase()
        const messages = extractMessages(runtime)

        if (!ctx.config.commands.enabled) {
            return "dcp commands are disabled by config"
        }

        if (!subcommand) {
            return "usage: /dcp context | /dcp stats | /dcp sweep [n]"
        }

        if (subcommand === "context") {
            return formatContext(messages, ctx.state, ctx.config)
        }

        if (subcommand === "stats") {
            return formatStats(ctx.state)
        }

        if (subcommand === "sweep") {
            const maybeLimit = Number.parseInt(args[1] || "", 10)
            const limit = Number.isFinite(maybeLimit) && maybeLimit > 0 ? maybeLimit : undefined
            const result = sweep(messages, ctx.state, ctx.config, limit)
            return [
                `sweep pruned=${result.prunedIDs.length}`,
                `protected=${result.protectedIDs.length}`,
                `candidates=${result.candidateCount}`,
                result.usedLimit ? `limit=${result.usedLimit}` : "limit=all",
            ].join(" ")
        }

        return "unknown /dcp subcommand; expected context, stats, or sweep [n]"
    }
}

/** @param {unknown} runtime */
function extractMessages(runtime) {
    if (runtime && typeof runtime === "object" && Array.isArray(runtime.messages)) {
        return runtime.messages
    }
    return []
}

function formatContext(messages, state, config) {
    const transformed = createTransformedView(messages, state)
    const inventory = getPrunableInventory(messages, state, config)
    const rawChars = totalChars(messages)
    const transformedChars = totalChars(transformed)
    const savedChars = rawChars - transformedChars
    const prunableChars = inventory.reduce((total, entry) => total + entry.chars, 0)
    const prunableTokens = inventory.reduce((total, entry) => total + entry.estimatedTokens, 0)

    const lines = [
        `context rawMessages=${messages.length} viewMessages=${transformed.length} rawChars=${rawChars} viewChars=${transformedChars} savedChars=${savedChars}`,
        `prunable count=${inventory.length} chars=${prunableChars} estTokens=${prunableTokens}`,
    ]

    for (const entry of inventory) {
        const toolName = entry.toolName || entry.role || "unknown"
        lines.push(
            `#${entry.id} ${toolName} chars=${entry.chars} estTokens=${entry.estimatedTokens}`,
        )
    }

    return lines.join("\n")
}

function formatStats(state) {
    return [
        `stats prunedMessages=${state.counters.prunedMessages}`,
        `prunedChars=${state.counters.prunedChars}`,
        `distillations=${state.counters.distillations}`,
        `sweeps=${state.counters.sweeps}`,
    ].join(" ")
}

function totalChars(messages) {
    let total = 0
    for (const message of messages) {
        if (typeof message.content === "string") {
            total += message.content.length
            continue
        }
        if (message.content != null) {
            total += JSON.stringify(message.content).length
        }
    }
    return total
}
