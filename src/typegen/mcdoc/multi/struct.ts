import ts from 'typescript'
import { match, P } from 'ts-pattern'
import * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList, type TypeHandler } from '..'
import { Assert } from '../assert'
import { add_import, merge_imports } from '../utils'
import { pascal_case } from '../../../util'
import { Bind } from '../bind'

const { factory } = ts

/**
 * Validates and extracts struct args from the unknown TypeHandler args.
 */
function StructArgs(args: Record<string, unknown>): asserts args is {
    root_type: boolean,
    name: string,
    spread?: true
} {}

const FieldProperties = {
    optional: P.optional(P.boolean),
    deprecated: P.optional(P.boolean),
    desc: P.optional(P.string),
    attributes: P.optional(P.when((attributes): attributes is mcdoc.Attributes => Array.isArray(attributes))),
}

type ResolvedSpreadType = ReturnType<ReturnType<(typeof TypeHandlers[('reference' | 'dispatcher' | 'concrete' | 'template')])>>['type']

type ResolvedIndexSignatureType = ts.ParenthesizedTypeNode | ts.TypeReferenceNode

type StructIntersection = ResolvedSpreadType | ResolvedIndexSignatureType

function mcdoc_struct(type: mcdoc.McdocType) {
    const struct = type
    Assert.StructType(struct)

    return (args: Record<string, unknown>) => {
        StructArgs(args)

        const { name } = args

        const spread = args.spread ? true : false
        const root_type = args.root_type ? true : false

        delete args.spread
        args.root_type = false

        let has_imports = false
        const imports = {
            ordered: [] as unknown as NonEmptyList<string>,
            check: new Map<string, number>(),
        } as const

        const pair_indices: Record<string, number> = {}
        const pairs: ts.PropertySignature[] = []

        const inherit: StructIntersection[] = []

        let pair_inserted = false

        const merge: StructIntersection[] = []

        let child_dispatcher: NonEmptyList<[parent_count: number, property: string]> | undefined

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
                    const value = TypeHandlers[pair.type.kind](pair.type)({ ...args, name: `${name}${pascal_case(pair.key)}` })

                    if ('imports' in value) {
                        has_imports = true
                        merge_imports(imports, value.imports)
                    }
                    if ('child_dispatcher' in value) {
                        if (child_dispatcher === undefined) {
                            child_dispatcher = [] as unknown as typeof child_dispatcher
                        }
                        child_dispatcher!.push(...(value.child_dispatcher as NonEmptyList<[number, string]>))
                    }
                    let has_docs = false
                    const field_docs = [] as unknown as NonEmptyList<string | [string]>

                    if ('desc' in pair && typeof pair.desc === 'string') {
                        has_docs = true
                        field_docs.push([pair.desc])
                    }

                    if ('docs' in value) {
                        if (has_docs) {
                            field_docs.push('')
                        }
                        has_docs = true
                        field_docs.push('Value:', ...value.docs)
                    }

                    pair_indices[pair.key] = pairs.length
                    pairs.push(Bind.Doc(factory.createPropertySignature(
                        undefined,
                        pair.key,
                        pair.optional ? factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
                        value.type,
                    ), has_docs ? field_docs : undefined))

                    pair_inserted = true
                }).narrow()
                .with({ kind: 'pair' }, (pair) => {
                    Assert.StructKeyType(pair.key)

                    const value = TypeHandlers[pair.type.kind](pair.type)({ ...args, name: `${name}IndexSignature` })

                    if ('imports' in value) {
                        has_imports = true
                        merge_imports(imports, value.imports)
                    }
                    if ('child_dispatcher' in value) {
                        if (child_dispatcher === undefined) {
                            child_dispatcher = [] as unknown as typeof child_dispatcher
                        }
                        child_dispatcher!.push(...(value.child_dispatcher as NonEmptyList<[number, string]>))
                    }
                    match(pair.key.kind)
                        .with('reference', 'concrete', (kind) => {
                            const key = TypeHandlers[kind](pair.key)(args)

                            if ('imports' in key) {
                                has_imports = true
                                merge_imports(imports, key.imports)
                            }
                            inherit.push(factory.createParenthesizedType(factory.createMappedTypeNode(
                                undefined,
                                factory.createTypeParameterDeclaration(
                                    undefined,
                                    factory.createIdentifier('K')
                                ),
                                key.type,
                                factory.createToken(ts.SyntaxKind.QuestionToken),
                                value.type, // TODO K is assumed, McdocConcrete will know to use it from the passed pair.key
                                undefined
                            )))
                        })
                        .with('string', () => {
                            if (pair.key.attributes === undefined) {
                                Assert.StringType(pair.key)
                                inherit.push(factory.createTypeReferenceNode('Record', [
                                    ((('lengthRange' in pair.key && 'min' in pair.key.lengthRange) ? pair.key.lengthRange.min : 0) >= 1 ? 
                                        Bind.NonEmptyString
                                        : factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)
                                    ),
                                    value.type
                                ]))
                            } else {
                                Assert.Attributes(pair.key.attributes, true)

                                // There's only ever one attribute
                                const attribute = pair.key.attributes[0]

                                // TODO: Implement non-empty string types here
                                match(attribute)
                                    .with({ name: 'id' }, (attr) => {
                                        const id_attr = attr.value

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
                                        const import_path = `mcdoc.Symbol::${registry_name}`

                                        has_imports = true
                                        if (!imports.check.has(import_path)) {
                                            add_import(imports, import_path)
                                        }

                                        // TODO: Handle #[id()] key arguments; path, exclude, and prefix="!"
                                        inherit.push(factory.createParenthesizedType(factory.createMappedTypeNode(
                                            undefined,
                                            factory.createTypeParameterDeclaration(
                                                undefined,
                                                'K',
                                                factory.createTypeReferenceNode(registry_name)
                                            ),
                                            undefined,
                                            factory.createToken(ts.SyntaxKind.QuestionToken),
                                            value.type, // K is assumed
                                            undefined
                                        )))
                                    })
                                    .with({ name: 'item_slots' }, () => {
                                        const ITEM_SLOTS = 'ITEM_SLOTS'
                                        const LiteralUnion = 'LiteralUnion'
                                        add_import(imports, `sandstone::arguments::${ITEM_SLOTS}`)
                                        add_import(imports, `sandstone::${LiteralUnion}`)

                                        inherit.push(factory.createTypeReferenceNode('Record', [
                                            factory.createTypeReferenceNode(LiteralUnion, [
                                                factory.createTypeReferenceNode(ITEM_SLOTS)
                                            ]),
                                            value.type
                                        ]))
                                    })
                                    .with({ name: 'objective' }, () => {
                                        const Objective = 'ObjectiveClass'
                                        add_import(imports, `sandstone::${Objective}`)

                                        inherit.push(factory.createTypeReferenceNode('Record', [
                                            factory.createUnionTypeNode([
                                                factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                                factory.createTypeReferenceNode(Objective)
                                            ]),
                                            value.type
                                        ]))
                                    })
                                    .with({ name: 'texture_slot' }, () => {
                                        // TODO: Implement Model struct generic, this is `kind="definition"`
                                        inherit.push(factory.createTypeReferenceNode('Record', [
                                            factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                            value.type
                                        ]))
                                    })
                                    .with({ name: 'criterion' }, () => {
                                        // TODO: Implement Advancement struct generic, this is `definition=true`
                                        inherit.push(factory.createTypeReferenceNode('Record', [
                                            factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                            value.type
                                        ]))
                                    })
                                    .with({ name: 'crafting_ingredient' }, () => {
                                        // TODO: Implement CraftingShaped struct generic, this is `definition=true`
                                        const CRAFTING_INGREDIENT = 'CRAFTING_INGREDIENT'
                                        add_import(imports, `sandstone::arguments::${CRAFTING_INGREDIENT}`) // 'A' | 'B' | 'C' ...

                                        inherit.push(factory.createTypeReferenceNode('Record', [
                                                factory.createTypeReferenceNode(CRAFTING_INGREDIENT),
                                                value.type
                                            ]))
                                    })
                                    .with({ name: P.union('dispatcher_key', 'translation_key', 'permutation') }, () => {
                                        // Permutation will be implemented as an abstracted mode of the Atlas class
                                        inherit.push(factory.createTypeReferenceNode('Record', [
                                            factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                            value.type
                                        ]))
                                    })
                                    .otherwise(() => {
                                        throw new Error(`[mcdoc_struct] Unsupported dynamic key attribute: ${attribute}`)
                                    })
                            }
                        })
                    
                })
                .with({ kind: 'spread' }, (_spread) => {
                    Assert.StructSpreadType(_spread.type)
                    const spread = TypeHandlers[_spread.type.kind](_spread.type)({ spread: true, ...args })

                    if ('imports' in spread) {
                        has_imports = true
                        merge_imports(imports, spread.imports)
                    }
                    if ('child_dispatcher' in spread) {
                        if (child_dispatcher === undefined) {
                            child_dispatcher = [] as unknown as typeof child_dispatcher
                        }
                        child_dispatcher!.push(...(spread.child_dispatcher as NonEmptyList<[number, string]>))
                    }
                    if (pair_inserted) {
                        merge.push(spread.type)
                    } else {
                        inherit.push(spread.type)
                    }
                })
        }

        let inner_type: ts.TypeLiteralNode | ts.ParenthesizedTypeNode | StructIntersection | ts.TypeReferenceNode

        let indexed_access: string | undefined
        let indexed_access_type: ts.TypeNode | undefined
        let template = (type_node: typeof inner_type) => (type_node as ts.TypeAliasDeclaration | typeof inner_type)

        if (child_dispatcher !== undefined && spread === false) {
            const new_list = child_dispatcher.flatMap(([parent_count, property]) => {
                if (parent_count === 0) {
                    indexed_access = property
                    const generic_prop = pair_indices[indexed_access]

                    if (generic_prop === undefined) {
                        return []
                        throw new Error(`[mcdoc_struct] Received an invalid dynamic dispatcher trying to access '${property}'`)
                    }

                    indexed_access_type = pairs[generic_prop].type

                    // yes this is cursed
                    if ('--mcdoc_id_ref' in indexed_access_type!) {
                        const id_ref = indexed_access_type['--mcdoc_id_ref'] as { ref: ts.TypeReferenceNode, alt: ts.ParenthesizedTypeNode }
                        // @ts-ignore
                        pairs[generic_prop].type = id_ref.alt
                        indexed_access_type = id_ref.ref
                    } else {
                        // @ts-ignore
                        pairs[generic_prop].type = factory.createTypeReferenceNode('S')
                    }
                    return []
                }
                if (root_type) {
                    template = (type_node: typeof inner_type) => factory.createTypeAliasDeclaration(
                        [factory.createToken(ts.SyntaxKind.ExportKeyword)],
                        args.name,
                        [factory.createTypeParameterDeclaration(undefined, 'S')],
                        type_node
                    )
                }
                return [[parent_count - 1, property]]
            })
            child_dispatcher = new_list.length === 0 ? undefined : (new_list as typeof child_dispatcher)
        }

        const types = [...inherit]
        if (pair_inserted) {
            types.push(factory.createTypeLiteralNode(pairs))
        }
        types.push(...merge)

        if (types.length === 1) {
            inner_type = types[0]
        } else if (types.length > 1) {
            inner_type = factory.createParenthesizedType(factory.createIntersectionTypeNode(types))
        } else {
            inner_type = Bind.EmptyObject
        }

        if (indexed_access === undefined) {
            return {
                type: template(inner_type),
                ...(has_imports ? { imports } : {}),
                ...(child_dispatcher === undefined ? {} : { child_dispatcher }),
            }
        } else {
            return {
                type: template(factory.createParenthesizedType(factory.createIndexedAccessTypeNode(
                    factory.createMappedTypeNode(
                        undefined,
                        factory.createTypeParameterDeclaration(
                            undefined,
                            'S',
                            indexed_access_type!,
                        ),
                        undefined,
                        undefined,
                        inner_type,
                        undefined
                    ),
                    indexed_access_type!
                ))),
                ...(has_imports ? { imports } : {}),
                ...(child_dispatcher === undefined ? {} : { child_dispatcher }),
            }
        }
    }
}

export const McdocStruct = mcdoc_struct satisfies TypeHandler