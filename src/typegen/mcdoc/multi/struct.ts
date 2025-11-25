import ts from 'typescript'
import { match, P } from 'ts-pattern'
import * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList, type TypeHandler } from '..'
import { Assert } from '../assert'
import { merge_imports } from '../utils'

const { factory } = ts

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

        const field_properties = {
            optional: P.optional(P.boolean),
            deprecated: P.optional(P.boolean),
            desc: P.optional(P.string),
            attributes: P.optional(P.when((attributes): attributes is mcdoc.Attributes => Array.isArray(attributes))),
        }

        const members: ts.PropertySignature[] = []

        const inherit: StructIntersection[] = []

        let pair_inserted = false

        const merge: StructIntersection[] = []

        for (const field of struct.fields) {
            if (field.attributes?.indexOf((attr: mcdoc.Attribute) => attr.name === 'until') !== -1) {
                continue
            }
            match(field)
                .with({ kind: 'pair', key: P.string, ...field_properties }, (pair) => {
                    const value = TypeHandlers[pair.type.kind](pair.type)([pair.key, ...args])

                    if ('imports' in value && value.imports !== undefined) {
                        has_imports = true
                        merge_imports(imports, value.imports)
                    }
                    members.push(factory.createPropertySignature(
                        undefined,
                        factory.createIdentifier(pair.key),
                        pair.optional ? factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
                        value.type,
                    ))
                }).narrow()
                .with({ kind: 'pair' }, (pair) => {
                    Assert.StructKeyType(pair.key)
                    const key = TypeHandlers[pair.key.kind](pair.key)([...args])
                    const value = TypeHandlers[pair.type.kind](pair.type)([pair.key, ...args])

                    if ('imports' in key) {
                        has_imports = true
                        merge_imports(imports, key.imports)
                    }
                    if ('imports' in value && value.imports !== undefined) {
                        has_imports = true
                        merge_imports(imports, value.imports)
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
                                    value.type, // K is assumed, McdocConcrete will know to use it from the passed pair.key
                                    undefined
                                ))
                            })
                        })
                        .with('string', () => {
                            const string_key = key as ReturnType<ReturnType<typeof TypeHandlers['string']>>

                            // TODO: handle dispatchers
                        })
                })
                .with({ kind: 'spread' }, (_spread) => {
                    Assert.StructSpreadType(_spread.type)
                    const spread = TypeHandlers[_spread.type.kind](_spread.type)(...args)

                    if ('imports' in spread) {
                        has_imports = true
                        merge_imports(imports, spread.imports)
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
            }
        } else {
            if (pair_inserted === false) {
                if (inherit.length === 1 && merge.length === 0) {
                    return {
                        type: inherit[0].type,
                        ...(has_imports ? { imports } : {})
                    }
                }
                return {
                    type: factory.createParenthesizedType(
                        factory.createIntersectionTypeNode([
                            ...inherit.map(i => i.type),
                            ...merge.map(i => i.type),
                        ])
                    ),
                    ...(has_imports ? { imports } : {})
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
                    ...(has_imports ? { imports } : {})
                }
            }
        }
    }
}

export const McdocStruct = mcdoc_struct satisfies TypeHandler