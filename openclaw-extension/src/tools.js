import {
    createDistillation,
    createTransformedView,
    getPrunableInventory,
    pruneByIDs,
    resolveInventoryMessageIDs,
    sweep,
} from "./core.js"

/**
 * Adapter-level tool registration for OpenClaw-style runtimes.
 *
 * @param {Object} ctx
 * @param {import("./types.js").DcpState} ctx.state
 * @param {import("./types.js").ExtensionConfig} ctx.config
 */
export function createTools(ctx) {
    return {
        dcp_prune: async (input, runtime) => {
            const messages = extractMessages(runtime)
            getPrunableInventory(messages, ctx.state, ctx.config)
            const inventoryIDs = normalizeIDs(input?.ids)
            const reason =
                typeof input?.reason === "string" && input.reason.length > 0
                    ? input.reason
                    : "manual"

            if (inventoryIDs.length === 0) {
                const result = sweep(messages, ctx.state, ctx.config, undefined)
                return {
                    ok: true,
                    tool: "dcp_prune",
                    mode: "sweep",
                    ...result,
                    transformedView: summarizeView(messages, ctx.state, ctx.config),
                }
            }

            const resolved = resolveInventoryMessageIDs(ctx.state, inventoryIDs)
            const result = pruneByIDs(
                messages,
                ctx.state,
                ctx.config,
                resolved.resolvedMessageIDs,
                reason,
                undefined,
            )

            return {
                ok: true,
                tool: "dcp_prune",
                mode: "inventory",
                inventoryIDs,
                unresolvedInventoryIDs: resolved.missingIDs,
                ...result,
                transformedView: summarizeView(messages, ctx.state, ctx.config),
            }
        },

        dcp_distill: async (input, runtime) => {
            const messages = extractMessages(runtime)
            getPrunableInventory(messages, ctx.state, ctx.config)
            const targets = normalizeTargets(input?.targets)

            const distillations = []
            const prunedIDs = []
            const protectedIDs = []
            const missingIDs = []
            const unresolvedInventoryIDs = []

            for (const target of targets) {
                const resolved = resolveInventoryMessageIDs(ctx.state, [target.id])
                if (resolved.missingIDs.length > 0) {
                    unresolvedInventoryIDs.push(...resolved.missingIDs)
                    continue
                }

                const messageID = resolved.resolvedMessageIDs[0]
                const distillation = createDistillation(
                    messages,
                    ctx.state,
                    [messageID],
                    target.distillation,
                )
                distillations.push(distillation)

                const pruneResult = pruneByIDs(
                    messages,
                    ctx.state,
                    ctx.config,
                    [messageID],
                    "distilled",
                    distillation.id,
                )
                prunedIDs.push(...pruneResult.prunedIDs)
                protectedIDs.push(...pruneResult.protectedIDs)
                missingIDs.push(...pruneResult.missingIDs)
            }

            return {
                ok: true,
                tool: "dcp_distill",
                distillations,
                targetsApplied: targets.length,
                prunedIDs,
                protectedIDs,
                missingIDs,
                unresolvedInventoryIDs,
                transformedView: summarizeView(messages, ctx.state, ctx.config),
            }
        },
    }
}

/** @param {unknown} runtime */
function extractMessages(runtime) {
    if (runtime && typeof runtime === "object" && Array.isArray(runtime.messages)) {
        return runtime.messages
    }
    return []
}

/** @param {unknown} value */
function normalizeIDs(value) {
    if (!Array.isArray(value)) {
        return []
    }
    return value.filter((id) => typeof id === "string" && id.length > 0)
}

/** @param {unknown} value */
function normalizeTargets(value) {
    if (!Array.isArray(value)) {
        return []
    }

    const targets = []
    const seenIDs = new Set()
    for (const rawTarget of value) {
        if (!rawTarget || typeof rawTarget !== "object") {
            continue
        }
        const target = /** @type {Record<string, unknown>} */ (rawTarget)
        const id = typeof target.id === "string" && target.id.length > 0 ? target.id : ""
        const distillation =
            typeof target.distillation === "string" && target.distillation.trim().length > 0
                ? target.distillation.trim()
                : "Distilled context summary was not provided by the caller."
        if (!id) {
            continue
        }
        if (seenIDs.has(id)) {
            continue
        }
        seenIDs.add(id)
        targets.push({ id, distillation })
    }
    return targets
}

function summarizeView(messages, state, config) {
    const transformed = createTransformedView(messages, state)
    const inventory = getPrunableInventory(messages, state, config)
    return {
        totalMessages: transformed.length,
        prunedMessages: transformed.filter((message) => {
            return Boolean(
                message.meta && typeof message.meta === "object" && message.meta.dcp?.pruned,
            )
        }).length,
        prunableInventorySize: inventory.length,
    }
}
