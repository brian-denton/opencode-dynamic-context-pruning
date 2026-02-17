import test from "node:test"
import assert from "node:assert/strict"

import { normalizeConfig } from "../src/config.js"
import { createCommandHandler } from "../src/commands.js"
import openClawDcpPlugin, { createOpenClawDcpExtension, register } from "../src/index.js"
import { createState } from "../src/state.js"
import { createTransformedView, getPrunableInventory, pruneByIDs, sweep } from "../src/core.js"
import { createTools } from "../src/tools.js"

test("id mapping and transformed placeholders are preserved", () => {
    const config = normalizeConfig({})
    const state = createState()
    const messages = [
        { id: "u1", role: "user", content: "run checks" },
        { id: "t1", role: "tool", toolName: "bash", content: "big output" },
    ]

    const result = pruneByIDs(messages, state, config, ["t1"], "manual", undefined)
    assert.deepEqual(result.prunedIDs, ["t1"])

    const transformed = createTransformedView(messages, state)
    assert.equal(transformed[1].id, "t1")
    assert.match(String(transformed[1].content), /dcp-pruned id=t1/)

    const idMap = state.idMap.get("t1")
    assert.equal(idMap?.originalID, "t1")
    assert.equal(idMap?.transformedID, "t1")
    assert.equal(idMap?.pruned, true)
})

test("protection by tool name and file pattern is enforced", () => {
    const config = normalizeConfig({
        protectedTools: ["read"],
        protectedFilePatterns: ["**/keep.txt"],
    })
    const state = createState()
    const messages = [
        {
            id: "t1",
            role: "tool",
            toolName: "read",
            content: "x",
            input: { filePath: "/tmp/a.txt" },
        },
        {
            id: "t2",
            role: "tool",
            toolName: "bash",
            content: "y",
            input: { filePath: "/tmp/keep.txt" },
        },
        {
            id: "t3",
            role: "tool",
            toolName: "bash",
            content: "z",
            input: { filePath: "/tmp/drop.txt" },
        },
    ]

    const result = pruneByIDs(messages, state, config, ["t1", "t2", "t3"], "manual", undefined)
    assert.deepEqual(result.prunedIDs, ["t3"])
    assert.deepEqual(result.protectedIDs.sort(), ["t1", "t2"])
})

test("sweep prunes since last user and honors limit", () => {
    const config = normalizeConfig({})
    const state = createState()
    const messages = [
        { id: "u1", role: "user", content: "first" },
        { id: "t1", role: "tool", toolName: "bash", content: "old1" },
        { id: "t2", role: "tool", toolName: "bash", content: "old2" },
        { id: "u2", role: "user", content: "second" },
        { id: "t3", role: "tool", toolName: "bash", content: "new1" },
        { id: "t4", role: "tool", toolName: "bash", content: "new2" },
        { id: "t5", role: "tool", toolName: "bash", content: "new3" },
    ]

    const limited = sweep(messages, state, config, 2)
    assert.deepEqual(limited.prunedIDs, ["t4", "t5"])

    const next = sweep(messages, state, config, undefined)
    assert.deepEqual(next.prunedIDs, ["t3"])
})

test("inventory uses stable numeric IDs for prunable runtime messages", () => {
    const config = normalizeConfig({ protectedTools: ["read"] })
    const state = createState()
    const messages = [
        { id: "u1", role: "user", content: "start" },
        { id: "t1", role: "tool", toolName: "bash", content: "alpha" },
        { id: "t2", role: "tool", toolName: "read", content: "protected" },
        { id: "t3", role: "tool", toolName: "bash", content: "beta" },
    ]

    const first = getPrunableInventory(messages, state, config)
    const second = getPrunableInventory(messages, state, config)

    assert.deepEqual(
        first.map((entry) => ({ id: entry.id, messageID: entry.messageID })),
        [
            { id: "1", messageID: "t1" },
            { id: "2", messageID: "t3" },
        ],
    )
    assert.deepEqual(
        second.map((entry) => ({ id: entry.id, messageID: entry.messageID })),
        [
            { id: "1", messageID: "t1" },
            { id: "2", messageID: "t3" },
        ],
    )
    assert.equal(state.inventory.numericToMessageID.get("1"), "t1")
    assert.equal(state.inventory.numericToMessageID.get("2"), "t3")
})

