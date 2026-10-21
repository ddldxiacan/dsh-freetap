/**
 * Where the plugin keeps its per-user state: the model catalog cache, the
 * health snapshot (`adapter-status.json`), the sing-box runtime, and — in the
 * legacy sidecar mode — `agent-config.json` plus `agent-token.txt`.
 *
 * One home, one spelling. `~/.dsh-freetap` is user-visible and documented
 * (README "Install" / troubleshooting), so it must not drift between the
 * adapter, the ip-pool assembly and the sidecar path.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** Absolute data directory for the current user. */
export function dataDir(home: string = homedir()): string {
  return join(home, '.dsh-freetap')
}
