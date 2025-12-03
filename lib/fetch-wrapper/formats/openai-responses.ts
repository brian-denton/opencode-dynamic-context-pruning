import type { FormatDescriptor, ToolOutput } from "../types"
import { PRUNED_CONTENT_MESSAGE } from "../types"
import type { PluginState } from "../../state"
import type { Logger } from "../../logger"
import type { ToolTracker } from "../../api-formats/synth-instruction"
import { cacheToolParametersFromInput } from "../../state/tool-cache"
import { injectSynthResponses, trackNewToolResultsResponses } from "../../api-formats/synth-instruction"
import { injectPrunableListResponses } from "../../api-formats/prunable-list"

/**
 * Format descriptor for OpenAI Responses API (GPT-5 models via sdk.responses()).
 * 
 * Uses body.input array with:
 * - type='function_call' items for tool calls
 * - type='function_call_output' items for tool results
 * - type='message' items for user/assistant messages
 */
export const openaiResponsesFormat: FormatDescriptor = {
    name: 'openai-responses',

    detect(body: any): boolean {
        return body.input && Array.isArray(body.input)
    },

    getDataArray(body: any): any[] | undefined {
        return body.input
    },

    cacheToolParameters(data: any[], state: PluginState, logger?: Logger): void {
        cacheToolParametersFromInput(data, state, logger)
    },

    injectSynth(data: any[], instruction: string, nudgeText: string): boolean {
        return injectSynthResponses(data, instruction, nudgeText)
    },

    trackNewToolResults(data: any[], tracker: ToolTracker, protectedTools: Set<string>): number {
        return trackNewToolResultsResponses(data, tracker, protectedTools)
    },

    injectPrunableList(data: any[], injection: string): boolean {
        return injectPrunableListResponses(data, injection)
    },

    extractToolOutputs(data: any[], state: PluginState): ToolOutput[] {
        const outputs: ToolOutput[] = []

        for (const item of data) {
            if (item.type === 'function_call_output' && item.call_id) {
                const metadata = state.toolParameters.get(item.call_id.toLowerCase())
                outputs.push({
                    id: item.call_id.toLowerCase(),
                    toolName: metadata?.tool ?? item.name
                })
            }
        }

        return outputs
    },

    replaceToolOutput(data: any[], toolId: string, prunedMessage: string, _state: PluginState): boolean {
        const toolIdLower = toolId.toLowerCase()
        let replaced = false

        for (let i = 0; i < data.length; i++) {
            const item = data[i]
            if (item.type === 'function_call_output' && item.call_id?.toLowerCase() === toolIdLower) {
                data[i] = { ...item, output: prunedMessage }
                replaced = true
            }
        }

        return replaced
    },

    hasToolOutputs(data: any[]): boolean {
        return data.some((item: any) => item.type === 'function_call_output')
    },

    getLogMetadata(data: any[], replacedCount: number, inputUrl: string): Record<string, any> {
        return {
            url: inputUrl,
            replacedCount,
            totalItems: data.length,
            format: 'openai-responses-api'
        }
    }
}