test("dcp_prune accepts inventory ids and falls back to sweep", async () => {
    const config = normalizeConfig({})
    const state = createState()
    const tools = createTools({ state, config })
    const runtime = {
        messages: [
            { id: "u1", role: "user", content: "start" },
            { id: "t1", role: "tool", toolName: "bash", content: "aaa" },
            { id: "t2", role: "tool", toolName: "bash", content: "bbb" },
        ],
    }

    const targeted = await tools.dcp_prune({ ids: ["2"] }, runtime)
    assert.equal(targeted.mode, "inventory")
    assert.deepEqual(targeted.prunedIDs, ["t2"])

    const swept = await tools.dcp_prune({}, runtime)
    assert.equal(swept.mode, "sweep")
    assert.deepEqual(swept.prunedIDs, ["t1"])
})

test("dcp_distill accepts targets and stores per-id summaries", async () => {
    const config = normalizeConfig({})
    const state = createState()
    const tools = createTools({ state, config })
    const runtime = {
        messages: [
            { id: "u1", role: "user", content: "start" },
            { id: "t1", role: "tool", toolName: "bash", content: "aaa" },
            { id: "t2", role: "tool", toolName: "bash", content: "bbb" },
        ],
    }

    const result = await tools.dcp_distill(
        {
            targets: [
                { id: "1", distillation: "tool output one" },
                { id: "2", distillation: "tool output two" },
            ],
        },
        runtime,
    )

    assert.deepEqual(result.prunedIDs.sort(), ["t1", "t2"])
    assert.equal(result.distillations.length, 2)
    assert.equal(state.distillationBySourceID.get("t1"), result.distillations[0].id)
    assert.equal(state.distillationBySourceID.get("t2"), result.distillations[1].id)
    assert.equal(result.distillations[0].summary, "tool output one")
    assert.equal(result.distillations[1].summary, "tool output two")
})

