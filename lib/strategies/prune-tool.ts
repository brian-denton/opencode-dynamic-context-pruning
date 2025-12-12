import { tool } from "@opencode-ai/plugin"
import type { SessionState, ToolParameterEntry } from "../state"
import type { PluginConfig } from "../config"
import { findCurrentAgent, buildToolIdList, getPruneToolIds } from "../utils"
import { PruneReason, sendUnifiedNotification } from "../ui/notification"
import { formatPruningResultForTool } from "../ui/display-utils"
import { ensureSessionInitialized } from "../state"
import { saveSessionState } from "../state/persistence"
import type { Logger } from "../logger"
import { estimateTokensBatch } from "../tokenizer"
import { loadPrompt } from "../prompt"

/** Tool description loaded from prompts/tool.txt */
const TOOL_DESCRIPTION = loadPrompt("tool")

export interface PruneToolContext {
    client: any
    state: SessionState
    logger: Logger
    config: PluginConfig
    workingDirectory: string
}

/**
 * Creates the prune tool definition.
 * Accepts numeric IDs from the <prunable-tools> list and prunes those tool outputs.
 */
export function createPruneTool(
    ctx: PruneToolContext,
): ReturnType<typeof tool> {
    return tool({
        description: TOOL_DESCRIPTION,
        args: {
            ids: tool.schema.array(
                tool.schema.union([
                    tool.schema.enum(["completion", "noise", "consolidation"]),
                    tool.schema.number()
                ])
            ).describe(
                "First element is the reason ('completion', 'noise', 'consolidation'), followed by numeric IDs to prune"
            ),
        },
        async execute(args, toolCtx) {
            const { client, state, logger, config, workingDirectory } = ctx
            const sessionId = toolCtx.sessionID

            if (!args.ids || args.ids.length === 0) {
                return "No IDs provided. Check the <prunable-tools> list for available IDs to prune."
            }

            // Parse reason from first element, numeric IDs from the rest

            const reason = args.ids[0];
            const validReasons = ["completion", "noise", "consolidation"] as const
            if (typeof reason !== "string" || !validReasons.includes(reason as any)) {
                return "No valid pruning reason found. Use 'completion', 'noise', or 'consolidation' as the first element."
            }

            const numericToolIds: number[] = args.ids.slice(1).filter((id): id is number => typeof id === "number")
            if (numericToolIds.length === 0) {
                return "No numeric IDs provided. Format: [reason, id1, id2, ...] where reason is 'completion', 'noise', or 'consolidation'."
            }

            await ensureSessionInitialized(state, sessionId, logger)

            // Fetch messages to calculate tokens and find current agent
            const messages = await client.session.messages({
                path: { id: sessionId }
            })

            const currentAgent: string | undefined = findCurrentAgent(messages)
            const toolIdList: string[] = buildToolIdList(messages)
            const pruneToolIds: string[] = getPruneToolIds(numericToolIds, toolIdList)
            const tokensSaved = await calculateTokensSavedFromMessages(messages, pruneToolIds)

            state.stats.pruneTokenCounter += tokensSaved
            state.prune.toolIds.push(...pruneToolIds)

            saveSessionState(state, logger)
                .catch(err => logger.error("prune-tool", "Failed to persist state", { error: err.message }))

            const toolMetadata = new Map<string, ToolParameterEntry>()
            for (const id of pruneToolIds) {
                const toolParameters = state.toolParameters.get(id)
                if (toolParameters) {
                    toolMetadata.set(id, toolParameters)
                } else {
                    logger.debug("prune-tool", "No metadata found for ID", { id })
                }
            }

            await sendUnifiedNotification(
                client,
                logger,
                config,
                state,
                sessionId,
                pruneToolIds,
                toolMetadata,
                reason as PruneReason,
                currentAgent,
                workingDirectory
            )

            return formatPruningResultForTool(
                pruneToolIds,
                toolMetadata,
                workingDirectory
            )
        },
    })
}

/**
 * Calculates approximate tokens saved by pruning the given tool call IDs.
 * Uses pre-fetched messages to avoid duplicate API calls.
 */
async function calculateTokensSavedFromMessages(
    messages: any[],
    prunedIds: string[]
): Promise<number> {
    try {
        const toolOutputs = new Map<string, string>()
        for (const msg of messages) {
            if (msg.role === 'tool' && msg.tool_call_id) {
                const content = typeof msg.content === 'string'
                    ? msg.content
                    : JSON.stringify(msg.content)
                toolOutputs.set(msg.tool_call_id.toLowerCase(), content)
            }
            if (msg.role === 'user' && Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part.type === 'tool_result' && part.tool_use_id) {
                        const content = typeof part.content === 'string'
                            ? part.content
                            : JSON.stringify(part.content)
                        toolOutputs.set(part.tool_use_id.toLowerCase(), content)
                    }
                }
            }
        }

        const contents: string[] = []
        for (const id of prunedIds) {
            const content = toolOutputs.get(id.toLowerCase())
            if (content) {
                contents.push(content)
            }
        }

        if (contents.length === 0) {
            return prunedIds.length * 500
        }

        const tokenCounts = await estimateTokensBatch(contents)
        return tokenCounts.reduce((sum, count) => sum + count, 0)
    } catch (error: any) {
        return prunedIds.length * 500
    }
}
