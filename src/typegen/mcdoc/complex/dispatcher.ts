import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '..'
import { Assert } from '../assert'
import { dispatcher_registry_map } from '../../symbols'
import { Bind } from '../bind'

const { factory } = ts

/**
 * Arguments that can be passed to the dispatcher handler.
 */
export type DispatcherArgs = {
    /**
     * Property keys to chain as indexed access types after the dispatcher access.
     * Used by the `indexed` type handler to access nested properties.
     *
     * Example: `['attribute_track']` results in `SymbolName[K]['attribute_track']`
     */
    index_keys?: NonEmptyList<string>
}

/**
 * Validates and extracts dispatcher args from the unknown args.
 */
function parse_dispatcher_args(args: Record<string, unknown>): DispatcherArgs {
    const result: DispatcherArgs = {}

    if ('index_keys' in args) {
        const index_keys = args.index_keys
        if (!Array.isArray(index_keys)) {
            throw new Error(`[mcdoc_dispatcher] index_keys must be an array`)
        }
        for (const key of index_keys) {
            if (typeof key !== 'string') {
                throw new Error(`[mcdoc_dispatcher] index_keys must contain only strings, got: ${typeof key}`)
            }
        }
        result.index_keys = index_keys as NonEmptyList<string>
    }

    return result
}

const SimpleKeyIndex = JSON.stringify({
    kind: 'dynamic',
    accessor: [{
        keyword: 'key'
    }]
})

const Fallback = Bind.StringLiteral('%fallback')

/**
 * Handles `dispatcher` types which reference a dispatcher symbol map.
 *
 * A dispatcher type has:
 * - `registry`: The dispatcher identifier (e.g., `minecraft:block`)
 * - `parallelIndices`: How to look up into the dispatcher (static or dynamic)
 *
 * The generated type references the dispatcher symbol map. When the index is static,
 * we can use the specific key type. When dynamic (e.g., `%key`), we use a type
 * parameter `K` to represent the key.
 *
 * Accepts optional `dispatcher_args` to chain additional property accesses:
 * - `index_keys`: Property names to access on the dispatcher result
 */
function mcdoc_dispatcher(type: mcdoc.McdocType) {
    Assert.DispatcherType(type)

    const dispatcher = type
    const registry = dispatcher.registry
    const indices = dispatcher.parallelIndices

    return (args: Record<string, unknown>) => {
        const dispatcher_args = parse_dispatcher_args(args)

        // Look up symbol name from registry
        const symbol_name = dispatcher_registry_map.get(registry)
        if (symbol_name === undefined) {
            throw new Error(`[mcdoc_dispatcher] Unknown dispatcher registry: ${registry}`)
        }

        const symbol_import = `mcdoc.symbol::Symbol${symbol_name}`

        let result_type: ts.TypeNode

        let child_dispatcher: NonEmptyList<[parent_count: number, property: string]> | undefined

        if (indices.length === 1 && indices[0].kind === 'dynamic' && indices[0].accessor.length === 1 && typeof indices[0].accessor[0] === 'string') {
            child_dispatcher = [[0, indices[0].accessor[0]]]
            // Result: SymbolName[S]
            result_type = factory.createIndexedAccessTypeNode(
                factory.createTypeReferenceNode(`Symbol${symbol_name}`),
                factory.createTypeReferenceNode('S')
            )
        } else if (indices.length === 1 && indices[0].kind === 'static') {
            if (indices[0].value === '%fallback') {
                // Intentional fallback
                // Result: SymbolName<'%fallback'>
                result_type = factory.createTypeReferenceNode(
                    `Symbol${symbol_name}`,
                    [Fallback]
                )
            } else {
                // Result: SymbolName['static_member']
                result_type = factory.createIndexedAccessTypeNode(
                    factory.createTypeReferenceNode(`Symbol${symbol_name}`),
                    Bind.StringLiteral(indices[0].value)
                )
            }
        } else if (JSON.stringify(indices) === SimpleKeyIndex) {
            // Result: SymbolName[K]
            result_type = factory.createIndexedAccessTypeNode(
                factory.createTypeReferenceNode(`Symbol${symbol_name}`),
                factory.createTypeReferenceNode('K')
            )
            // Result: SymbolName[K]['static_index']
            if (dispatcher_args.index_keys !== undefined) {
                for (const key of dispatcher_args.index_keys) {
                    result_type = factory.createIndexedAccessTypeNode(
                        result_type,
                        Bind.StringLiteral(key)
                    )
                }
            }
        } else if (indices.length === 1 && indices[0].kind === 'dynamic' && indices[0].accessor.length > 1 && typeof indices[0].accessor.at(-1) === 'string') {
            child_dispatcher = [[
                indices[0].accessor.length - 1,
                indices[0].accessor.at(-1) as string
            ]]
            // Result: SymbolName<'%fallback'>
            result_type = factory.createTypeReferenceNode(
                `Symbol${symbol_name}`,
                [Fallback]
            )
        } else {
            throw new Error(`[mcdoc_dispatcher] Unsupported dispatcher: ${dispatcher}`)
        }

        return {
            type: result_type,
            imports: {
                ordered: [symbol_import] as NonEmptyList<string>,
                check: new Map([[symbol_import, 0]]),
            },
            ...(child_dispatcher === undefined ? {} : { child_dispatcher })
        } as const
    }
}

export const McdocDispatcher = mcdoc_dispatcher satisfies TypeHandler
