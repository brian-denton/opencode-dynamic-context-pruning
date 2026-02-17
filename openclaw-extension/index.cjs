"use strict"

const path = require("node:path")
const { pathToFileURL } = require("node:url")

let modulePromise

function loadModule() {
    if (!modulePromise) {
        const moduleUrl = pathToFileURL(path.join(__dirname, "src", "index.js")).href
        modulePromise = import(moduleUrl)
    }

    return modulePromise
}

function resolveLifecycle(mod, preferred) {
    const direct = typeof mod?.[preferred] === "function" ? mod[preferred] : undefined
    if (direct) {
        return direct
    }

    const plugin = mod?.default
    if (typeof plugin === "function") {
        const named = typeof plugin[preferred] === "function" ? plugin[preferred] : undefined
        if (named) {
            return named
        }

        return plugin
    }

    throw new Error(`openclaw-dcp-extension: plugin entry missing ${preferred}() lifecycle export`)
}

async function register(api) {
    const mod = await loadModule()
    const lifecycle = resolveLifecycle(mod, "register")
    return lifecycle(api)
}

async function activate(api) {
    const mod = await loadModule()
    const lifecycle = resolveLifecycle(mod, "activate")
    return lifecycle(api)
}

async function plugin(api) {
    return activate(api)
}

plugin.register = register
plugin.activate = activate

module.exports = plugin
module.exports.default = plugin
module.exports.register = register
module.exports.activate = activate
