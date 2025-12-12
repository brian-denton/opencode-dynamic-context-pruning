import type { Plugin } from "@opencode-ai/plugin"
import { getConfig } from "./lib/config"
import { Logger } from "./lib/logger"
import { createSessionState } from "./lib/state"
import { createPruneTool } from "./lib/strategies/prune-tool"
import { createChatMessageTransformHandler } from "./lib/hooks"

const plugin: Plugin = (async (ctx) => {
    const config = getConfig(ctx)

    if (!config.enabled) {
        return {}
    }

    // Suppress AI SDK warnings
    if (typeof globalThis !== 'undefined') {
        (globalThis as any).AI_SDK_LOG_WARNINGS = false
    }

    // Initialize core components
    const logger = new Logger(config.debug)
    const state = createSessionState()

    // Log initialization
    logger.info("plugin", "DCP initialized", {
        strategies: config.strategies,
    })

    return {
        "experimental.chat.messages.transform": createChatMessageTransformHandler(
            ctx.client,
            state,
            logger,
            config
        ),
        tool: config.strategies.pruneTool.enabled ? {
            prune: createPruneTool({
                client: ctx.client,
                state,
                logger,
                config,
                workingDirectory: ctx.directory
            }),
        } : undefined,
    }
}) satisfies Plugin

export default plugin
