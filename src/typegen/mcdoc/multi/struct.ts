import ts from 'typescript'
import { match, P } from 'ts-pattern'
import * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList, type TypeHandler } from '..'
import { Assert } from '../assert'
import { add_import, merge_imports } from '../utils'

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
                    match(pair.key.kind)
                        .with('reference', 'concrete', () => {
                            inherit.push({
                                type: factory.createParenthesizedType(factory.createMappedTypeNode(
                                    undefined,
                                    factory.createTypeParameterDeclaration(
                                        undefined,
                                        factory.createIdentifier('K')
                                    ),
                                    key.type, // TODO handle #[id] attribute
                                    factory.createToken(ts.SyntaxKind.QuestionToken),
                                    value.type, // TODO K is assumed, McdocConcrete will know to use it from the passed pair.key
                                    undefined
                                ))
                            })
                        })
                        .with('string', () => {
                            if (pair.key.attributes === undefined) {
                                inherit.push({
                                    type: factory.createTypeReferenceNode(
                                        factory.createIdentifier('Record'),
                                        [
                                            factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword), // TODO lengthRange support
                                            value.type
                                        ]
                                    )
                                })
                            } else {
                                Assert.Attributes(pair.key.attributes, true)

                                // There's only ever one attribute
                                const attribute = pair.key.attributes[0]

                                switch (attribute.name) {
                                    case 'id': {
                                        const id_attr = attribute.value

                                        let registry_id: string
                                        if (id_attr === undefined) {
                                            throw new Error()
                                        }
                                        if (id_attr.kind === 'literal') {
                                            registry_id = id_attr.value.value
                                        } else {
                                            registry_id = id_attr.values.registry.value.value
                                        }
                                        // TODO: this is using the old symbol naming/import system
                                        const registry_name = registry_id.replace(/\//g, '_').toUpperCase() + 'S'
                                        const import_path = `registries/${registry_id}.ts`

                                        has_imports = true
                                        if (!imports.check.has(import_path)) {
                                            add_import(imports, import_path)
                                        }

                                        inherit.push({
                                            type: factory.createParenthesizedType(factory.createMappedTypeNode(
                                                undefined,
                                                factory.createTypeParameterDeclaration(
                                                    undefined,
                                                    factory.createIdentifier('K'),
                                                    factory.createTypeReferenceNode(
                                                        factory.createIdentifier(registry_name),
                                                        undefined
                                                    ),
                                                    undefined
                                                ),
                                                undefined,
                                                factory.createToken(ts.SyntaxKind.QuestionToken),
                                                value.type,
                                                undefined
                                            ))
                                        })
                                        break
                                    }
                                    case 'permutation': {
                                        // TODO: Implement permutation attribute
                                        // For now, fall back to Record<string, value>
                                        inherit.push({
                                            type: factory.createTypeReferenceNode(
                                                factory.createIdentifier('Record'),
                                                [
                                                    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                                    value.type
                                                ]
                                            )
                                        })
                                        break
                                    }
                                    case 'item_slots': {
                                        // TODO: Implement item_slots attribute
                                        // For now, fall back to Record<string, value>
                                        inherit.push({
                                            type: factory.createTypeReferenceNode(
                                                factory.createIdentifier('Record'),
                                                [
                                                    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                                    value.type
                                                ]
                                            )
                                        })
                                        break
                                    }
                                    case 'texture_slot': {
                                        // TODO: Implement texture_slot attribute
                                        // For now, fall back to Record<string, value>
                                        inherit.push({
                                            type: factory.createTypeReferenceNode(
                                                factory.createIdentifier('Record'),
                                                [
                                                    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                                    value.type
                                                ]
                                            )
                                        })
                                        break
                                    }
                                    case 'translation_key': {
                                        // TODO: Implement translation_key attribute
                                        // For now, fall back to Record<string, value>
                                        inherit.push({
                                            type: factory.createTypeReferenceNode(
                                                factory.createIdentifier('Record'),
                                                [
                                                    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                                    value.type
                                                ]
                                            )
                                        })
                                        break
                                    }
                                    case 'criterion': {
                                        // TODO: Implement criterion attribute
                                        // For now, fall back to Record<string, value>
                                        inherit.push({
                                            type: factory.createTypeReferenceNode(
                                                factory.createIdentifier('Record'),
                                                [
                                                    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                                    value.type
                                                ]
                                            )
                                        })
                                        break
                                    }
                                    case 'crafting_ingredient': {
                                        // TODO: Implement crafting_ingredient attribute
                                        // For now, fall back to Record<string, value>
                                        inherit.push({
                                            type: factory.createTypeReferenceNode(
                                                factory.createIdentifier('Record'),
                                                [
                                                    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                                    value.type
                                                ]
                                            )
                                        })
                                        break
                                    }
                                    case 'objective': {
                                        // TODO: Implement objective attribute
                                        // For now, fall back to Record<string, value>
                                        inherit.push({
                                            type: factory.createTypeReferenceNode(
                                                factory.createIdentifier('Record'),
                                                [
                                                    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                                    value.type
                                                ]
                                            )
                                        })
                                        break
                                    }
                                    case 'dispatcher_key': {
                                        // TODO: Implement dispatcher_key attribute
                                        // For now, fall back to Record<string, value>
                                        inherit.push({
                                            type: factory.createTypeReferenceNode(
                                                factory.createIdentifier('Record'),
                                                [
                                                    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                                    value.type
                                                ]
                                            )
                                        })
                                        break
                                    }
                                    default: {
                                        throw new Error()
                                    }
                                }
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