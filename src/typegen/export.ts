import { TaggableResourceLocationCategories } from '@spyglassmc/core'
import ts from 'typescript'
import { add_import, type NonEmptyList } from './mcdoc/utils'
import { add } from '../util'
import type { ResolvedRegistry, ResolvedSymbol } from '.'

const { factory } = ts

/**
 * Generates `export * from './...'` statements for all dispatcher symbol paths.
 * The export file will be at `::java::dispatcher` and export from all paths where dispatcher symbols are declared.
 */
export function export_dispatchers(paths: Set<string>): ResolvedSymbol {
    const exports: ts.ExportDeclaration[] = []

    for (const path of paths) {
        // Convert `::java::_dispatcher::entity_effect` to `./_dispatcher/entity_effect`
        const relative_path = './' + path.split('::').slice(2).join('/')

        exports.push(factory.createExportDeclaration(
            undefined,
            false,
            undefined,
            factory.createStringLiteral(relative_path, true)
        ))
    }

    return {
        exports: exports as unknown as ResolvedSymbol['exports'],
        paths: new Set<string>(),
    }
}

export function export_registry(resolved_registries: Map<string, ResolvedRegistry>) {
    let imports: undefined | { readonly ordered: NonEmptyList<string>, readonly check: Map<string, number> }

    // Add imports for Set and SetType from sandstone
    imports = add_import(imports, 'sandstone::Set')
    imports = add_import(imports, 'sandstone::SetType')

    // Build property signatures for each registry
    const properties: ts.TypeElement[] = []

    for (const [registry_name, { import_path, registry }] of resolved_registries) {
        // Add import for the registry symbol
        imports = add_import(imports, import_path)

        const registry_id = registry_name.includes(':') ? registry_name : `minecraft:${registry_name}`

        properties.push(factory.createPropertySignature(
            undefined,
            factory.createStringLiteral(registry_id),
            undefined,
            factory.createTypeReferenceNode(registry)
        ))
    }

    // Create: export type Registry = { ... }
    const registry_type = factory.createTypeAliasDeclaration(
        [factory.createToken(ts.SyntaxKind.ExportKeyword)],
        'Registry',
        undefined,
        factory.createTypeLiteralNode(properties)
    )

    // Create: export const REGISTRIES_SET = new Set([...] as const)
    const registries_set = factory.createVariableStatement(
        [factory.createToken(ts.SyntaxKind.ExportKeyword)],
        factory.createVariableDeclarationList(
            [factory.createVariableDeclaration(
                'REGISTRIES_SET',
                undefined,
                undefined,
                factory.createNewExpression(
                    factory.createIdentifier('Set'),
                    undefined,
                    [factory.createAsExpression(
                        factory.createArrayLiteralExpression(
                            TaggableResourceLocationCategories.map((category) =>
                                factory.createStringLiteral(category, true)
                            ),
                            true
                        ),
                        factory.createTypeReferenceNode('const')
                    )]
                )
            )],
            ts.NodeFlags.Const
        )
    )

    // Create: export type REGISTRIES = SetType<typeof REGISTRIES_SET>
    const registries_type = factory.createTypeAliasDeclaration(
        [factory.createToken(ts.SyntaxKind.ExportKeyword)],
        'REGISTRIES',
        undefined,
        factory.createTypeReferenceNode(
            'SetType',
            [factory.createTypeQueryNode(factory.createIdentifier('REGISTRIES_SET'))]
        )
    )

    return {
        exports: [registry_type, registries_set, registries_type] as (ts.TypeAliasDeclaration | ts.VariableStatement)[],
        paths: new Set<string>(),
        ...add({imports})
    } as const
}
