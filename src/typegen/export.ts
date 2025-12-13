import ts from 'typescript'
import { add_import, type NonEmptyList } from './mcdoc/utils'
import { add } from '../util'

const { factory } = ts

type ResolvedRegistry = {
    symbol_path: string,
    registry: ts.Identifier
}

type ResolvedDispatcher = {
    symbol_path: string,
    type: ts.TypeNode
}

/**
 * Generates a `Registry` type that maps registry IDs to their element types.
 *
 * Example output:
 * ```ts
 * export type Registry = {
 *   'minecraft:block': typeof BLOCKS extends Set<infer T> ? T : never,
 *   'minecraft:item': typeof ITEMS extends Set<infer T> ? T : never,
 * }
 * ```
 */
export function export_registry(resolved_registries: Map<string, ResolvedRegistry>) {
    let imports: undefined | { readonly ordered: NonEmptyList<string>, readonly check: Map<string, number> }

    // Build property signatures for each registry
    const properties: ts.TypeElement[] = []

    for (const [registry_name, { symbol_path, registry }] of resolved_registries) {
        // Add import for the registry symbol
        add_import(imports, symbol_path)

        // Create: 'minecraft:block': typeof BLOCKS extends Set<infer T> ? T : never
        const registry_id = registry_name.includes(':') ? registry_name : `minecraft:${registry_name}`

        properties.push(factory.createPropertySignature(
            undefined,
            factory.createStringLiteral(registry_id),
            undefined,
            // typeof BLOCKS extends Set<infer T> ? T : never
            factory.createConditionalTypeNode(
                factory.createTypeQueryNode(registry),
                factory.createTypeReferenceNode('Set', [
                    factory.createInferTypeNode(
                        factory.createTypeParameterDeclaration(undefined, 'T')
                    )
                ]),
                factory.createTypeReferenceNode('T'),
                factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
            )
        ))
    }

    // Create: export type Registry = { ... }
    const registry_type = factory.createTypeAliasDeclaration(
        [factory.createToken(ts.SyntaxKind.ExportKeyword)],
        'Registry',
        undefined,
        factory.createTypeLiteralNode(properties)
    )

    return {
        exports: [registry_type] as ts.TypeAliasDeclaration[],
        paths: new Set<string>(),
        ...add({imports})
    } as const
}

/**
 * Generates a `Dispatcher` type that maps dispatcher IDs to their types.
 *
 * Example output:
 * ```ts
 * export type Dispatcher = {
 *   'minecraft:entity_effect': EntityEffectDispatcher,
 *   'minecraft:block': BlockDispatcher,
 * }
 * ```
 */
export function export_dispatcher(resolved_dispatchers: Map<string, ResolvedDispatcher>) {
    let imports: undefined | { readonly ordered: NonEmptyList<string>, readonly check: Map<string, number> }

    // Build property signatures for each dispatcher
    const properties: ts.TypeElement[] = []

    for (const [dispatcher_id, { symbol_path, type }] of resolved_dispatchers) {
        // Add import for the dispatcher symbol
        add_import(imports, symbol_path)

        // Create: 'minecraft:entity_effect': EntityEffectDispatcher
        properties.push(factory.createPropertySignature(
            undefined,
            factory.createStringLiteral(dispatcher_id),
            undefined,
            type
        ))
    }

    // Create: export type Dispatcher = { ... }
    const dispatcher_type = factory.createTypeAliasDeclaration(
        [factory.createToken(ts.SyntaxKind.ExportKeyword)],
        'Dispatcher',
        undefined,
        factory.createTypeLiteralNode(properties)
    )

    return {
        exports: [dispatcher_type] as ts.TypeAliasDeclaration[],
        paths: new Set<string>(),
        ...add({imports})
    } as const
}
