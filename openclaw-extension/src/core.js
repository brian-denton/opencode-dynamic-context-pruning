import { normalizeConfig } from "./config.js"

const DEFAULT_PROTECTED_TOOLS = new Set(["dcp_prune", "dcp_distill"])

/**
 * @param {import("./types.js").DcpMessage[]} messages
 * @param {import("./types.js").DcpState} state
 */
export function createTransformedView(messages, state) {
    return messages.map((message) => {
        const messageID = message?.id
        if (typeof messageID !== "string") {
            return cloneMessage(message)
        }

        const prunedRecord = state.prunedByID.get(messageID)
        state.idMap.set(messageID, {
            originalID: messageID,
            transformedID: messageID,
            pruned: Boolean(prunedRecord),
        })

        if (!prunedRecord) {
            return cloneMessage(message)
        }

        const distillationText = prunedRecord.distillationID
            ? ` distilled=${prunedRecord.distillationID}`
            : ""

        return {
            ...cloneMessage(message),
            content: `[dcp-pruned id=${messageID} reason=${prunedRecord.reason}${distillationText}]`,
            meta: {
                ...(message.meta || {}),
                dcp: {
                    pruned: true,
                    originalID: messageID,
                    reason: prunedRecord.reason,
                    distillationID: prunedRecord.distillationID,
                },
            },
        }
    })
}

/**
 * @param {import("./types.js").DcpMessage[]} messages
 * @param {import("./types.js").DcpState} state
 * @param {unknown} rawConfig
 * @param {string[]} messageIDs
 * @param {string} reason
 * @param {string | undefined} distillationID
 */
export function pruneByIDs(messages, state, rawConfig, messageIDs, reason, distillationID) {
    const config = normalizeConfig(rawConfig)
    const messagesByID = new Map(messages.map((message) => [message.id, message]))

    const prunedIDs = []
    const protectedIDs = []
    const missingIDs = []

    for (const messageID of messageIDs) {
        const message = messagesByID.get(messageID)
        if (!message) {
            missingIDs.push(messageID)
            continue
        }
        if (state.prunedByID.has(messageID)) {
            continue
        }
        if (isProtectedMessage(message, config)) {
            protectedIDs.push(messageID)
            continue
        }

        const chars = estimateChars(message.content)
        state.prunedByID.set(messageID, {
            reason,
            toolName: message.toolName,
            chars,
            at: Date.now(),
            distillationID,
        })

        prunedIDs.push(messageID)
        state.counters.prunedMessages += 1
        state.counters.prunedChars += chars
    }

    return {
        prunedIDs,
        protectedIDs,
        missingIDs,
    }
}

/**
 * @param {import("./types.js").DcpMessage[]} messages
 * @param {import("./types.js").DcpState} state
 * @param {unknown} rawConfig
 * @param {number | undefined} limit
 */
export function sweep(messages, state, rawConfig, limit) {
    const config = normalizeConfig(rawConfig)
    const candidates = collectSweepCandidates(messages, state, config)

    const capped =
        typeof limit === "number" && Number.isFinite(limit) && limit > 0
            ? candidates.slice(-limit)
            : candidates

    const result = pruneByIDs(messages, state, config, capped, "sweep", undefined)
    if (result.prunedIDs.length > 0) {
        state.counters.sweeps += 1
    }

    return {
        ...result,
        candidateCount: candidates.length,
        usedLimit: typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? limit : null,
    }
}

/**
 * @param {import("./types.js").DcpMessage[]} messages
 * @param {import("./types.js").DcpState} state
 * @param {unknown} rawConfig
 */
export function collectSweepCandidates(messages, state, rawConfig) {
    const config = normalizeConfig(rawConfig)
    const startIndex = lastUserIndex(messages)
    const candidates = []

    for (let index = startIndex + 1; index < messages.length; index += 1) {
        const message = messages[index]
        if (!isToolLikeMessage(message)) {
            continue
        }
        if (state.prunedByID.has(message.id)) {
            continue
        }
        if (isProtectedMessage(message, config)) {
            continue
        }
        candidates.push(message.id)
    }

    return candidates
}

/**
 * @param {import("./types.js").DcpMessage[]} messages
 * @param {import("./types.js").DcpState} state
 * @param {unknown} rawConfig
 */
