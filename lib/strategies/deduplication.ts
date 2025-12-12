import { PluginConfig } from "../config"
import { Logger } from "../logger"
import type { SessionState, WithParts } from "../state"

/**
 * Deduplication strategy - prunes older tool calls that have identical
 * tool name and parameters, keeping only the most recent occurrence.
 * Modifies the session state in place to add pruned tool call IDs.
 */
export const deduplicate = (
    state: SessionState,
    logger: Logger,
    config: PluginConfig,
    messages: WithParts[]
): void => {
    if (!config.strategies.deduplication.enabled) {
        return
    }

    // Build list of all tool call IDs from messages (chronological order)
    const allToolIds = buildToolIdList(messages)
    if (allToolIds.length === 0) {
        return
    }

    // Filter out IDs already pruned
    const alreadyPruned = new Set(state.prune.toolIds)
    const unprunedIds = allToolIds.filter(id => !alreadyPruned.has(id))

    if (unprunedIds.length === 0) {
        return
    }

    const protectedTools = config.strategies.deduplication.protectedTools

    // Group by signature (tool name + normalized parameters)
    const signatureMap = new Map<string, string[]>()

    for (const id of unprunedIds) {
        const metadata = state.toolParameters.get(id)
        if (!metadata) {
            logger.warn("deduplication", `Missing metadata for tool call ID: ${id}`)
            continue
        }

        // Skip protected tools
        if (protectedTools.includes(metadata.tool)) {
            continue
        }

        const signature = createToolSignature(metadata.tool, metadata.parameters)
        if (!signatureMap.has(signature)) {
            signatureMap.set(signature, [])
        }
        signatureMap.get(signature)!.push(id)
    }

    // Find duplicates - keep only the most recent (last) in each group
    const newPruneIds: string[] = []

    for (const [, ids] of signatureMap.entries()) {
        if (ids.length > 1) {
            // All except last (most recent) should be pruned
            const idsToRemove = ids.slice(0, -1)
            newPruneIds.push(...idsToRemove)
        }
    }

    if (newPruneIds.length > 0) {
        state.prune.toolIds.push(...newPruneIds)
        logger.debug("dedulication", `Marked ${newPruneIds.length} duplicate tool calls for pruning`)
    }
}

function buildToolIdList(messages: WithParts[]): string[] {
    const toolIds: string[] = []
    for (const msg of messages) {
        if (msg.parts) {
            for (const part of msg.parts) {
                if (part.type === 'tool' && part.callID && part.tool) {
                    toolIds.push(part.callID)
                }
            }
        }
    }
    return toolIds
}

function createToolSignature(tool: string, parameters?: any): string {
    if (!parameters) {
        return tool
    }
    const normalized = normalizeParameters(parameters)
    const sorted = sortObjectKeys(normalized)
    return `${tool}::${JSON.stringify(sorted)}`
}

function normalizeParameters(params: any): any {
    if (typeof params !== 'object' || params === null) return params
    if (Array.isArray(params)) return params

    const normalized: any = {}
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            normalized[key] = value
        }
    }
    return normalized
}

function sortObjectKeys(obj: any): any {
    if (typeof obj !== 'object' || obj === null) return obj
    if (Array.isArray(obj)) return obj.map(sortObjectKeys)

    const sorted: any = {}
    for (const key of Object.keys(obj).sort()) {
        sorted[key] = sortObjectKeys(obj[key])
    }
    return sorted
}
