import { createCommandHandler } from "./commands.js"
import { normalizeConfig } from "./config.js"
import { createTransformedView } from "./core.js"
import { createState } from "./state.js"
import { createTools } from "./tools.js"

const EXTENSION_ID = "openclaw-dcp-runner-extension"

const DCP_PRUNE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        ids: {
            type: "array",
            items: { type: "string" },
            description: "Inventory IDs to prune; when omitted, fallback is sweep mode.",
        },
        reason: {
            type: "string",
            description: "Optional reason label for manual prune records.",
        },
    },
}

const DCP_DISTILL_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        targets: {
            type: "array",
            description: "Inventory targets with per-item distillation text.",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    id: { type: "string" },
                    distillation: { type: "string" },
                },
                required: ["id"],
            },
        },
    },
}

const DCP_COMMAND_ARGS_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        args: {
            type: "string",
            description: "Arguments after /dcp, e.g. 'context' or 'sweep 3'.",
        },
    },
}

/**
 * Lean standalone OpenClaw extension factory.
 *
 * Adapter note: this exports a runtime-agnostic shape so it can be bridged
 * to OpenClaw SDK specifics without coupling to evolving SDK types.
 *
 * @param {unknown} rawConfig
 */
export function createOpenClawDcpExtension(rawConfig) {
    const config = normalizeConfig(rawConfig)
    const state = createState()

    if (!config.enabled) {
        return {
            id: EXTENSION_ID,
            enabled: false,
        }
    }

    const tools = createTools({ state, config })
    const runDcpCommand = createCommandHandler({ state, config })

    return {
        id: EXTENSION_ID,
        enabled: true,
        state,
        tools,
        commands: {
            dcp: runDcpCommand,
        },
        hooks: {
            chatMessagesTransform: (messages) => createTransformedView(messages, state),
        },
    }
}

/** @param {unknown} api */
export function register(api) {
    const host = api && typeof api === "object" ? /** @type {Record<string, unknown>} */ (api) : {}
    const extension = createOpenClawDcpExtension(readHostConfig(host))

    if (!extension.enabled) {
        return extension
    }

    const registerTool = typeof host.registerTool === "function" ? host.registerTool : undefined
    if (registerTool) {
        registerToolWithHost(registerTool, "dcp_prune", {
            description: "Prune context using inventory IDs or sweep mode.",
            parameters: DCP_PRUNE_SCHEMA,
            handler: extension.tools.dcp_prune,
        })

        registerToolWithHost(registerTool, "dcp_distill", {
            description: "Store distillations for inventory IDs and prune sources.",
            parameters: DCP_DISTILL_SCHEMA,
            handler: extension.tools.dcp_distill,
        })
    }

    const registerCommand =
        typeof host.registerCommand === "function" ? host.registerCommand : undefined
    if (registerCommand && extension.commands?.dcp) {
        registerCommandWithHost(registerCommand, "dcp", {
            description: "Dynamic context pruning command: context|stats|sweep [n].",
            parameters: DCP_COMMAND_ARGS_SCHEMA,
            handler: (input, runtime) => extension.commands.dcp(toCommandText(input), runtime),
        })
    }

    return extension
}

/**
 * OpenClaw plugin entrypoint.
 *
 * @param {unknown} api
 */
export default function openClawDcpPlugin(api) {
    return register(api)
}

/** @param {Record<string, unknown>} host */
function readHostConfig(host) {
    if (host.config && typeof host.config === "object") {
        return host.config
    }
    if (host.pluginConfig && typeof host.pluginConfig === "object") {
        return host.pluginConfig
    }
    return {}
}

/**
 * @param {Function} registerFn
 * @param {string} name
 * @param {RegistrationPayload} payload
 */
function registerToolWithHost(registerFn, name, payload) {
    const handler = createCompatHandler(payload.handler)
    const execute = createContentBlockHandler(payload.handler)
    const objectPayload = {
        name,
        description: payload.description,
        parameters: payload.parameters,
        inputSchema: payload.parameters,
        handler,
        execute,
    }

    try {
        registerFn(objectPayload)
        return
    } catch {
        // noop: host may prefer name + payload registration
    }

    try {
        registerFn(name, {
            description: payload.description,
            parameters: payload.parameters,
            inputSchema: payload.parameters,
            handler,
            execute,
        })
        return
    } catch {
        // noop: host may not support this registration surface
    }

    try {
        registerFn({
            name,
            description: payload.description,
            parameters: payload.parameters,
            handler,
        })
    } catch {
        // noop: host may not support this registration surface
    }
}

