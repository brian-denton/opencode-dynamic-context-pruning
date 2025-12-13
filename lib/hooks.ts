import type { SessionState, WithParts } from "./state"
import type { Logger } from "./logger"
import type { PluginConfig } from "./config"
import { syncToolCache } from "./state/tool-cache"
import { deduplicate } from "./strategies"
import { prune, insertPruneToolContext } from "./messages"


export function createChatMessageTransformHandler(
    client: any,
    state: SessionState,
    logger: Logger,
    config: PluginConfig
) {
    return async(
        input: {},
        output: { messages: WithParts[] }
    ) => {
        syncToolCache(state, logger, output.messages);

        deduplicate(state, logger, config, output.messages)

        prune(state, logger, config, output.messages)

        insertPruneToolContext(state, config, logger, output.messages)
    }
}
