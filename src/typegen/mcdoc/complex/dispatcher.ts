import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '..'
import { Assert } from '../assert'
import { dispatcher_registry_map } from '../../symbols'

const { factory } = ts

/**
 * Handles `dispatcher` types which reference a dispatcher symbol map.
 *
 * A dispatcher type has:
 * - `registry`: The dispatcher identifier (e.g., `minecraft:block`)
 * - `parallelIndices`: How to look up into the dispatcher (static or dynamic)
 *
 * The generated type references the dispatcher symbol map. When the index is static,
 * we can use the specific key type. When dynamic, we use the fallback type.
 */
function mcdoc_dispatcher(type: mcdoc.McdocType) {
    Assert.DispatcherType(type)

    const dispatcher = type
    const registry = dispatcher.registry
    const indices = dispatcher.parallelIndices

    return (...args: unknown[]) => {
        // Look up symbol name from registry
        const symbol_name = dispatcher_registry_map.get(registry)
        if (symbol_name === undefined) {
            throw new Error(`[mcdoc_dispatcher] Unknown dispatcher registry: ${registry}`)
        }

        const symbol_import = `mcdoc.symbol::Symbol${symbol_name}`

        // Determine the CASE generic based on parallelIndices
        let case_type: ts.TypeNode

        if (indices.length === 0) {
            // No indices - use fallback type
            case_type = factory.createLiteralTypeNode(
                factory.createStringLiteral('%fallback', true)
            )
        } else if (indices.length === 1 && indices[0].kind === 'static') {
            // Single static index - use the map and access by key
            const static_index = indices[0]

            // Return indexed access type: SymbolName['map']['static_value']
            return {
                type: factory.createIndexedAccessTypeNode(
                    factory.createIndexedAccessTypeNode(
                        factory.createTypeReferenceNode(`Symbol${symbol_name}`),
                        factory.createLiteralTypeNode(
                            factory.createStringLiteral('map', true)
                        )
                    ),
                    factory.createLiteralTypeNode(
                        factory.createStringLiteral(static_index.value, true)
                    )
                ),
                imports: {
                    ordered: [symbol_import] as NonEmptyList<string>,
                    check: new Map([[symbol_import, 0]]),
                },
            } as const
        } else {
            // Dynamic index or multiple indices - use fallback
            case_type = factory.createLiteralTypeNode(
                factory.createStringLiteral('%fallback', true)
            )
        }

        // Return type reference with CASE generic
        return {
            type: factory.createTypeReferenceNode(
                `Symbol${symbol_name}`,
                [case_type]
            ),
            imports: {
                ordered: [symbol_import] as NonEmptyList<string>,
                check: new Map([[symbol_import, 0]]),
            },
        } as const
    }
}

export const McdocDispatcher = mcdoc_dispatcher satisfies TypeHandler
