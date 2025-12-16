import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '..'
import { Assert } from '../assert'
import { Bind } from '../bind'
import { add } from '../../../util'

const { factory } = ts

function DispatcherArgs(args: Record<string, unknown>): asserts args is {
    /**
     * Property keys to chain as indexed access types after the dispatcher access.
     * Used by the `indexed` type handler to access nested properties.
     *
     * Example: `['attribute_track']` results in `Dispatcher['registry'][K]['attribute_track']`
     */
    index_keys?: NonEmptyList<string>

    generic_types?: ts.TypeNode[]

    dispatcher_properties?: Map<string, { supports_none?: true }>

    root_type?: boolean
} {}

const SimpleKeyIndex = JSON.stringify([{
    kind: 'dynamic',
    accessor: [{
        keyword: 'key'
    }]
}])

const Fallback = Bind.StringLiteral('%fallback')
const None = Bind.StringLiteral('%none')

/**
 * Helper to create `Dispatcher<'registry', [args]>` type reference
 */
function DispatcherGeneric(registry: string, args: ts.TypeNode[]) {
    return factory.createTypeReferenceNode('Dispatcher', [
        Bind.StringLiteral(registry),
        factory.createTupleTypeNode(args)
    ])
}

/**
 * Helper to create `Dispatcher<'registry'>[Key]` - get map then index
 */
function DispatcherMapIndex(registry: string, key: ts.TypeNode, generics: ts.TypeNode[]) {
    return factory.createIndexedAccessTypeNode(
        factory.createTypeReferenceNode(
            'Dispatcher', 
            [
                Bind.StringLiteral(registry), 
                ...(generics.length === 0 ? [] : [factory.createTupleTypeNode(generics)])
            ]),
        key
    )
}

/**
 * Handles `dispatcher` types which reference a dispatcher symbol map.
 *
 * A dispatcher type has:
 * - `registry`: The dispatcher identifier (e.g., `minecraft:entity_effect`)
 * - `parallelIndices`: How to look up into the dispatcher (static or dynamic)
 *
 * The generated type references the central Dispatcher type:
 * - Static index: `Dispatcher<'minecraft:entity_effect'>['specific_key']`
 * - Dynamic index: `Dispatcher<'minecraft:entity_effect'>[Key]`
 * - Fallback: `Dispatcher<'minecraft:entity_effect', ['%fallback']>`
 * - None: `Dispatcher<'minecraft:entity_effect', ['%none']>`
 */
function mcdoc_dispatcher(type: mcdoc.McdocType) {
    Assert.DispatcherType(type)

    const dispatcher = type
    const registry = dispatcher.registry
    const indices = dispatcher.parallelIndices

    return (args: Record<string, unknown>) => {
        DispatcherArgs(args)

        // Import the central Dispatcher type
        const dispatcher_import = `::java::dispatcher::Dispatcher`

        let result_type: ts.TypeNode

        let child_dispatcher: NonEmptyList<[parent_count: number, property: string]> | undefined

        const generics = args.generic_types ?? []

        if (indices.length === 1 && indices[0].kind === 'dynamic' && typeof indices[0].accessor.at(-1) === 'string') {
            // If this is a root type, we can't use S (no generic parameter available)
            // Fall back to %fallback instead
            if (args.root_type) {
                // Result: Dispatcher<'registry', ['%fallback']>
                result_type = DispatcherGeneric(registry, [...generics, Fallback])
            } else {
                child_dispatcher = [[indices[0].accessor.length - 1, indices[0].accessor.at(-1) as string]]

                // Result: Dispatcher<'registry'>[S]
                const indexed_type = DispatcherMapIndex(registry, factory.createTypeReferenceNode('S'), generics)

                const properties = args.dispatcher_properties?.get(registry)
                if (properties?.supports_none) {
                    // Result: S extends undefined ? Dispatcher<'registry', ['%none']> : Dispatcher<'registry'>[S]
                    result_type = factory.createConditionalTypeNode(
                        factory.createTypeReferenceNode('S'),
                        factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword),
                        DispatcherGeneric(registry, [...generics, None]),
                        indexed_type
                    )
                } else {
                    // Result: Dispatcher<'registry'>[S]
                    result_type = indexed_type
                }
            }
        } else if (indices.length === 1 && indices[0].kind === 'static') {
            if (indices[0].value === '%fallback') {
                // Intentional fallback
                // Result: Dispatcher<'registry', ['%fallback']>
                result_type = DispatcherGeneric(registry, [...generics, Fallback])
            } else {
                // Result: Dispatcher<'registry'>['static_member']
                result_type = DispatcherMapIndex(registry, Bind.StringLiteral(indices[0].value), generics)
            }
        } else if (JSON.stringify(indices) === SimpleKeyIndex) {
            // Result: Dispatcher<'registry'>[Key]
            result_type = DispatcherMapIndex(registry, factory.createTypeReferenceNode('Key'), generics)
            // Result: Dispatcher<'registry'>[Key]['static_index']
            if (args.index_keys !== undefined) {
                for (const key of args.index_keys) {
                    result_type = factory.createIndexedAccessTypeNode(
                        result_type,
                        Bind.StringLiteral(key)
                    )
                }
            }
        } else {
            throw new Error(`[mcdoc_dispatcher] Unsupported dispatcher: ${dispatcher}`)
        }

        return {
            type: result_type,
            imports: {
                ordered: [dispatcher_import] as NonEmptyList<string>,
                check: new Map([[dispatcher_import, 0]]),
            },
            ...add({child_dispatcher})
        } as const
    }
}

export const McdocDispatcher = mcdoc_dispatcher satisfies TypeHandler