/**
 * @param {Function} registerFn
 * @param {string} name
 * @param {RegistrationPayload} payload
 */
function registerCommandWithHost(registerFn, name, payload) {
    const handler = createCompatHandler(payload.handler)
    const execute = createContentBlockHandler(payload.handler)
    const objectPayload = {
        name,
        description: payload.description,
        parameters: payload.parameters,
        argsSchema: payload.parameters,
        handler,
        execute,
    }

    try {
        registerFn(objectPayload)
        return
    } catch {
        // noop: host may prefer name + payload registration
    }

    try {
        registerFn(name, {
            description: payload.description,
            parameters: payload.parameters,
            argsSchema: payload.parameters,
            handler,
            execute,
        })
        return
    } catch {
        // noop: host may require slash-prefixed command names
    }

    const legacyName = `/${name}`

    try {
        registerFn(legacyName, {
            description: payload.description,
            parameters: payload.parameters,
            argsSchema: payload.parameters,
            handler,
            execute,
        })
        return
    } catch {
        // noop: host may prefer object-style registration
    }

    try {
        registerFn({
            ...objectPayload,
            name: legacyName,
        })
    } catch {
        // noop: host may not support this registration surface
    }
}

/**
 * @param {(input: unknown, runtime: unknown, id?: unknown) => unknown | Promise<unknown>} handler
 */
function createCompatHandler(handler) {
    return async (...args) => {
        const invocation = normalizeInvocation(args)
        return handler(invocation.input, invocation.runtime, invocation.id)
    }
}

/**
 * @param {(input: unknown, runtime: unknown, id?: unknown) => unknown | Promise<unknown>} handler
 */
function createContentBlockHandler(handler) {
    return async (...args) => {
        const invocation = normalizeInvocation(args)
        const result = await handler(invocation.input, invocation.runtime, invocation.id)
        return toContentBlockResult(result)
    }
}

/** @param {unknown[]} args */
function normalizeInvocation(args) {
    if (args.length >= 3) {
        return {
            id: args[0],
            input: args[1],
            runtime: args[2],
        }
    }

    if (args.length === 2) {
        if (isRuntimeLike(args[1])) {
            return {
                input: args[0],
                runtime: args[1],
            }
        }

        if (looksLikeInvocationID(args[0])) {
            return {
                id: args[0],
                input: args[1],
                runtime: undefined,
            }
        }

        return {
            input: args[0],
            runtime: args[1],
        }
    }

    return {
        input: args[0],
        runtime: undefined,
    }
}

/** @param {unknown} value */
function looksLikeInvocationID(value) {
    return typeof value === "string" || typeof value === "number"
}

/** @param {unknown} value */
function isRuntimeLike(value) {
    return Boolean(value && typeof value === "object" && Array.isArray(value.messages))
}

/** @param {unknown} result */
function toContentBlockResult(result) {
    if (isContentBlockResponse(result)) {
        return result
    }

    if (typeof result === "string") {
        return {
            content: [{ type: "text", text: result }],
        }
    }

    const text = safeSerialize(result)
    const response = {
        content: [{ type: "text", text }],
    }
    if (result && typeof result === "object") {
        response.structuredContent = result
    }
    return response
}

/** @param {unknown} result */
function isContentBlockResponse(result) {
    if (!result || typeof result !== "object") {
        return false
    }
    if (!Array.isArray(result.content)) {
        return false
    }

    return result.content.every((item) => {
        return item && typeof item === "object" && typeof item.type === "string"
    })
}

/** @param {unknown} value */
function safeSerialize(value) {
    try {
        return JSON.stringify(value ?? null, null, 2)
    } catch {
        return String(value)
    }
}

/**
 * @typedef {Object} RegistrationPayload
 * @property {string} description
 * @property {Record<string, unknown>} parameters
 * @property {(input: unknown, runtime: unknown, id?: unknown) => unknown | Promise<unknown>} handler
 */

/** @param {unknown} input */
function toCommandText(input) {
    if (typeof input === "string") {
        return input
    }
    if (!input || typeof input !== "object") {
        return "/dcp"
    }

    const value = /** @type {Record<string, unknown>} */ (input)
    if (typeof value.args === "string" && value.args.trim().length > 0) {
        return `/dcp ${value.args.trim()}`
    }

    if (Array.isArray(value.args)) {
        const args = value.args.filter((item) => typeof item === "string" && item.length > 0)
        if (args.length > 0) {
            return `/dcp ${args.join(" ")}`
        }
    }

    return "/dcp"
}
