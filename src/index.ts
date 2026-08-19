#!/usr/bin/env bun

import { dirname, resolve } from 'path'
import { pathToFileURL } from 'url'
import { promisify } from 'util'
import * as fs from 'fs'

const writeFile = promisify(fs.writeFile)
const mkdir = promisify(fs.mkdir)

import {
  ConfigService,
  fileUtil,
  Service,
  VanillaConfig,
  type MetaRegistry,
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
import { export_resources, export_resource_paths } from './typegen/resources'
import { TARGET_VERSION } from './typegen/mcdoc/version'

export interface GeneratorOptions {
  /** Output directory for generated types (default: "types") */
  out_dir?: string
  /** Whether to generate a tsconfig.json in the output directory (default: true) */
  tsconfig?: boolean
}

const cache_root = join(process.cwd(), 'cache')

function registerAttributes(meta: MetaRegistry, release: ReleaseVersion) {
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
const vanilla_mcdoc_src = [
  'https://api.spyglassmc.com/vanilla-mcdoc/symbols',
  'https://raw.githubusercontent.com/SpyglassMC/vanilla-mcdoc/refs/heads/generated/symbols.json',
]

/** Shared flag: set to false if any required fetch fails. Checked before generation. */
export let all_fetches_ok = true

export interface VanillaMcdocSymbols {
  ref: string,
  mcdoc: Record<string, unknown>,
  'mcdoc/dispatcher': Record<string, Record<string, unknown>>,
}
export async function fetchVanillaMcdoc(): Promise<VanillaMcdocSymbols> {
  try {
    const buffer = await fetchWithCache(vanilla_mcdoc_src)
    mcdoc_raw = await buffer.text()
    return JSON.parse(mcdoc_raw) as VanillaMcdocSymbols
  } catch (e) {
    all_fetches_ok = false
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
    all_fetches_ok = false
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
    all_fetches_ok = false
    console.warn('Error occurred while fetching block states:', errorMessage(e))
  }
  return [result, etag] as const
}

export async function fetchTranslationKeys() {
  console.debug('[fetchTranslationKeys] latest from github')
  try {
    const req = await fetchWithCache('https://raw.githubusercontent.com/misode/mcmeta/refs/heads/assets-tiny/assets/minecraft/lang/en_us.json')

    const data = await req.json() as Record<string, string>
    return Object.keys(data).map((key) => `minecraft:${key}`)
  } catch (e) {
    all_fetches_ok = false
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
  /* oxlint-disable-next-line no-unused-vars */
  const { config, logger, meta, externals, cacheRoot } = ctx

  const vanillaMcdoc = await fetchVanillaMcdoc()
  meta.registerSymbolRegistrar('vanilla-mcdoc', {
    checksum: vanillaMcdoc.ref,
    registrar: vanillaMcdocRegistrar(vanillaMcdoc),
  })

  meta.registerUriBinder(je.binder.uriBinder)

  const versions: { id: ReleaseVersion, type: 'release' | 'snapshot' }[] = (await (await fetch('https://api.spyglassmc.com/mcje/versions')).json())

  // Registries / block states / the mcmeta summary must come from the same
  // Minecraft version the mcdoc `since`/`until` filters target, otherwise a
  // pinned build (e.g. sandstone 1.0.x on mc 26.1) gets newer registry entries.
  // Prefer an exact id match. If the target exists only as a snapshot (e.g.
  // sandstone 1.2.x on a 26.3 snapshot that hasn't shipped a release yet),
  // fall back to the highest snapshot for that major.minor so the user
  // gets 26.3 data rather than silently downgrading to 26.2.
  let version = versions.find((v) => v.id === TARGET_VERSION)

  if (version === undefined) {
    const [, targetMaj, targetMin] = TARGET_VERSION.match(/^(\d+)\.(\d+)/)!
    const sameMinor = versions
      .filter((v) => v.id.startsWith(`${targetMaj}.${targetMin}-`))
      .sort((a, b) => b.id.localeCompare(a.id))
    version = sameMinor[0]
    if (version !== undefined) {
      console.warn(
        `[initialize] MCDOC_TARGET_VERSION="${TARGET_VERSION}" has no exact release on Spyglass; falling back to latest snapshot ${version.id} for that minor.`,
      )
    } else {
      console.warn(
        `[initialize] MCDOC_TARGET_VERSION="${TARGET_VERSION}" not found in the Spyglass version list; falling back to the latest release. Generated registries will NOT match the target version.`,
      )
    }
  }

  if (version === undefined) {
    version = versions.find((v) => v.type === 'release')!
  }

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

  service.project.on('ready', () => {
    if (!all_fetches_ok) {
      throw new Error('one or more required fetches failed during project init; aborting before generation')
    }
  })

  await service.project.init()
  await service.project.ready()
  await service.project.cacheService.save()

  const translation_keys = await fetchTranslationKeys()
  if (!all_fetches_ok) {
    throw new Error('one or more required fetches failed; aborting before generation')
  }

  const type_gen = new TypesGenerator()

  type_gen.resolve_types(service.project.symbols, translation_keys)

  for await (const [symbol_path, { exports, imports }] of type_gen.resolved_symbols.entries()) {
    const parts = symbol_path.split('::')
    if (parts[0] === '') {
      parts.shift()
    }
    const file = parts.slice(1)

    file.unshift(out_dir)

    const out_path = `${join(...file)}.ts`

    const code = await compile_types([
      ...handle_imports(imports),
      ...exports,
    ], out_path)

    await mkdir(dirname(out_path), { recursive: true })
    await writeFile(out_path, code)
  }

  // TODO: Move this over to TypesGenerator#resolve_types since this doesn't require the version
  console.log('resources')
  const resources_export = export_resources()
  const resources_path = join(out_dir, 'resources.ts')
  const resources_code = await compile_types(resources_export.exports, resources_path)
  await writeFile(resources_path, resources_code)

  const resource_paths_export = export_resource_paths()
  const resource_paths_path = join(out_dir, 'resource-paths.ts')
  const resource_paths_code = await compile_types(resource_paths_export.exports, resource_paths_path)
  await writeFile(resource_paths_path, resource_paths_code)

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

  service.project.close()
}