test("/dcp context shows numbered prunable inventory", async () => {
    const config = normalizeConfig({})
    const state = createState()
    const command = createCommandHandler({ state, config })
    const runtime = {
        messages: [
            { id: "u1", role: "user", content: "start" },
            { id: "t1", role: "tool", toolName: "bash", content: "aaaa" },
            { id: "t2", role: "tool", toolName: "bash", content: "bbbbbbbb" },
        ],
    }

    const output = await command("/dcp context", runtime)
    assert.match(output, /prunable count=2 chars=12 estTokens=3/)
    assert.match(output, /#1 bash chars=4 estTokens=1/)
    assert.match(output, /#2 bash chars=8 estTokens=2/)
})

test("plugin register wires tools and command on host api", async () => {
    const calls = {
        tools: [],
        commands: [],
    }

    const api = {
        config: { enabled: true },
        registerTool(arg1, arg2) {
            if (arguments.length === 1) {
                calls.tools.push({ name: arg1.name, payload: arg1 })
                return
            }
            calls.tools.push({ name: arg1, payload: arg2 })
        },
        registerCommand(arg1, arg2) {
            if (arguments.length === 1) {
                calls.commands.push({ name: arg1.name, payload: arg1 })
                return
            }
            calls.commands.push({ name: arg1, payload: arg2 })
        },
    }

    const extension = register(api)

    assert.equal(extension.id, "openclaw-dcp-extension")
    assert.equal(calls.tools.length, 2)
    assert.deepEqual(
        calls.tools.map((entry) => entry.name),
        ["dcp_prune", "dcp_distill"],
    )
    assert.equal(calls.tools[0].payload.parameters.properties.ids.type, "array")
    assert.equal(calls.tools[1].payload.parameters.properties.targets.type, "array")

    assert.equal(calls.commands.length, 1)
    assert.equal(calls.commands[0].name, "dcp")
    assert.equal(calls.commands[0].payload.parameters.properties.args.type, "string")

    const runtime = {
        messages: [
            { id: "u1", role: "user", content: "start" },
            { id: "t1", role: "tool", toolName: "bash", content: "aaa" },
        ],
    }

    const pruneResult = await calls.tools[0].payload.handler({ ids: ["1"] }, runtime)
    assert.deepEqual(pruneResult.prunedIDs, ["t1"])

    const commandResult = await calls.commands[0].payload.handler({ args: "stats" }, runtime)
    assert.match(commandResult, /stats prunedMessages=1/)
})

test("plugin register prefers object-style tool and command registration", async () => {
    const calls = {
        tools: [],
        commands: [],
    }

    const api = {
        config: { enabled: true },
        registerTool(definition) {
            if (arguments.length !== 1) {
                throw new Error("object-style only")
            }
            calls.tools.push(definition)
        },
        registerCommand(definition) {
            if (arguments.length !== 1) {
                throw new Error("object-style only")
            }
            calls.commands.push(definition)
        },
    }

    register(api)

    assert.equal(calls.tools.length, 2)
    assert.deepEqual(
        calls.tools.map((entry) => entry.name),
        ["dcp_prune", "dcp_distill"],
    )
    assert.equal(typeof calls.tools[0].execute, "function")
    assert.equal(typeof calls.tools[0].handler, "function")
    assert.equal(calls.tools[0].parameters.properties.ids.type, "array")

    assert.equal(calls.commands.length, 1)
    assert.equal(calls.commands[0].name, "dcp")
    assert.equal(typeof calls.commands[0].execute, "function")
    assert.equal(typeof calls.commands[0].handler, "function")

    const runtime = {
        messages: [
            { id: "u1", role: "user", content: "start" },
            { id: "t1", role: "tool", toolName: "bash", content: "aaa" },
            { id: "t2", role: "tool", toolName: "bash", content: "bbb" },
        ],
    }

    const executeResult = await calls.tools[0].execute("call-1", { ids: ["2"] }, runtime)
    assert.equal(Array.isArray(executeResult.content), true)
    assert.equal(executeResult.content[0].type, "text")
    assert.deepEqual(executeResult.structuredContent.prunedIDs, ["t2"])

    const commandExecute = await calls.commands[0].execute("cmd-7", { args: "stats" }, runtime)
    assert.equal(commandExecute.content[0].type, "text")
    assert.match(commandExecute.content[0].text, /stats prunedMessages=1/)
})

test("plugin register falls back to slash-prefixed command name", () => {
    const calls = {
        commands: [],
    }

    const api = {
        config: { enabled: true },
        registerCommand(name, payload) {
            if (arguments.length !== 2) {
                throw new Error("name + payload only")
            }
            if (name === "dcp") {
                throw new Error("slash prefix required")
            }
            calls.commands.push({ name, payload })
        },
    }

    register(api)
    assert.equal(calls.commands.length, 1)
    assert.equal(calls.commands[0].name, "/dcp")
    assert.equal(typeof calls.commands[0].payload.handler, "function")
})

test("plugin entry default export is directly loadable", () => {
    const api = {}
    const fromDefault = openClawDcpPlugin(api)
    const fromFactory = createOpenClawDcpExtension({})

    assert.equal(fromDefault.id, fromFactory.id)
    assert.equal(fromDefault.enabled, true)
})

test("plugin register gracefully no-ops when host api methods are missing", () => {
    const extension = register({ config: { enabled: true } })

    assert.equal(extension.id, "openclaw-dcp-extension")
    assert.equal(extension.enabled, true)
    assert.equal(typeof extension.tools.dcp_prune, "function")
})
