import { dirname, resolve } from 'path'
import { pathToFileURL } from 'url'
import { promisify } from 'util'
import * as fs from 'fs'
import { $ } from 'bun'

const writeFile = promisify(fs.writeFile)
const mkdir = promisify(fs.mkdir)

import type {
  MetaRegistry } from '@spyglassmc/core'
import {
  ConfigService,
  fileUtil,
  Service,
  VanillaConfig,
  type SymbolRegistrar,
  type ProjectInitializer,
} from '@spyglassmc/core'
import { NodeJsExternals } from '@spyglassmc/core/lib/nodejs.js'
import * as je from '@spyglassmc/java-edition'
import { ReleaseVersion } from '@spyglassmc/java-edition/lib/dependency/index.js'
import * as mcdoc from '@spyglassmc/mcdoc'
import { errorMessage, join } from './util'
import { fetchWithCache } from './util/fetch'
import { TypesGenerator } from './typegen'
import { compile_types } from './typegen/compile'
import { handle_imports } from './typegen/import'

export interface GeneratorOptions {
  /** Output directory for generated types (default: "types") */
  out_dir?: string
  /** Whether to generate a tsconfig.json in the output directory (default: true) */
  tsconfig?: boolean
}

const cache_root = join(process.cwd(), 'cache')

function registerAttributes(meta: MetaRegistry, release: ReleaseVersion) {
  // We always generate for the latest version
  mcdoc.runtime.registerAttribute(meta, 'since', mcdoc.runtime.attribute.validator.string, {
    filterElement: () => false,
  })
  mcdoc.runtime.registerAttribute(meta, 'until', mcdoc.runtime.attribute.validator.string, {
    filterElement: () => true,
  })
  mcdoc.runtime.registerAttribute(
    meta,
    'deprecated',
    mcdoc.runtime.attribute.validator.optional(mcdoc.runtime.attribute.validator.string),
    {
      mapField: (config, field, ctx) => {
        if (config === undefined) {
          return { ...field, deprecated: true }
        }
        if (!config.startsWith('1.')) {
          ctx.logger.warn(`Invalid mcdoc attribute for "deprecated": ${config}`)
          return field
        }
        if (ReleaseVersion.cmp(release, config as ReleaseVersion) >= 0) {
          return { ...field, deprecated: true }
        }
        return field
      },
    },
  )
}

// Yes this is cursed
export let mcdoc_raw = ''
const vanillaMcdocUrl = 'https://api.spyglassmc.com/vanilla-mcdoc/symbols'

export interface VanillaMcdocSymbols {
  ref: string,
  mcdoc: Record<string, unknown>,
  'mcdoc/dispatcher': Record<string, Record<string, unknown>>,
}
export async function fetchVanillaMcdoc(): Promise<VanillaMcdocSymbols> {
  try {
    const buffer = await fetchWithCache(vanillaMcdocUrl)
    mcdoc_raw = await buffer.text()
    return JSON.parse(mcdoc_raw) as VanillaMcdocSymbols
  } catch (e) {
    throw new Error(`Error occurred while fetching vanilla-mcdoc: ${errorMessage(e)}`)
  }
}

export async function fetchRegistries(versionId: string) {
  console.debug(`[fetchRegistries] ${versionId}`)

  let etag = ''

  try {
    const req = await fetchWithCache(`https://api.spyglassmc.com/mcje/versions/${versionId}/registries`)

    etag = req.headers.get('ETag')!

    const data = await req.json() as VanillaMcdocSymbols

    const result = new Map<string, string[]>()
    for (const id in data) {
      /* @ts-ignore */
      result.set(id, data[id].map((e: string) => `minecraft:${e}`))
    }
    return [result, etag] as const
  } catch (e) {
    throw new Error(`Error occurred while fetching registries: ${errorMessage(e)}`)
  }
}

export type BlockStateData = [Record<string, string[]>, Record<string, string>]

export async function fetchBlockStates(versionId: string) {
  console.debug(`[fetchBlockStates] ${versionId}`)
  const result = new Map<string, BlockStateData>()
  let etag = ''
  try {
    const req = await fetchWithCache(`https://api.spyglassmc.com/mcje/versions/${versionId}/block_states`)

    etag = req.headers.get('ETag')!

    const data = await req.json() as Record<string, BlockStateData>
    for (const id in data) {
      result.set(id, data[id])
    }
  } catch (e) {
    console.warn('Error occurred while fetching block states:', errorMessage(e))
  }
  return [result, etag] as const
}

export async function fetchTranslationKeys() {
  console.debug('[fetchTranslationKeys] latest from github')
  const result = new Map<string, string>()
  try {
    const req = await fetchWithCache(
      'https://raw.githubusercontent.com/misode/mcmeta/refs/heads/assets-tiny/assets/minecraft/lang/en_us.json',
    )

    const data = await req.json() as Record<string, string>
    return Object.keys(data).map((key) => `minecraft:${key}`)
  } catch (e) {
    console.warn('Error occurred while fetching translation keys:', errorMessage(e))
  }
  return []
}

const VanillaMcdocUri = 'mcdoc://vanilla-mcdoc/symbols.json'

