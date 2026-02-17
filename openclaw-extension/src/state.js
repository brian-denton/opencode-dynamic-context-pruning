/** @returns {import("./types.js").DcpState} */
export function createState() {
    return {
        prunedByID: new Map(),
        idMap: new Map(),
        distillationBySourceID: new Map(),
        distillations: [],
        inventory: {
            signature: "",
            entries: [],
            numericToMessageID: new Map(),
            messageToNumericID: new Map(),
        },
        counters: {
            prunedMessages: 0,
            prunedChars: 0,
            distillations: 0,
            sweeps: 0,
        },
    }
}
