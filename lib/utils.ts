import { Logger } from "./logger"
import { WithParts } from "./state"

/**
 * Checks if a session is a subagent session by looking for a parentID.
 */
export async function isSubagentSession(client: any, sessionID: string): Promise<boolean> {
    try {
        const result = await client.session.get({ path: { id: sessionID } })
        return !!result.data?.parentID
    } catch (error: any) {
        return false
    }
}

/**
 * Finds the current agent from messages by scanning backward for user messages.
 */
export function findCurrentAgent(messages: any[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        const info = msg.info
        if (info?.role === 'user') {
            return info.agent || 'build'
        }
    }
    return undefined
}

/**
 * Builds a list of tool call IDs from messages.
 */
export function buildToolIdList(messages: WithParts[]): string[] {
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

/**
 * Prunes numeric tool IDs to valid tool call IDs based on the provided tool ID list.
 */
export function getPruneToolIds(numericToolIds: number[], toolIdList: string[]): string[] {
    const pruneToolIds: string[] = []
    for (const index of numericToolIds) {
        if (!isNaN(index) && index >= 0 && index < toolIdList.length) {
            pruneToolIds.push(toolIdList[index])
        }
    }
    return pruneToolIds
}
