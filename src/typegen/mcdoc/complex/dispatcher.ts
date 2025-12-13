import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '..'
import { Assert } from '../assert'
import { Bind } from '../bind'

const { factory } = ts

function DispatcherArgs(args: Record<string, unknown>): asserts args is {
    /**
     * Property keys to chain as indexed access types after the dispatcher access.
     * Used by the `indexed` type handler to access nested properties.
     *
     * Example: `['attribute_track']` results in `SymbolName[K]['attribute_track']`
     */
    index_keys?: NonEmptyList<string>

    generic_types?: ts.TypeNode[]

    dispatcher_properties?: Map<string, { supports_none?: true }>
} {}

const SimpleKeyIndex = JSON.stringify([{
    kind: 'dynamic',
    accessor: [{
        keyword: 'key'
    }]
}])

const SymbolMap = Bind.StringLiteral('map')
const Fallback = Bind.StringLiteral('%fallback')
const None = Bind.StringLiteral('%none')

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
 */
function mcdoc_dispatcher(type: mcdoc.McdocType) {
    Assert.DispatcherType(type)

    const dispatcher = type
    const registry = dispatcher.registry
    const indices = dispatcher.parallelIndices

    return (args: Record<string, unknown>) => {
        DispatcherArgs(args)

        const generics = args.generic_types === undefined ? [] : args.generic_types

        // TODO
        const symbol_name = 'ba'

        const symbol_import = `mcdoc.symbol::Symbolba`

        let result_type: ts.TypeNode

        let child_dispatcher: NonEmptyList<[parent_count: number, property: string]> | undefined

        if (indices.length === 1 && indices[0].kind === 'dynamic' && typeof indices[0].accessor.at(-1) === 'string') {
            child_dispatcher = [[indices[0].accessor.length - 1, indices[0].accessor.at(-1) as string]]

            const indexed_type = factory.createIndexedAccessTypeNode(
                factory.createTypeReferenceNode(
                    `Symbol${symbol_name}`,
                    args.generic_types === undefined ? undefined : generics
                ),
                factory.createTypeReferenceNode('S')
            )

            const properties = args.dispatcher_properties?.get(symbol_name)
            if (properties?.supports_none) {
                // Result: S extends undefined ? SymbolName<'%none'> : SymbolName[S]
                result_type = factory.createConditionalTypeNode(
                    factory.createTypeReferenceNode('S'),
                    factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword),
                    factory.createTypeReferenceNode(
                        `Symbol${symbol_name}`,
                        [...generics, None]
                    ),
                    indexed_type
                )
            } else {
                // Result: SymbolName[S]
                result_type = indexed_type
            }
        } else if (indices.length === 1 && indices[0].kind === 'static') {
            if (indices[0].value === '%fallback') {
                // Intentional fallback
                // Result: SymbolName<'%fallback'>
                result_type = factory.createTypeReferenceNode(
                    `Symbol${symbol_name}`,
                    [...generics, Fallback]
                )
            } else {
                // Result: SymbolName['static_member']
                result_type = factory.createIndexedAccessTypeNode(
                    factory.createTypeReferenceNode(
                        `Symbol${symbol_name}`,
                        args.generic_types
                    ),
                    Bind.StringLiteral(indices[0].value)
                )
            }
        } else if (JSON.stringify(indices) === SimpleKeyIndex) {
            // Result: SymbolName[K]
            result_type = factory.createIndexedAccessTypeNode(
                factory.createTypeReferenceNode(
                    `Symbol${symbol_name}`,
                    args.generic_types
                ),
                factory.createTypeReferenceNode('K')
            )
            // Result: SymbolName[K]['static_index']
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
                ordered: [symbol_import] as NonEmptyList<string>,
                check: new Map([[symbol_import, 0]]),
            },
            ...(child_dispatcher === undefined ? {} : { child_dispatcher })
        } as const
    }
}

export const McdocDispatcher = mcdoc_dispatcher satisfies TypeHandler
