import { promises as fs } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

import walk from 'klaw'
import ts from 'typescript'
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

    const file = `const original = ${JSON.stringify(typeDef, null, 4)}`

    const resourceId = ts.factory.createIdentifier(resource_type.replaceAll('/', '_'))

    if (typeDef.kind === 'struct') {
        const members: readonly ts.TypeElement[] = typeDef.fields.filter((field) => field.kind === 'pair' && typeof field.key === 'string').map((_field) => {
            const field = _field as mcdoc.StructTypePairField

            const node = ts.factory.createTypeReferenceNode(
                ts.factory.createQualifiedName(
                    resourceId,
                    ts.factory.createIdentifier(camel_case(field.key as string))
                )
            )

            return {
                ...ts.factory.createTypeAliasDeclaration(
                    undefined,
                    field.key as string,
                    undefined,
                    field.optional ? ts.factory.createOptionalTypeNode(node) : node,
                ),
                _typeElementBrand: undefined,
            }
        })

        const resourceType = ts.factory.createMappedTypeNode(
            undefined,
            ts.factory.createTypeParameterDeclaration(
                undefined,
                resourceId,
                undefined,
                undefined
            ),
            undefined,
            undefined,
            undefined,
            ts.factory.createNodeArray(
                members,
                true
            )
        )

        function print(nodes: any[]) {
            const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
            const resultFile = ts.createSourceFile(
              "temp.ts",
              "",
              ts.ScriptTarget.Latest,
              false,
              ts.ScriptKind.TS
            );

            console.log(printer.printList(ts.ListFormat.MultiLine, nodes as unknown as ts.NodeArray<ts.Node>, resultFile));
          }
          
          print([resourceType]);
    }

    Bun.write(type_path, file)
}