/**
 * Standalone tsdown config for the dsh-opencode-free client bundle (docs/ip-pool.md
 * §5.4) — mirrors dsh-llm-proxy's validated chain, adapted to the platform
 * seeds verified on this host (web-frontend static table): react,
 * react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis,
 * @deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives.
 *
 * Emits a closure-factory artifact into lib/client.js that calls
 * window.__ModuleLoader__.load({ id, factory }) and resolves its externals
 * through the injected require (the shell's module table). CSS Modules are
 * compiled by lightningcss inside the bundle (virtual module). The node half
 * keeps its own tsdown build (package.json "build"), so this config only
 * builds the browser half.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'
import type { UserConfig } from 'tsdown'

const ID = '@dsh-opencode-free/dsh-plugin'

/** This package's root; CSS-module hashes are computed from paths relative to it. */
const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))

/**
 * Browser platform modules the shell seeds into the frozen module table
 * (host-verified in the web-frontend dist kernel table). Every specifier here
 * is an external answered by the loader at runtime.
 */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

/**
 * Externals resolved from the loader module table.
 *
 * The client half reaches other DSH packages only through cordis services
 * (`slots`, `locale`, `configForms`), so nothing else qualifies: the settings
 * provider is reached by service injection, not by importing its bundle.
 */
export const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES]

/** Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

const config: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  // Browser bundle lands next to the node half (single lib/ artifact dir);
  // the entryFileNames pin keeps it exactly lib/client.js.
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  // Anything NOT in the loader module table must inline instead.
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  plugins: [{
    // Bundle purity gate: platform seed entries stay external, everything
    // else under @deepseek-ai is a build error (cross-plugin value imports
    // are forbidden — collaborate through cordis services; type-only imports
    // are erased).
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS) — ` +
        'cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased)',
      )
    },
  }, {
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      // `[hash]` is derived from the filename handed to lightningcss, so an
      // absolute path makes the class names depend on where the checkout lives
      // (and therefore on the OS: CI's /home/runner vs a Windows E:\ checkout).
      // The committed bundle must be identical wherever it is built, so hash the
      // repository-relative path instead.
      const hashName = relative(PACKAGE_ROOT, fileId).split(sep).join('/')
      const { code, exports: cssExports } = transform({
        filename: hashName,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      // lightningcss returns cssExports in an unspecified order, so emitting it
      // verbatim makes the committed bundle differ on every rebuild for no
      // semantic reason. Sort by key: the build must be reproducible, because CI
      // fails when the committed output drifts from src/.
      for (const [local, exp] of Object.entries(cssExports ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        classMap[local] = exp.name
      }
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(`${ID}/${basename(fileId)}`)};`,
        'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
        '  const tag = document.createElement(\'style\');',
        `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${sep}lib${sep}types${sep}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

export default config
