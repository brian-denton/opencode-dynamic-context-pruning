import { extractParameterKey } from '../ui/display-utils'
import { getOrCreateNumericId } from '../state/id-mapping'
import { loadPrompt } from '../core/prompt'
import type { ToolMetadata } from './types'

const NUDGE_INSTRUCTION = loadPrompt("nudge")

export interface PrunableListResult {
    list: string
    numericIds: number[]
}

export function buildPrunableToolsList(
    sessionId: string,
    unprunedToolCallIds: string[],
    toolMetadata: Map<string, ToolMetadata>,
    protectedTools: string[]
): PrunableListResult {
    const lines: string[] = []
    const numericIds: number[] = []

    for (const actualId of unprunedToolCallIds) {
        const metadata = toolMetadata.get(actualId)
        if (!metadata) continue
        if (protectedTools.includes(metadata.tool)) continue

        const numericId = getOrCreateNumericId(sessionId, actualId)
        numericIds.push(numericId)

        const paramKey = extractParameterKey(metadata)
        const description = paramKey ? `${metadata.tool}, ${paramKey}` : metadata.tool
        lines.push(`${numericId}: ${description}`)
    }

    if (lines.length === 0) {
        return { list: '', numericIds: [] }
    }

    return {
        list: `<prunable-tools>\nThe following tools have been invoked and are available for pruning. This list does not mandate immediate action. Consider your current goals and the resources you need before discarding valuable tool outputs. Keep the context free of noise.\n${lines.join('\n')}\n</prunable-tools>`,
        numericIds
    }
}

export function buildAssistantInjection(
    prunableList: string,
    includeNudge: boolean
): string {
    if (!prunableList) {
        return ''
    }

    const parts = [prunableList]

    if (includeNudge) {
        parts.push(NUDGE_INSTRUCTION)
    }

    return parts.join('\n\n')
}
