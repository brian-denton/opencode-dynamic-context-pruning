/**
 * Adapter-level scaffolding types for OpenClaw extension wiring.
 *
 * The runtime SDK shape is intentionally not assumed here.
 * Integrators can map these lightweight contracts to concrete SDK types.
 */

/**
 * @typedef {Object} DcpMessage
 * @property {string} id
 * @property {string} [role]
 * @property {string} [toolName]
 * @property {unknown} [content]
 * @property {Object<string, unknown>} [input]
 * @property {Object<string, unknown>} [meta]
 * @property {string} [filePath]
 */

/**
 * @typedef {Object} ExtensionConfig
 * @property {boolean} enabled
 * @property {string[]} protectedTools
 * @property {string[]} protectedFilePatterns
 * @property {{ enabled: boolean }} commands
 */

/**
 * @typedef {Object} PrunedRecord
 * @property {string} reason
 * @property {string | undefined} toolName
 * @property {number} chars
 * @property {number} at
 * @property {string | undefined} distillationID
 */

/**
 * @typedef {Object} DistillationRecord
 * @property {string} id
 * @property {string[]} sourceMessageIDs
 * @property {string} summary
 * @property {number} at
 */

/**
 * @typedef {Object} InventoryEntry
 * @property {string} id
 * @property {string} messageID
 * @property {string} role
 * @property {string} toolName
 * @property {number} chars
 * @property {number} estimatedTokens
 */

/**
 * @typedef {Object} DcpState
 * @property {Map<string, PrunedRecord>} prunedByID
 * @property {Map<string, { originalID: string, transformedID: string, pruned: boolean }>} idMap
 * @property {Map<string, string>} distillationBySourceID
 * @property {DistillationRecord[]} distillations
 * @property {{ signature: string, entries: InventoryEntry[], numericToMessageID: Map<string, string>, messageToNumericID: Map<string, string> }} inventory
 * @property {{ prunedMessages: number, prunedChars: number, distillations: number, sweeps: number }} counters
 */

export {}
