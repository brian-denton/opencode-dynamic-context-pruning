import type { FetchHandlerContext, FetchHandlerResult, FormatDescriptor } from "./types"
import {
    PRUNED_CONTENT_MESSAGE,
    getAllPrunedIds,
    fetchSessionMessages
} from "./types"
import { buildPrunableToolsList, buildEndInjection } from "../api-formats/prunable-list"

/**
 * Generic format handler that processes any API format using a FormatDescriptor.
 * 
 * This consolidates the common logic from all format-specific handlers:
 * 1. Cache tool parameters
 * 2. Inject synthetic instructions (if strategies enabled)
 * 3. Build and inject prunable tools list
 * 4. Replace pruned tool outputs
 * 5. Log and save context
 */
export async function handleFormat(
    body: any,
    ctx: FetchHandlerContext,
    inputUrl: string,
    format: FormatDescriptor
): Promise<FetchHandlerResult> {
    const data = format.getDataArray(body)
    if (!data) {
        return { modified: false, body }
    }

    let modified = false

    // Cache tool parameters for this format
    format.cacheToolParameters(data, ctx.state, ctx.logger)

    // Inject synthetic instructions if strategies are enabled
    if (ctx.config.strategies.onTool.length > 0) {
        if (format.injectSynth(data, ctx.prompts.synthInstruction, ctx.prompts.nudgeInstruction)) {
            modified = true
        }

        const sessionId = ctx.state.lastSeenSessionId
        if (sessionId) {
            const toolIds = Array.from(ctx.state.toolParameters.keys())
            const alreadyPruned = ctx.state.prunedIds.get(sessionId) ?? []
            const alreadyPrunedLower = new Set(alreadyPruned.map(id => id.toLowerCase()))
            const unprunedIds = toolIds.filter(id => !alreadyPrunedLower.has(id.toLowerCase()))

            const { list: prunableList, numericIds } = buildPrunableToolsList(
                sessionId,
                unprunedIds,
                ctx.state.toolParameters,
                ctx.config.protectedTools
            )

            if (prunableList) {
                const protectedSet = new Set(ctx.config.protectedTools)
                format.trackNewToolResults(data, ctx.toolTracker, protectedSet)
                const includeNudge = ctx.config.nudge_freq > 0 && ctx.toolTracker.toolResultCount > ctx.config.nudge_freq

                const endInjection = buildEndInjection(prunableList, includeNudge)
                if (format.injectPrunableList(data, endInjection)) {
                    ctx.logger.debug("fetch", `Injected prunable tools list (${format.name})`, {
                        ids: numericIds,
                        nudge: includeNudge,
                        toolsSincePrune: ctx.toolTracker.toolResultCount
                    })
                    modified = true
                }
            }
        }
    }

    // Check if there are any tool outputs to potentially prune
    if (!format.hasToolOutputs(data)) {
        return { modified, body }
    }

    // Get all pruned IDs across sessions
    const { allSessions, allPrunedIds } = await getAllPrunedIds(ctx.client, ctx.state, ctx.logger)

    if (allPrunedIds.size === 0) {
        return { modified, body }
    }

    // Extract tool outputs and replace pruned ones
    const toolOutputs = format.extractToolOutputs(data, ctx.state)
    const protectedToolsLower = new Set(ctx.config.protectedTools.map(t => t.toLowerCase()))
    let replacedCount = 0

    for (const output of toolOutputs) {
        // Skip protected tools
        if (output.toolName && protectedToolsLower.has(output.toolName.toLowerCase())) {
            continue
        }

        if (allPrunedIds.has(output.id)) {
            if (format.replaceToolOutput(data, output.id, PRUNED_CONTENT_MESSAGE, ctx.state)) {
                replacedCount++
            }
        }
    }

    if (replacedCount > 0) {
        ctx.logger.info("fetch", `Replaced pruned tool outputs (${format.name})`, {
            replaced: replacedCount,
            total: toolOutputs.length
        })

        // Save context for debugging if logging is enabled
        if (ctx.logger.enabled) {
            const activeSessions = allSessions.data?.filter((s: any) => !s.parentID) || []
            let sessionMessages: any[] | undefined
            if (activeSessions.length > 0) {
                const mostRecentSession = activeSessions[0]
                sessionMessages = await fetchSessionMessages(ctx.client, mostRecentSession.id)
            }

            await ctx.logger.saveWrappedContext(
                "global",
                data,
                format.getLogMetadata(data, replacedCount, inputUrl),
                sessionMessages
            )
        }

        return { modified: true, body }
    }

    return { modified, body }
}
