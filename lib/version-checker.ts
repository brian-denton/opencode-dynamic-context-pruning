import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

export const PACKAGE_NAME = '@tarquinen/opencode-dcp'
export const NPM_REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export function getLocalVersion(): string {
    try {
        const pkgPath = join(__dirname, '../../package.json')
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
        return pkg.version
    } catch {
        return '0.0.0'
    }
}

export async function getNpmVersion(): Promise<string | null> {
    try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)

        const res = await fetch(NPM_REGISTRY_URL, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        })
        clearTimeout(timeout)

        if (!res.ok) return null
        const data = await res.json() as { version?: string }
        return data.version ?? null
    } catch {
        return null
    }
}

export function isOutdated(local: string, remote: string): boolean {
    const parseVersion = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0)
    const [localParts, remoteParts] = [parseVersion(local), parseVersion(remote)]

    for (let i = 0; i < Math.max(localParts.length, remoteParts.length); i++) {
        const l = localParts[i] ?? 0
        const r = remoteParts[i] ?? 0
        if (r > l) return true
        if (l > r) return false
    }
    return false
}

export async function checkForUpdates(client: any, logger?: { info: (component: string, message: string, data?: any) => void }, showToast: boolean = true): Promise<void> {
    try {
        const local = getLocalVersion()
        const npm = await getNpmVersion()

        if (!npm) {
            logger?.info("version", "Version check skipped", { reason: "npm fetch failed" })
            return
        }

        if (!isOutdated(local, npm)) {
            logger?.info("version", "Up to date", { local, npm })
            return
        }

        logger?.info("version", "Update available", { local, npm })

        if (!showToast) {
            return
        }

        await client.tui.showToast({
            body: {
                title: "DCP: Update available",
                message: `v${local} → v${npm}\nUpdate opencode.jsonc: ${PACKAGE_NAME}@${npm}`,
                variant: "info",
                duration: 6000
            }
        })
    } catch {
    }
}
