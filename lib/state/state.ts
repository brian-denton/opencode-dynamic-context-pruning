import type { SessionState, ToolParameterEntry } from "./types"
import type { Logger } from "../logger"
import { loadSessionState } from "./persistence"

export function createSessionState(): SessionState {
    return {
        sessionId: null,
        prune: {
            toolIds: []
        },
        stats: {
            pruneTokenCounter: 0,
            totalPruneTokens: 0,
        },
        toolParameters: new Map<string, ToolParameterEntry>()
    }
}

export function resetSessionState(state: SessionState): void {
    state.sessionId = null
    state.prune = {
        toolIds: []
    }
    state.stats = {
        pruneTokenCounter: 0,
        totalPruneTokens: 0,
    }
    state.toolParameters.clear()
}

export async function ensureSessionInitialized(
    state: SessionState,
    sessionId: string,
    logger: Logger
): Promise<void> {
    if (state.sessionId === sessionId) {
        return;
    }

    // Clear previous session data
    resetSessionState(state)
    state.sessionId = sessionId

    // Load session data from storage
    const persisted = await loadSessionState(sessionId, logger)
    if (persisted === null) {
        return;
    }

    // Populate state with loaded data
    state.prune = {
        toolIds: persisted.prune.toolIds || []
    }
    state.stats = {
        pruneTokenCounter: persisted.stats?.pruneTokenCounter || 0,
        totalPruneTokens: persisted.stats?.totalPruneTokens || 0,
    }
}
