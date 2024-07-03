import { promises as fs } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

import walk from 'klaw'
import {
    ConfigService,
    fileUtil,
    Service,
    VanillaConfig,
} from '@spyglassmc/core'
import { NodeJsExternals } from '@spyglassmc/core/lib/nodejs.js'
import * as mcdoc from '@spyglassmc/mcdoc'

const cache_root = join(dirname(fileURLToPath(import.meta.url)), 'cache')

const project_path = resolve(process.cwd(), 'mcdoc')

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
        externals: NodeJsExternals,
        initializers: [mcdoc.initialize],
        projectRoot: fileUtil.ensureEndingSlash(
            pathToFileURL(project_path).toString(),
        ),
    },
})

await service.project.ready()
await service.project.cacheService.save()

const generated_path = 'types'

for await (const doc_file of walk(project_path)) {
    if (doc_file.path.endsWith('.mcdoc')) {
        const DocumentUri = pathToFileURL(doc_file.path).toString()

        const doc_contents = await fs.readFile(doc_file.path, 'utf-8')

        await service.project.onDidOpen(
            DocumentUri,
            'mcdoc',
            0,
            doc_contents,
        )

        await service.project.ensureClientManagedChecked(
            DocumentUri,
        )

        await service.project.ensureBindingStarted(
            DocumentUri,
        )
    }
}

function camel_case(name: string) {
    const words = name.split('_')
    if (words.length === 1) return name
    return words[0] + words
        .slice(1)
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join('')
}

const symbols = service.project.symbols.getVisibleSymbols('mcdoc')

const dispatchers = service.project.symbols.getVisibleSymbols('mcdoc/dispatcher')

const resources = dispatchers['minecraft:resource']!.members!

for await (const [resource_type, resource] of Object.entries(resources)) {
    const resource_path = resource.definition![0].uri.match(/mcdoc\/java\/(\w+)\//)![1]

    const pack_type = resource_path === 'data' ? 'datapack' : 'resourcepack'

    const type_path = join(generated_path, pack_type, `${camel_case(resource_type)}.ts`)

    const typeDef = (resource.data! as any).typeDef as mcdoc.McdocType

    Bun.write(type_path, `const original = ${JSON.stringify(typeDef, null, 4)}`)
}