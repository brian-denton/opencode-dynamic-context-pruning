import type { FormatDescriptor, ToolOutput } from "../types"
import { PRUNED_CONTENT_MESSAGE } from "../types"
import type { PluginState } from "../../state"
import type { Logger } from "../../logger"
import type { ToolTracker } from "../../api-formats/synth-instruction"
import { cacheToolParametersFromMessages } from "../../state/tool-cache"
import { injectSynth, trackNewToolResults } from "../../api-formats/synth-instruction"
import { injectPrunableList } from "../../api-formats/prunable-list"

/**
 * Format descriptor for OpenAI Chat Completions and Anthropic APIs.
 * 
 * OpenAI Chat format:
 * - Messages with role='tool' and tool_call_id
 * - Assistant messages with tool_calls[] array
 * 
 * Anthropic format:
 * - Messages with role='user' containing content[].type='tool_result' and tool_use_id
 * - Assistant messages with content[].type='tool_use'
 */
export const openaiChatFormat: FormatDescriptor = {
    name: 'openai-chat',

    detect(body: any): boolean {
        return body.messages && Array.isArray(body.messages)
    },

    getDataArray(body: any): any[] | undefined {
        return body.messages
    },

    cacheToolParameters(data: any[], state: PluginState, logger?: Logger): void {
        cacheToolParametersFromMessages(data, state, logger)
    },

    injectSynth(data: any[], instruction: string, nudgeText: string): boolean {
        return injectSynth(data, instruction, nudgeText)
    },

    trackNewToolResults(data: any[], tracker: ToolTracker, protectedTools: Set<string>): number {
        return trackNewToolResults(data, tracker, protectedTools)
    },

    injectPrunableList(data: any[], injection: string): boolean {
        return injectPrunableList(data, injection)
    },

    extractToolOutputs(data: any[], state: PluginState): ToolOutput[] {
        const outputs: ToolOutput[] = []

        for (const m of data) {
            // OpenAI Chat format: role='tool' with tool_call_id
            if (m.role === 'tool' && m.tool_call_id) {
                const metadata = state.toolParameters.get(m.tool_call_id.toLowerCase())
                outputs.push({
                    id: m.tool_call_id.toLowerCase(),
                    toolName: metadata?.tool
                })
            }

            // Anthropic format: role='user' with content[].type='tool_result'
            if (m.role === 'user' && Array.isArray(m.content)) {
                for (const part of m.content) {
                    if (part.type === 'tool_result' && part.tool_use_id) {
                        const metadata = state.toolParameters.get(part.tool_use_id.toLowerCase())
                        outputs.push({
                            id: part.tool_use_id.toLowerCase(),
                            toolName: metadata?.tool
                        })
                    }
                }
            }
        }

        return outputs
    },

    replaceToolOutput(data: any[], toolId: string, prunedMessage: string, _state: PluginState): boolean {
        const toolIdLower = toolId.toLowerCase()
        let replaced = false

        for (let i = 0; i < data.length; i++) {
            const m = data[i]

            // OpenAI Chat format
            if (m.role === 'tool' && m.tool_call_id?.toLowerCase() === toolIdLower) {
                data[i] = { ...m, content: prunedMessage }
                replaced = true
            }

            // Anthropic format
            if (m.role === 'user' && Array.isArray(m.content)) {
                let messageModified = false
                const newContent = m.content.map((part: any) => {
                    if (part.type === 'tool_result' && part.tool_use_id?.toLowerCase() === toolIdLower) {
                        messageModified = true
                        return { ...part, content: prunedMessage }
                    }
                    return part
                })
                if (messageModified) {
                    data[i] = { ...m, content: newContent }
                    replaced = true
                }
            }
        }

        return replaced
    },

    hasToolOutputs(data: any[]): boolean {
        for (const m of data) {
            if (m.role === 'tool') return true
            if (m.role === 'user' && Array.isArray(m.content)) {
                for (const part of m.content) {
                    if (part.type === 'tool_result') return true
                }
            }
        }
        return false
    },

    getLogMetadata(data: any[], replacedCount: number, inputUrl: string): Record<string, any> {
        return {
            url: inputUrl,
            replacedCount,
            totalMessages: data.length
        }
    }
}