function vanillaMcdocRegistrar(vanillaMcdoc: VanillaMcdocSymbols): SymbolRegistrar {
  return (symbols) => {
    const start = performance.now()
    for (const [id, typeDef] of Object.entries(vanillaMcdoc.mcdoc)) {
      symbols.query(VanillaMcdocUri, 'mcdoc', id).enter({
        data: { data: { typeDef } },
        usage: { type: 'declaration' },
      })
    }
    for (const [dispatcher, ids] of Object.entries(vanillaMcdoc['mcdoc/dispatcher'])) {
      symbols.query(VanillaMcdocUri, 'mcdoc/dispatcher', dispatcher)
        .enter({ usage: { type: 'declaration' } })
        .onEach(Object.entries(ids), ([id, typeDef], query) => {
          query.member(id, (memberQuery) => {
            memberQuery.enter({
              data: { data: { typeDef } },
              usage: { type: 'declaration' },
            })
          })
        })
    }
    const duration = performance.now() - start
    console.log(`[vanillaMcdocRegistrar] Done in ${duration}ms`)
  }
}

const initialize: ProjectInitializer = async (ctx) => {
  const { config, logger, meta, externals, cacheRoot } = ctx

  const vanillaMcdoc = await fetchVanillaMcdoc()
  meta.registerSymbolRegistrar('vanilla-mcdoc', {
    checksum: vanillaMcdoc.ref,
    registrar: vanillaMcdocRegistrar(vanillaMcdoc),
  })

  meta.registerUriBinder(je.binder.uriBinder)

  const version = (await (await fetch('https://api.spyglassmc.com/mcje/versions')).json())[0]
  const release = version.id

  const [registries, registriesETag] = await fetchRegistries(version.id)
  const [blockStates, blockStatesETag] = await fetchBlockStates(version.id)

  const summary: je.dependency.McmetaSummary = {
    registries: Object.fromEntries(registries.entries()),
    blocks: Object.fromEntries([...blockStates.entries()]
      .map(([id, data]) => [id, data])),
    fluids: je.dependency.Fluids,
    commands: { type: 'root', children: {} },
  }

  const versionETag = registriesETag + blockStatesETag

  meta.registerSymbolRegistrar('mcmeta-summary', {
    checksum: versionETag,
    registrar: je.dependency.symbolRegistrar(summary, release),
  })

  registerAttributes(meta, release)

  return { loadedVersion: release }
}

export async function generate(options: GeneratorOptions = {}): Promise<void> {
  const { out_dir = 'types', tsconfig = true } = options

  const project_path = resolve(process.cwd(), 'dummy')

  // haha funny Bun
  /* @ts-ignore */
  await fileUtil.ensureDir(NodeJsExternals, project_path)

  const service = new Service({
    logger: {
      log: (...log_args: any[]) => console.log(...log_args),

      warn: (...log_args: any[]) => console.warn(...log_args),

      error: (...log_args: any[]) => console.error(...log_args),

      info: (...log_args: any[]) => console.info(...log_args),
    },
    project: {
      cacheRoot: fileUtil.ensureEndingSlash(
        pathToFileURL(cache_root).toString(),
      ),
      defaultConfig: ConfigService.merge(VanillaConfig, {
        env: { dependencies: [] },
      }),
      // haha funny Bun
      /* @ts-ignore */
      externals: NodeJsExternals,
      initializers: [mcdoc.initialize, initialize],
      projectRoots: [fileUtil.ensureEndingSlash(
        pathToFileURL(project_path).toString(),
      )],
    },
  })

  await service.project.ready()
  await service.project.cacheService.save()

  const type_gen = new TypesGenerator()

  type_gen.resolve_types(service.project.symbols, await fetchTranslationKeys())

  for await (const [symbol_path, { exports, imports }] of type_gen.resolved_symbols.entries()) {
    const parts = symbol_path.split('::')
    if (parts[0] === '') {
      parts.shift()
    }
    const file = parts.slice(1)

    file.unshift(out_dir)

    const out_path = `${join(...file)}.ts`

    const code = compile_types([
      ...handle_imports(imports),
      ...exports,
    ], out_path)

    await mkdir(dirname(out_path), { recursive: true })
    await writeFile(out_path, code)
  }

  if (tsconfig) {
    const tsconfig_path = join(out_dir, 'tsconfig.json')
    await mkdir(dirname(tsconfig_path), { recursive: true })
    await writeFile(tsconfig_path, JSON.stringify({
      compilerOptions: {
        allowImportingTsExtensions: true,
        noEmit: true,
        baseUrl: './',
        paths: {
          'sandstone': ['../sandstone-types/index.ts'],
          'sandstone/arguments': ['../sandstone-types/arguments/index.ts'],
          'sandstone/arguments/generated/*': ['./*'],
        },
      },
    }, null, 2))
  }

  console.log('[oxlint] Formatting output...')
  // TODO: Get oxlint to run through all formatting without needing to run it multiple times
  // TODO: Generate the oxlint file so that this is portable
  await $`bun oxlint --fix --config .oxlintrc.generated.json ${out_dir}`.quiet().nothrow()

  service.project.close()
}
