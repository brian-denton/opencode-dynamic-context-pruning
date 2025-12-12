import { Message, Part } from "@opencode-ai/sdk"

export interface WithParts {
    info: Message
    parts: Part[]
}

export type ToolStatus = "pending" | "running" | "completed" | "error"

export interface ToolParameterEntry {
    tool: string
    parameters: any
    status?: ToolStatus
    error?: string
}

export interface GCStats {
    tokensCollected: number
    toolsDeduped: number
}

export interface SessionStats {
    totalToolsPruned: number
    totalTokensSaved: number
    totalGCTokens: number
    totalGCTools: number
}

export interface Prune {
    toolIds: string[]
}

export interface SessionState {
    sessionId: string | null
    prune: Prune
    stats: SessionStats
    gcPending: GCStats
    toolParameters: Map<string, ToolParameterEntry>
}
