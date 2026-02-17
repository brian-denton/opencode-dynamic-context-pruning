const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    protectedTools: [],
    protectedFilePatterns: [],
    commands: {
        enabled: true,
    },
})

/** @param {unknown} raw */
export function normalizeConfig(raw) {
    const value = raw && typeof raw === "object" ? raw : {}
    const v = /** @type {Record<string, unknown>} */ (value)

    const commandsRaw = v.commands && typeof v.commands === "object" ? v.commands : {}
    const commands = /** @type {Record<string, unknown>} */ (commandsRaw)

    return {
        enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_CONFIG.enabled,
        protectedTools: asStringArray(v.protectedTools),
        protectedFilePatterns: asStringArray(v.protectedFilePatterns),
        commands: {
            enabled:
                typeof commands.enabled === "boolean"
                    ? commands.enabled
                    : DEFAULT_CONFIG.commands.enabled,
        },
    }
}

function asStringArray(value) {
    if (!Array.isArray(value)) {
        return []
    }
    return value.filter((item) => typeof item === "string" && item.length > 0)
}
