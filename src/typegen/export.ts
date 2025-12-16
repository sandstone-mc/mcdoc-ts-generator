import ts from 'typescript'
import { add_import, type NonEmptyList } from './mcdoc/utils'
import { add } from '../util'
import type { ResolvedDispatcher, ResolvedRegistry } from '.'
import { Bind } from './mcdoc/bind'

const { factory } = ts

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

    for (const [registry_name, { import_path, registry }] of resolved_registries) {
        // Add import for the registry symbol
        imports = add_import(imports, import_path)

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
 * Generates a `Dispatcher` type system with type-safe generic enforcement.
 *
 * Example output:
 * ```ts
 * interface DispatcherRequiredArgs {
 *   'minecraft:data_component': []
 *   'minecraft:entity_effect': [unknown]
 * }
 * type DefaultArgs<R extends keyof DispatcherRequiredArgs> = ...
 * type ApplyDispatcher<R, Args> = ...
 * export type Dispatcher<R, Args> = ApplyDispatcher<R, Args>
 * ```
 */
export function export_dispatcher(resolved_dispatchers: Map<string, ResolvedDispatcher>) {
    let imports: undefined | { readonly ordered: NonEmptyList<string>, readonly check: Map<string, number> }

    // Build DispatcherRequiredArgs interface properties
    const required_args_properties: ts.PropertySignature[] = []

    for (const [dispatcher_id, { import_path, generic_count }] of resolved_dispatchers) {
        imports = add_import(imports, import_path)

        // Create tuple type: [] for 0 generics, [unknown] for 1, [unknown, unknown] for 2, etc.
        const tuple_elements: ts.TypeNode[] = []
        for (let i = 0; i < generic_count; i++) {
            tuple_elements.push(factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword))
        }

        required_args_properties.push(factory.createPropertySignature(
            undefined,
            factory.createStringLiteral(dispatcher_id, true),
            undefined,
            factory.createTupleTypeNode(tuple_elements)
        ))
    }

    // type DispatcherRequiredArgs = { ... }
    const required_args_type = factory.createTypeAliasDeclaration(
        undefined,
        'DispatcherRequiredArgs',
        undefined,
        factory.createTypeLiteralNode(required_args_properties)
    )

    // type DefaultArgs<R extends keyof DispatcherRequiredArgs> =
    //   DispatcherRequiredArgs[R] extends [] ? [] : [RequiresArgs]
    const default_args_type = factory.createTypeAliasDeclaration(
        undefined,
        'DefaultArgs',
        [factory.createTypeParameterDeclaration(
            undefined,
            'R',
            factory.createTypeOperatorNode(
                ts.SyntaxKind.KeyOfKeyword,
                factory.createTypeReferenceNode('DispatcherRequiredArgs')
            )
        )],
        factory.createConditionalTypeNode(
            factory.createIndexedAccessTypeNode(
                factory.createIndexedAccessTypeNode(
                factory.createTypeReferenceNode('DispatcherRequiredArgs'),
                factory.createTypeReferenceNode('R')
                ),
                Bind.StringLiteral('length')
            ),
            Bind.NumericLiteral(0),
            factory.createTupleTypeNode([]),
            factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
        )
    )

    // Build ApplyDispatcher conditional type
    // Group dispatchers by generic_count for cleaner organization
    const dispatchers_by_count = new Map<number, [string, ResolvedDispatcher][]>()
    for (const [id, dispatcher] of resolved_dispatchers) {
        const count = dispatcher.generic_count
        if (!dispatchers_by_count.has(count)) {
            dispatchers_by_count.set(count, [])
        }
        dispatchers_by_count.get(count)!.push([id, dispatcher])
    }

    // Build the nested conditional for ApplyDispatcher
    // Start from the innermost (never) and work outward
    let apply_dispatcher_body: ts.TypeNode = factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)

    // Sort by count descending so we build inner-to-outer
    const sorted_counts = [...dispatchers_by_count.keys()].sort((a, b) => b - a)

    for (const count of sorted_counts) {
        const dispatchers = dispatchers_by_count.get(count)!

        for (const [dispatcher_id, { symbol_name }] of dispatchers) {
            // Build the inner conditional for this dispatcher's cases
            // innermost: never
            // then: Args extends [...] ? Symbol<..., 'map'> : never
            // then: Args extends [..., '%none'] ? Symbol<..., '%none'> : (previous)
            // then: Args extends [..., '%fallback'] ? Symbol<..., '%fallback'> : (previous)

            // Create type parameter names: A, B, C, D for up to 4 generics
            const param_names = ['A', 'B', 'C', 'D'].slice(0, count)

            // Build infer patterns and type references for this count
            const infer_params = param_names.map(name =>
                factory.createInferTypeNode(factory.createTypeParameterDeclaration(undefined, name))
            )
            const type_refs = param_names.map(name => factory.createTypeReferenceNode(name))

            // Case: Args extends [infer A, infer B, ...] ? Symbol<A, B, 'map'> : never
            const map_case = factory.createConditionalTypeNode(
                factory.createTypeReferenceNode('Args'),
                factory.createTupleTypeNode(infer_params),
                factory.createTypeReferenceNode(symbol_name, [...type_refs, Bind.StringLiteral('map')]),
                factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
            )

            // Case: Args extends [infer A, ..., '%none'] ? Symbol<A, ..., '%none'> : (map_case)
            const none_case = factory.createConditionalTypeNode(
                factory.createTypeReferenceNode('Args'),
                factory.createTupleTypeNode([...infer_params, Bind.StringLiteral('%none')]),
                factory.createTypeReferenceNode(symbol_name, [...type_refs, Bind.StringLiteral('%none')]),
                map_case
            )

            // Case: Args extends [infer A, ..., '%fallback'] ? Symbol<A, ..., '%fallback'> : (none_case)
            const fallback_case = factory.createConditionalTypeNode(
                factory.createTypeReferenceNode('Args'),
                factory.createTupleTypeNode([...infer_params, Bind.StringLiteral('%fallback')]),
                factory.createTypeReferenceNode(symbol_name, [...type_refs, Bind.StringLiteral('%fallback')]),
                none_case
            )

            // Wrap in: R extends 'dispatcher_id' ? (fallback_case) : (previous)
            apply_dispatcher_body = factory.createConditionalTypeNode(
                factory.createTypeReferenceNode('R'),
                Bind.StringLiteral(dispatcher_id),
                fallback_case,
                apply_dispatcher_body
            )
        }
    }

    // type ApplyDispatcher<R extends keyof DispatcherRequiredArgs, Args extends unknown[]> = ...
    const apply_dispatcher_type = factory.createTypeAliasDeclaration(
        undefined,
        'ApplyDispatcher',
        [
            factory.createTypeParameterDeclaration(
                undefined,
                'R',
                factory.createTypeOperatorNode(
                    ts.SyntaxKind.KeyOfKeyword,
                    factory.createTypeReferenceNode('DispatcherRequiredArgs')
                )
            ),
            factory.createTypeParameterDeclaration(
                undefined,
                'Args',
                factory.createTypeReferenceNode('Array', [
                    factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
                ])
            )
        ],
        apply_dispatcher_body
    )

    // Simplified constraint - ApplyDispatcher handles validation by returning never for invalid args
    const args_constraint = factory.createTypeReferenceNode('Array', [
        factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
    ])

    // export type Dispatcher<R, Args> = ApplyDispatcher<R, Args>
    const dispatcher_type = factory.createTypeAliasDeclaration(
        [factory.createToken(ts.SyntaxKind.ExportKeyword)],
        'Dispatcher',
        [
            factory.createTypeParameterDeclaration(
                undefined,
                'R',
                factory.createTypeOperatorNode(
                    ts.SyntaxKind.KeyOfKeyword,
                    factory.createTypeReferenceNode('DispatcherRequiredArgs')
                )
            ),
            factory.createTypeParameterDeclaration(
                undefined,
                'Args',
                args_constraint,
                factory.createTypeReferenceNode('DefaultArgs', [factory.createTypeReferenceNode('R')])
            )
        ],
        factory.createTypeReferenceNode('ApplyDispatcher', [
            factory.createTypeReferenceNode('R'),
            factory.createTypeReferenceNode('Args')
        ])
    )

    return {
        exports: [
            required_args_type,
            default_args_type,
            apply_dispatcher_type,
            dispatcher_type
        ] as ts.TypeAliasDeclaration[],
        paths: new Set<string>(),
        ...add({imports})
    } as const
}
