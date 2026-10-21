/**
 * Server-half build for the dsh-freetap DSH plugin.
 *
 * WHY DEPENDENCIES ARE INLINED
 * ----------------------------
 * `@earendil-works/pi-ai` is the wire layer, and it brings a large provider
 * matrix we never use at runtime here: `@google/genai` (prepare script),
 * `protobufjs` (postinstall), the whole `@aws-sdk` bedrock tree, Anthropic,
 * Mistral and OpenAI SDKs. Two of those declare install scripts, which pnpm
 * refuses to run by default — so a plain `dsh plugin add` aborted with
 *
 *     ERR_PNPM_IGNORED_BUILDS
 *     Ignored build scripts: @google/genai@1.52.0, protobufjs@7.6.6
 *
 * **after** pnpm had already written the dependency into the profile's
 * package.json. DSH only registers a package as a profile *bundle* when the run
 * exits 0, so that failure left the plugin installed but never loaded, with no
 * model in the picker and nothing in the output saying why. Every new user hit
 * it, and the only escape was to pre-seed `allowBuilds` in
 * `pnpm-workspace.yaml` before installing.
 *
 * Inlining pi-ai removes the problem at the source instead of asking the user
 * to work around it: the published package depends only on small,
 * script-free libraries (`yaml`, `undici`, `partial-json`), so a bare
 * `dsh plugin add <tarball>` succeeds on a clean machine.
 *
 * Only pi-ai is inlined. The remaining dependencies stay external because they
 * are either native-ish and better deduped by the host (`undici`) or plain JS
 * with no install scripts (`yaml`, `partial-json`). Everything under `node:`
 * is external by definition.
 *
 * The client half has its own config (tsdown.client.config.ts) with a different
 * external table: browser platform modules come from the shell's loader.
 */
import type { UserConfig } from 'tsdown'

/** Inline everything except these. */
const EXTERNAL: RegExp[] = [
  /^node:/,
  // Kept external: undici ships native-free but version-sensitive dispatcher
  // internals, and the host already provides a copy.
  /^undici$/,
]

const config: UserConfig = {
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  dts: true,
  clean: false,
  external: EXTERNAL,
  // Anything not matched by EXTERNAL is a candidate for inlining; this is the
  // switch that pulls pi-ai (and its unused provider SDKs) into the bundle
  // rather than leaving them as install-time dependencies.
  noExternal: [/.*/],
}

export default config
