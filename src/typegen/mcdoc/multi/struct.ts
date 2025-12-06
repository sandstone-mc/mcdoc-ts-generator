import ts from 'typescript'
import { match, P } from 'ts-pattern'
import * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList, type TypeHandler } from '..'
import { Assert, type ImplementedAttributeType } from '../assert'
import { merge_imports } from '../utils'

const { factory } = ts

const FieldProperties = {
    optional: P.optional(P.boolean),
    deprecated: P.optional(P.boolean),
    desc: P.optional(P.string),
    attributes: P.optional(P.when((attributes): attributes is mcdoc.Attributes => Array.isArray(attributes))),
}

type ResolvedSpreadType = ReturnType<ReturnType<(typeof TypeHandlers[('reference' | 'dispatcher' | 'concrete' | 'template')])>>

type ResolvedIndexSignatureType = { type: ts.ParenthesizedTypeNode | ts.TypeReferenceNode }

type StructIntersection = ResolvedSpreadType | ResolvedIndexSignatureType

function mcdoc_struct(type: mcdoc.McdocType) {
    const struct = type
    Assert.StructType(struct)

    return (...args: unknown[]) => {
        let has_imports = false
        const imports = {
            ordered: [] as unknown as NonEmptyList<string>,
            check: new Map<string, number>(),
        } as const

        const members: ts.PropertySignature[] = []

        const inherit: StructIntersection[] = []

        let pair_inserted = false

        const merge: StructIntersection[] = []

        let child_dispatcher: 'keyed' | 'self_reference' | undefined

        for (const field of struct.fields) {
            let unsupported = false

            if (field.attributes !== undefined) {
                Assert.Attributes(field.attributes, true)

                const attributes = field.attributes

                for (const attribute of attributes) {
                    if (attribute.name === 'until' || attribute.name === 'deprecated') {
                        unsupported = true
                        break
                    }
                }
            }
            if (unsupported) {
                continue
            }

            match(field)
                .with({ kind: 'pair', key: P.string, ...FieldProperties }, (pair) => {
                    const value = TypeHandlers[pair.type.kind](pair.type)([pair.key, ...args])

                    if ('imports' in value) {
                        has_imports = true
                        merge_imports(imports, value.imports)
                    }
                    if ('child_dispatcher' in value) {
                        child_dispatcher = value.child_dispatcher as 'self_reference'
                    }

                    members.push(factory.createPropertySignature(
                        undefined,
                        factory.createIdentifier(pair.key),
                        pair.optional ? factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
                        value.type,
                    ))

                    pair_inserted = true
                }).narrow()
                .with({ kind: 'pair' }, (pair) => {
                    Assert.StructKeyType(pair.key)
                    const key = TypeHandlers[pair.key.kind](pair.key)(...args)
                    const value = TypeHandlers[pair.type.kind](pair.type)({ dynamic_key: pair.key, ...(args[0] as any)})

                    if ('imports' in key) {
                        has_imports = true
                        merge_imports(imports, key.imports)
                    }
                    if ('imports' in value) {
                        has_imports = true
                        merge_imports(imports, value.imports)
                    }
                    if ('child_dispatcher' in key) {
                        child_dispatcher = key.child_dispatcher as 'self_reference'
                    }
                    match(pair.key.kind)
                        .with('reference', 'concrete', () => {
                            inherit.push({
                                type: factory.createParenthesizedType(factory.createMappedTypeNode(
                                    undefined,
                                    factory.createTypeParameterDeclaration(
                                        undefined,
                                        factory.createIdentifier('K')
                                    ),
                                    key.type,
                                    factory.createToken(ts.SyntaxKind.QuestionToken),
                                    value.type, // TODO K is assumed, McdocConcrete will know to use it from the passed pair.key
                                    undefined
                                ))
                            })
                        })
                        .with('string', () => {
                            const string_key = key as ReturnType<ReturnType<typeof TypeHandlers['string']>>

                            if (pair.key.attributes === undefined) {
                                // I think this is actually in a few places
                            } else {
                                Assert.Attributes(pair.key.attributes, true)

                                // TODO: handle id, permutation, texture_slot, item_slots, translation_key, crafting_ingredient, objective, dispatcher_key
                            }
                        })
                    
                })
                .with({ kind: 'spread' }, (_spread) => {
                    Assert.StructSpreadType(_spread.type)
                    const spread = TypeHandlers[_spread.type.kind](_spread.type)(...args)

                    if ('imports' in spread) {
                        has_imports = true
                        merge_imports(imports, spread.imports)
                    }
                    if ('child_dispatcher' in spread) {
                        child_dispatcher = spread.child_dispatcher as typeof child_dispatcher
                    }
                    if (pair_inserted) {
                        merge.push(spread)
                    } else {
                        inherit.push(spread)
                    }
                })
        }

        if (inherit.length === 0 && merge.length === 0) {
            return {
                type: factory.createTypeLiteralNode(members),
                ...(has_imports ? { imports } : {}),
                ...(child_dispatcher !== undefined ? { child_dispatcher } : {}),
            }
        } else {
            if (pair_inserted === false) {
                if (inherit.length === 1 && merge.length === 0) {
                    return {
                        type: inherit[0].type,
                        ...(has_imports ? { imports } : {}),
                        ...(child_dispatcher !== undefined ? { child_dispatcher } : {}),
                    }
                }
                return {
                    type: factory.createParenthesizedType(
                        factory.createIntersectionTypeNode([
                            ...inherit.map(i => i.type),
                            ...merge.map(i => i.type),
                        ])
                    ),
                    ...(has_imports ? { imports } : {}),
                    ...(child_dispatcher !== undefined ? { child_dispatcher } : {}),
                }
            } else {
                return {
                    type: factory.createParenthesizedType(
                        factory.createIntersectionTypeNode([
                            ...inherit.map(i => i.type),
                            factory.createTypeLiteralNode(members),
                            ...merge.map(i => i.type),
                        ])
                    ),
                    ...(has_imports ? { imports } : {}),
                    ...(child_dispatcher !== undefined ? { child_dispatcher } : {}),
                }
            }
        }
    }
}

function dispatcher_value(dispatcher: mcdoc.DispatcherType) {

}

export const McdocStruct = mcdoc_struct satisfies TypeHandler