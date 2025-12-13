import type { SessionState, WithParts } from "../state"
import type { Logger } from "../logger"
import type { PluginConfig } from "../config"
import { buildToolIdList } from "../utils"
import { getLastUserMessage, extractParameterKey } from "./utils"

const PRUNED_TOOL_OUTPUT_REPLACEMENT = '[Output removed to save context - information superseded or no longer needed]'

const buildPrunableToolsList = (
    state: SessionState,
    config: PluginConfig,
    logger: Logger,
    messages: WithParts[],
): string => {
    const lines: string[] = []
    const toolIdList: string[] = buildToolIdList(messages)

    state.toolParameters.forEach((toolParameterEntry, toolCallId) => {
        if (state.prune.toolIds.includes(toolCallId)) {
            return
        }
        if (config.strategies.pruneTool.protectedTools.includes(toolParameterEntry.tool)) {
            return
        }
        const numericId = toolIdList.indexOf(toolCallId)
        const paramKey = extractParameterKey(toolParameterEntry.tool, toolParameterEntry.parameters)
        const description = paramKey ? `${toolParameterEntry.tool}, ${paramKey}` : toolParameterEntry.tool
        lines.push(`${numericId}: ${description}`)
    })

    return `<prunable-tools>\nThe following tools have been invoked and are available for pruning. This list does not mandate immediate action. Consider your current goals and the resources you need before discarding valuable tool outputs. Keep the context free of noise.\n${lines.join('\n')}\n</prunable-tools>`
}

export const insertPruneToolContext = (
    state: SessionState,
    config: PluginConfig,
    logger: Logger,
    messages: WithParts[]
): void => {
    const lastUserMessage = getLastUserMessage(messages)
    if (!lastUserMessage || lastUserMessage.info.role !== 'user') {
        return
    }

    const prunableToolsList = buildPrunableToolsList(state, config, logger, messages)

    const userMessage: WithParts = {
        info: {
            id: "msg_01234567890123456789012345",
            sessionID: lastUserMessage.info.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: lastUserMessage.info.agent || "build",
            model: {
                providerID: lastUserMessage.info.model.providerID,
                modelID: lastUserMessage.info.model.modelID
            }
        },
        parts: [
            {
                id: "prt_01234567890123456789012345",
                sessionID: lastUserMessage.info.sessionID,
                messageID: "msg_01234567890123456789012345",
                type: "text",
                text: prunableToolsList,
            }
        ]
    }

    messages.push(userMessage)
}

export const prune = (
    state: SessionState,
    logger: Logger,
    config: PluginConfig,
    messages: WithParts[]
): void => {
    pruneToolOutputs(state, logger, messages)
}

const pruneToolOutputs = (
    state: SessionState,
    logger: Logger,
    messages: WithParts[]
): void => {
    for (const msg of messages) {
        for (const part of msg.parts) {
            if (part.type !== 'tool') {
                continue
            }
            if (!state.prune.toolIds.includes(part.id)) {
                continue
            }
            if (part.state.status === 'completed') {
                part.state.output = PRUNED_TOOL_OUTPUT_REPLACEMENT
            }
            // if (part.state.status === 'error') {
            //     part.state.error = PRUNED_TOOL_OUTPUT_REPLACEMENT
            // }
        }
    }
}
