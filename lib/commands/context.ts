/**
 * DCP Context command handler.
 * Shows a visual breakdown of token usage in the current session.
 */

import type { Logger } from "../logger"
import type { SessionState, WithParts } from "../state"
import { sendIgnoredMessage } from "../ui/notification"
import { formatTokenCount } from "../ui/utils"
import { isMessageCompacted } from "../shared-utils"
import { isIgnoredUserMessage } from "../messages/utils"
import { countTokens, getCurrentParams } from "../strategies/utils"
import type { AssistantMessage, TextPart, ToolPart } from "@opencode-ai/sdk/v2"

export interface ContextCommandContext {
    client: any
    state: SessionState
    logger: Logger
    sessionId: string
    messages: WithParts[]
}

interface TokenBreakdown {
    system: number
    user: number
    assistant: number
    reasoning: number
    tools: number
    pruned: number
    total: number
}

function analyzeTokens(state: SessionState, messages: WithParts[]): TokenBreakdown {
    const breakdown: TokenBreakdown = {
        system: 0,
        user: 0,
        assistant: 0,
        reasoning: 0,
        tools: 0,
        pruned: state.stats.totalPruneTokens,
        total: 0,
    }

    let firstAssistant: AssistantMessage | undefined
    for (const msg of messages) {
        if (msg.info.role === "assistant") {
            const assistantInfo = msg.info as AssistantMessage
            if (assistantInfo.tokens?.input > 0 || assistantInfo.tokens?.cache?.read > 0) {
                firstAssistant = assistantInfo
                break
            }
        }
    }

    let firstUserTokens = 0
    for (const msg of messages) {
        if (msg.info.role === "user" && !isIgnoredUserMessage(msg)) {
            for (const part of msg.parts) {
                if (part.type === "text") {
                    const textPart = part as TextPart
                    firstUserTokens += countTokens(textPart.text || "")
                }
            }
            break
        }
    }

    // Calculate system tokens: first response's total input minus first user message
    if (firstAssistant) {
        const firstInput =
            (firstAssistant.tokens?.input || 0) + (firstAssistant.tokens?.cache?.read || 0)
        breakdown.system = Math.max(0, firstInput - firstUserTokens)
    }

    let lastAssistant: AssistantMessage | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg.info.role === "assistant") {
            const assistantInfo = msg.info as AssistantMessage
            if (assistantInfo.tokens?.output > 0) {
                lastAssistant = assistantInfo
                break
            }
        }
    }

    // Get total from API
    // Total = input + output + reasoning + cache.read + cache.write
    const apiInput = lastAssistant?.tokens?.input || 0
    const apiOutput = lastAssistant?.tokens?.output || 0
    const apiReasoning = lastAssistant?.tokens?.reasoning || 0
    const apiCacheRead = lastAssistant?.tokens?.cache?.read || 0
    const apiCacheWrite = lastAssistant?.tokens?.cache?.write || 0
    const apiTotal = apiInput + apiOutput + apiReasoning + apiCacheRead + apiCacheWrite

    for (const msg of messages) {
        if (isMessageCompacted(state, msg)) {
            continue
        }

        if (msg.info.role === "user" && isIgnoredUserMessage(msg)) {
            continue
        }

        const info = msg.info
        const role = info.role

        for (const part of msg.parts) {
            switch (part.type) {
                case "text": {
                    const textPart = part as TextPart
                    const tokens = countTokens(textPart.text || "")
                    if (role === "user") {
                        breakdown.user += tokens
                    } else {
                        breakdown.assistant += tokens
                    }
                    break
                }
                case "tool": {
                    const toolPart = part as ToolPart

                    if (toolPart.state?.input) {
                        const inputStr =
                            typeof toolPart.state.input === "string"
                                ? toolPart.state.input
                                : JSON.stringify(toolPart.state.input)
                        breakdown.tools += countTokens(inputStr)
                    }

                    if (toolPart.state?.status === "completed" && toolPart.state?.output) {
                        const outputStr =
                            typeof toolPart.state.output === "string"
                                ? toolPart.state.output
                                : JSON.stringify(toolPart.state.output)
                        breakdown.tools += countTokens(outputStr)
                    }
                    break
                }
            }
        }
    }

    breakdown.tools = Math.max(0, breakdown.tools - breakdown.pruned)

    // Calculate reasoning as the difference between API total and our counted parts
    // This handles both interleaved thinking and non-interleaved models correctly
    const countedParts = breakdown.system + breakdown.user + breakdown.assistant + breakdown.tools
    breakdown.reasoning = Math.max(0, apiTotal - countedParts)

    breakdown.total = apiTotal

    return breakdown
}

function createBar(value: number, maxValue: number, width: number, char: string = "█"): string {
    if (maxValue === 0) return ""
    const filled = Math.round((value / maxValue) * width)
    const bar = char.repeat(Math.max(0, filled))
    return bar
}

function formatContextMessage(breakdown: TokenBreakdown): string {
    const lines: string[] = []
    const barWidth = 30

    const values = [
        breakdown.system,
        breakdown.user,
        breakdown.assistant,
        breakdown.reasoning,
        breakdown.tools,
    ]
    const maxValue = Math.max(...values)

    const categories = [
        { label: "System", value: breakdown.system, char: "█" },
        { label: "User", value: breakdown.user, char: "▓" },
        { label: "Assistant", value: breakdown.assistant, char: "▒" },
        { label: "Reasoning", value: breakdown.reasoning, char: "░" },
        { label: "Tools", value: breakdown.tools, char: "⣿" },
    ] as const

    lines.push("╭───────────────────────────────────────────────────────────╮")
    lines.push("│                  DCP Context Analysis                     │")
    lines.push("╰───────────────────────────────────────────────────────────╯")
    lines.push("")
    lines.push("Session Context Breakdown:")
    lines.push("─".repeat(60))
    lines.push("")

    for (const cat of categories) {
        const bar = createBar(cat.value, maxValue, barWidth, cat.char)
        const percentage =
            breakdown.total > 0 ? ((cat.value / breakdown.total) * 100).toFixed(1) : "0.0"
        const labelWithPct = `${cat.label.padEnd(9)} ${percentage.padStart(5)}% `
        const valueStr = formatTokenCount(cat.value).padStart(13)
        lines.push(`${labelWithPct}│${bar.padEnd(barWidth)}│${valueStr}`)
    }

    lines.push("")
    lines.push("─".repeat(60))
    lines.push("")

    lines.push("Summary:")

    if (breakdown.pruned > 0) {
        const withoutPruning = breakdown.total + breakdown.pruned
        const savingsPercent = ((breakdown.pruned / withoutPruning) * 100).toFixed(1)
        lines.push(
            `  Current context: ~${formatTokenCount(breakdown.total)} (${savingsPercent}% saved)`,
        )
        lines.push(`  Without DCP:     ~${formatTokenCount(withoutPruning)}`)
    } else {
        lines.push(`  Current context: ~${formatTokenCount(breakdown.total)}`)
    }

    lines.push("")

    return lines.join("\n")
}

export async function handleContextCommand(ctx: ContextCommandContext): Promise<void> {
    const { client, state, logger, sessionId, messages } = ctx

    const breakdown = analyzeTokens(state, messages)

    const message = formatContextMessage(breakdown)

    const params = getCurrentParams(state, messages, logger)
    await sendIgnoredMessage(client, sessionId, message, params, logger)
}
