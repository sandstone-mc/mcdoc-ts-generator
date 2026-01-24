import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '..'
import { Assert } from '../assert'
import type { DispatcherReferenceCounter } from '../dispatcher_symbol'
import type { SymbolMap } from '@spyglassmc/core'
import { enum_docs } from '../multi/enum'
import { add } from '../../../util'

const { factory } = ts

function ReferenceArgs(args: Record<string, unknown>): asserts args is ({
    dispatcher_symbol?: () => DispatcherReferenceCounter
    generic_types?: ts.TypeNode[]
    generics?: Set<string>
    module_path?: string
    module_map: SymbolMap
    spread?: true
}) {}

function mcdoc_reference(type: mcdoc.McdocType) {
    const reference = type
    Assert.ReferenceType(reference)

    return (args: Record<string, unknown>) => {
        ReferenceArgs(args)

        let import_path = reference.path

        // If the referenced type is itself a reference without attributes, follow the chain (one level).
        // This handles import-to-export type aliases that would otherwise point to non-existent types.
        const initial_peek = args.module_map[reference.path]?.data
        if (initial_peek !== undefined && initial_peek !== null && typeof initial_peek === 'object' && 'typeDef' in initial_peek) {
            const initial_type = initial_peek.typeDef as mcdoc.McdocType
            if (initial_type.kind === 'reference' && !('attributes' in initial_type && Array.isArray(initial_type.attributes) && initial_type.attributes.length > 0)) {
                import_path = (initial_type as { path: string }).path
            }
        }

        const type_name_point = import_path.lastIndexOf(':')
        const type_name = import_path.slice(type_name_point + 1)
        const base_path = import_path.slice(0, type_name_point - 1)

        if ('dispatcher_symbol' in args) {
            const dispatcher = args.dispatcher_symbol()
            const location_counts_index = dispatcher.locations.get(base_path)

            if (location_counts_index === undefined) {
                dispatcher.locations.set(base_path, dispatcher.location_counts.length)
                dispatcher.location_counts.push([base_path, 1])
            } else {
                dispatcher.location_counts[location_counts_index][1]++
            }
        }

        // Don't import modules that will end up in the same file
        const imports = args.module_path === base_path ? undefined : {
            ordered: [import_path] as NonEmptyList<string>,
            check: new Map([[import_path, 0]]) as Map<string, number>,
        } as const

        let docs: NonEmptyList<(string | [string])> | undefined

        let child_dispatcher: [[0, string]] | undefined

        let id_wrap = (ref: ts.TypeReferenceNode) => ref as (ts.TypeReferenceNode | ts.ParenthesizedTypeNode)

        const peek = args.module_map[import_path]?.data

        if (peek !== undefined && peek !== null && typeof peek === 'object' && 'typeDef' in peek) {
            const referenced_type = peek.typeDef as mcdoc.McdocType

            if (referenced_type.kind === 'enum') {
                docs = enum_docs(referenced_type) as NonEmptyList<string>

                if ('desc' in referenced_type && typeof referenced_type.desc === 'string') {
                    docs.push('', [referenced_type.desc])
                }
                if ('attributes' in type) {
                    Assert.Attributes(type.attributes, true)

                    if (type.attributes[0].name === 'id' && type.attributes[0].value === undefined) {
                        id_wrap = (ref: ts.TypeReferenceNode) => {
                            const id_ref = factory.createParenthesizedType(factory.createUnionTypeNode([
                                ref,
                                factory.createTemplateLiteralType(
                                    factory.createTemplateHead('minecraft:', 'minecraft:'),
                                    [factory.createTemplateLiteralTypeSpan(
                                        ref,
                                        factory.createTemplateTail('')
                                    )]
                                )
                            ]))
                            // lol
                            Object.assign(id_ref, {
                                '--mcdoc_id_ref': {
                                    ref,
                                    alt: factory.createParenthesizedType(factory.createUnionTypeNode([
                                        factory.createTypeReferenceNode('S'),
                                        factory.createTemplateLiteralType(
                                            factory.createTemplateHead('minecraft:', 'minecraft:'),
                                            [factory.createTemplateLiteralTypeSpan(
                                                factory.createTypeReferenceNode('S'),
                                                factory.createTemplateTail('')
                                            )]
                                        )
                                    ]))
                                }
                            })

                            return id_ref
                        }
                    }
                }
            } else if (referenced_type.kind === 'struct' && args.spread) {
                // extremely funny
                const generic_field = (referenced_type.fields.find(
                    (f) => f.type.kind === 'dispatcher' 
                    && f.type.parallelIndices[0].kind === 'dynamic' 
                    && typeof f.type.parallelIndices[0].accessor[0] === 'string' 
                    && ((key: string) => referenced_type.fields.findIndex((_f) => _f.kind === 'pair' && _f.key === key))(f.type.parallelIndices[0].accessor[0]) === -1
                ) as undefined | (mcdoc.StructFieldNode & { type: { kind: 'dispatcher', parallelIndices: [ { kind: 'dynamic', accessor: [string] } ] } }))?.type.parallelIndices[0].accessor[0]

                if (generic_field !== undefined) {
                    child_dispatcher = [[0, generic_field]]

                    args.generic_types = [factory.createTypeReferenceNode('S')]
                }
            } else if ('desc' in referenced_type && typeof referenced_type.desc === 'string') {
                docs = [[referenced_type.desc]]
            }
        }

        if ('generic_types' in args) {
            return {
                type: factory.createTypeReferenceNode(type_name, args.generic_types),
                ...add({imports, child_dispatcher, docs})
            } as const
        }
        if ('generics' in args && args.generics.has(reference.path)) {
            return {
                type: factory.createTypeReferenceNode(type_name),
                ...add({docs})
            } as const
        }
        return {
            type: id_wrap(factory.createTypeReferenceNode(type_name)),
            ...add({imports, child_dispatcher, docs})
        } as const
    }
}

export const McdocReference = mcdoc_reference satisfies TypeHandler