export function getPrunableInventory(messages, state, rawConfig) {
    const config = normalizeConfig(rawConfig)
    const entries = []

    for (const message of messages) {
        if (!isToolLikeMessage(message)) {
            continue
        }
        if (state.prunedByID.has(message.id)) {
            continue
        }
        if (isProtectedMessage(message, config)) {
            continue
        }

        const chars = estimateChars(message.content)
        entries.push({
            messageID: message.id,
            role: typeof message.role === "string" ? message.role : "",
            toolName: typeof message.toolName === "string" ? message.toolName : "",
            chars,
            estimatedTokens: estimateTokens(chars),
        })
    }

    const signature = entries.map((entry) => `${entry.messageID}:${entry.chars}`).join("|")
    if (
        state.inventory.signature === signature &&
        state.inventory.entries.length === entries.length
    ) {
        return state.inventory.entries
    }

    const numericToMessageID = new Map()
    const messageToNumericID = new Map()
    const inventoryEntries = entries.map((entry, index) => {
        const id = String(index + 1)
        numericToMessageID.set(id, entry.messageID)
        messageToNumericID.set(entry.messageID, id)
        return {
            id,
            messageID: entry.messageID,
            role: entry.role,
            toolName: entry.toolName,
            chars: entry.chars,
            estimatedTokens: entry.estimatedTokens,
        }
    })

    state.inventory.signature = signature
    state.inventory.entries = inventoryEntries
    state.inventory.numericToMessageID = numericToMessageID
    state.inventory.messageToNumericID = messageToNumericID

    return inventoryEntries
}

/**
 * @param {import("./types.js").DcpState} state
 * @param {string[]} ids
 */
export function resolveInventoryMessageIDs(state, ids) {
    const resolvedMessageIDs = []
    const missingIDs = []

    for (const id of ids) {
        const messageID = state.inventory.numericToMessageID.get(id)
        if (!messageID) {
            missingIDs.push(id)
            continue
        }
        resolvedMessageIDs.push(messageID)
    }

    return {
        resolvedMessageIDs,
        missingIDs,
    }
}

/**
 * @param {import("./types.js").DcpMessage[]} messages
 * @param {import("./types.js").DcpState} state
 * @param {string[]} messageIDs
 * @param {string} summary
 */
export function createDistillation(messages, state, messageIDs, summary) {
    const id = `dcp-distill-${state.counters.distillations + 1}`
    const record = {
        id,
        sourceMessageIDs: [...messageIDs],
        summary,
        at: Date.now(),
    }

    state.distillations.push(record)
    state.counters.distillations += 1

    for (const sourceID of messageIDs) {
        state.distillationBySourceID.set(sourceID, id)
    }

    return record
}

/** @param {import("./types.js").DcpMessage} message */
function isToolLikeMessage(message) {
    return message.role === "tool" || typeof message.toolName === "string"
}

/**
 * @param {import("./types.js").DcpMessage} message
 * @param {import("./types.js").ExtensionConfig} config
 */
export function isProtectedMessage(message, config) {
    const toolName = typeof message.toolName === "string" ? message.toolName.toLowerCase() : ""

    if (DEFAULT_PROTECTED_TOOLS.has(toolName)) {
        return true
    }

    const protectedTools = new Set(config.protectedTools.map((name) => name.toLowerCase()))
    if (toolName && protectedTools.has(toolName)) {
        return true
    }

    const filePath = inferFilePath(message)
    if (!filePath) {
        return false
    }
    return config.protectedFilePatterns.some((pattern) => globMatch(filePath, pattern))
}

/** @param {import("./types.js").DcpMessage[]} messages */
function lastUserIndex(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === "user") {
            return index
        }
    }
    return -1
}

/** @param {import("./types.js").DcpMessage} message */
function inferFilePath(message) {
    if (typeof message.filePath === "string") {
        return message.filePath
    }
    const input = message.input
    if (input && typeof input === "object") {
        const inObj = /** @type {Record<string, unknown>} */ (input)
        if (typeof inObj.filePath === "string") {
            return inObj.filePath
        }
        if (typeof inObj.path === "string") {
            return inObj.path
        }
    }
    return ""
}

/** @param {unknown} value */
function estimateChars(value) {
    if (typeof value === "string") {
        return value.length
    }
    if (value == null) {
        return 0
    }
    try {
        return JSON.stringify(value).length
    } catch {
        return 0
    }
}

/** @param {number} chars */
function estimateTokens(chars) {
    if (!Number.isFinite(chars) || chars <= 0) {
        return 0
    }
    return Math.ceil(chars / 4)
}

/** @param {import("./types.js").DcpMessage} message */
function cloneMessage(message) {
    return {
        ...message,
        meta: message.meta ? { ...message.meta } : undefined,
        input: message.input ? { ...message.input } : undefined,
    }
}

/**
 * @param {string} value
 * @param {string} pattern
 */
function globMatch(value, pattern) {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "::DOUBLE_STAR::")
        .replace(/\*/g, "[^/]*")
        .replace(/::DOUBLE_STAR::/g, ".*")
    const regex = new RegExp(`^${escaped}$`)
    return regex.test(value)
}
