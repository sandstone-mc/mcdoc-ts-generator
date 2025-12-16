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
 * Handles `dispatcher` types which reference a dispatcher symbol map.
 *
 * A dispatcher type has:
 * - `registry`: The dispatcher identifier (e.g., `minecraft:entity_effect`)
 * - `parallelIndices`: How to look up into the dispatcher (static or dynamic)
 *
 * The generated type references the central Dispatcher type with indexed access:
 * - Static index: `Dispatcher['minecraft:entity_effect']['specific_key']`
 * - Dynamic index: `Dispatcher['minecraft:entity_effect'][K]`
 * - Fallback: `Dispatcher['minecraft:entity_effect']['%fallback']`
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

        // Base type: Dispatcher['minecraft:entity_effect'] (indexed access into Dispatcher)
        const base_dispatcher_type = factory.createIndexedAccessTypeNode(
            factory.createTypeReferenceNode('Dispatcher'),
            Bind.StringLiteral(registry)
        )

        if (indices.length === 1 && indices[0].kind === 'dynamic' && typeof indices[0].accessor.at(-1) === 'string') {
            // If this is a root type, we can't use S (no generic parameter available)
            // Fall back to %fallback instead
            if (args.root_type) {
                // Result: Dispatcher['registry']['%fallback']
                result_type = factory.createIndexedAccessTypeNode(
                    base_dispatcher_type,
                    Fallback
                )
            } else {
                child_dispatcher = [[indices[0].accessor.length - 1, indices[0].accessor.at(-1) as string]]

                // Result: Dispatcher['registry'][S]
                const indexed_type = factory.createIndexedAccessTypeNode(
                    base_dispatcher_type,
                    factory.createTypeReferenceNode('S')
                )

                const properties = args.dispatcher_properties?.get(registry)
                if (properties?.supports_none) {
                    // Result: S extends undefined ? Dispatcher['registry']['%none'] : Dispatcher['registry'][S]
                    result_type = factory.createConditionalTypeNode(
                        factory.createTypeReferenceNode('S'),
                        factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword),
                        factory.createIndexedAccessTypeNode(
                            base_dispatcher_type,
                            None
                        ),
                        indexed_type
                    )
                } else {
                    // Result: Dispatcher['registry'][S]
                    result_type = indexed_type
                }
            }
        } else if (indices.length === 1 && indices[0].kind === 'static') {
            if (indices[0].value === '%fallback') {
                // Intentional fallback
                // Result: Dispatcher['registry']['%fallback']
                result_type = factory.createIndexedAccessTypeNode(
                    base_dispatcher_type,
                    Fallback
                )
            } else {
                // Result: Dispatcher['registry']['static_member']
                result_type = factory.createIndexedAccessTypeNode(
                    base_dispatcher_type,
                    Bind.StringLiteral(indices[0].value)
                )
            }
        } else if (JSON.stringify(indices) === SimpleKeyIndex) {
            // Result: Dispatcher['registry'][K]
            result_type = factory.createIndexedAccessTypeNode(
                base_dispatcher_type,
                factory.createTypeReferenceNode('K')
            )
            // Result: Dispatcher['registry'][K]['static_index']
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
