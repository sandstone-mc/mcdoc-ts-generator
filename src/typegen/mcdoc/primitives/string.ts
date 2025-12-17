import ts from 'typescript'
import { match, P } from 'ts-pattern'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '..'
import { Assert } from '../assert'
import { Bind } from '../bind'
import { add_import } from '../utils'

const { factory } = ts

const StringKeyword = factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)

const static_value = {
    normal: {
        type: StringKeyword
    },
    not_empty: factory.createTemplateLiteralType(
        factory.createTemplateHead(''),
        [
            factory.createTemplateLiteralTypeSpan(
                factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                factory.createTemplateMiddle('')
            ),
            factory.createTemplateLiteralTypeSpan(
                StringKeyword,
                factory.createTemplateTail('')
            )
        ]
    ),
    namespaced_tag: {
        type: factory.createTemplateLiteralType(
            factory.createTemplateHead('#'),
            [
                factory.createTemplateLiteralTypeSpan(
                    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                    factory.createTemplateMiddle(':')
                ),
                factory.createTemplateLiteralTypeSpan(
                    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                    factory.createTemplateTail('')
                )
            ]
        )
    },
    namespaced: {
        type: factory.createTemplateLiteralType(
            factory.createTemplateHead(''),
            [
                factory.createTemplateLiteralTypeSpan(
                    StringKeyword,
                    factory.createTemplateMiddle(':')
                ),
                factory.createTemplateLiteralTypeSpan(
                    StringKeyword,
                    factory.createTemplateTail('')
                )
            ]
        )
    },
    hash: {
        type: factory.createTemplateLiteralType(
            factory.createTemplateHead('#'),
            [factory.createTemplateLiteralTypeSpan(
                factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                factory.createTemplateTail('')
            )]
        )
    },
    number: {
        type: factory.createTemplateLiteralType(
            factory.createTemplateHead(''),
            [factory.createTemplateLiteralTypeSpan(
                factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
                factory.createTemplateTail('')
            )]
        )
    },
    time: {
        type: factory.createParenthesizedType(factory.createUnionTypeNode([
            factory.createTemplateLiteralType(
                factory.createTemplateHead(''),
                [
                    factory.createTemplateLiteralTypeSpan(
                        factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
                        factory.createTemplateMiddle('-')
                    ),
                    factory.createTemplateLiteralTypeSpan(
                        factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
                        factory.createTemplateMiddle('-')
                    ),
                    factory.createTemplateLiteralTypeSpan(
                        factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
                        factory.createTemplateTail('')
                    )
                ]
            ),
            factory.createTemplateLiteralType(
                factory.createTemplateHead(''),
                [
                    factory.createTemplateLiteralTypeSpan(
                        factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
                        factory.createTemplateMiddle(':')
                    ),
                    factory.createTemplateLiteralTypeSpan(
                        factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
                        factory.createTemplateMiddle(':')
                    ),
                    factory.createTemplateLiteralTypeSpan(
                        factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
                        factory.createTemplateTail('')
                    )
                ]
            )
        ]))
    }
} as const

const ResourceClasses = {
    'minecraft:advancement': 'AdvancementClass',
    'minecraft:function': '_RawFunctionClass'
    // TODO: IMPORTANT - List out all sandstone resource classes
} as const

/**
 * This only handles strings as value types, not struct keys
 */
function mcdoc_string(type: mcdoc.McdocType) {
    const string = type
    Assert.StringType(string)

    if (string.attributes === undefined && string.lengthRange === undefined) {
        return (args: Record<string, unknown>) => static_value.normal
    } else if (string.attributes === undefined) {
        return (args: Record<string, unknown>) => ({
            type: static_value.not_empty,
            docs: [`String length range: ${mcdoc.NumericRange.toString(string.lengthRange!)}`] as NonEmptyList<string>,
        } as const)
    } else {
        Assert.Attributes(string.attributes, true)

        // Note: if `#[canonical]` ever gets used on a string, this implementation will need some work
        const attribute = string.attributes.find((attr) => attr.name !== 'since' && attr.name !== 'until')

        return match(attribute)
            .with(P.nullish, () => {
                return (args: Record<string, unknown>) => static_value.normal
            })
            .with({ name: 'id', value: P.optional(P.nullish) }, () => {
                // #[id] string
                return (args: Record<string, unknown>) => static_value.namespaced
            })
            .with({ name: 'id', value: P.nonNullable }, ({ value }) => {
                const id_attr = value

                let registry_id: string

                let exclude = (reg: ts.TypeNode) => reg

                let Resource: string | (() => string | undefined) | undefined = () => registry_id in ResourceClasses ? ResourceClasses[registry_id as keyof typeof ResourceClasses] : undefined

                const registry_import = `::java::_registry::Registry`

                const extras: ts.TypeNode[] = []

                const imports = {
                    ordered: [registry_import] as NonEmptyList<string>,
                    check: new Map([[registry_import, 0]])
                } as const

                if (id_attr.kind === 'literal') {
                    registry_id = `minecraft:${id_attr.value.value}`
                } else {
                    registry_id = `minecraft:${id_attr.values.registry.value.value}`

                    if ('path' in id_attr.values) {
                        return (args: Record<string, unknown>) => ({
                            type: static_value.namespaced.type,
                            docs: ['', `Value: A ${registry_id} ID within a path root of \`(namespace)/textures/${id_attr.values.path!.value.value}\``]
                        } as const)
                    }
                    if ('definition' in id_attr.values) {
                        return (args: Record<string, unknown>) => ({
                            type: static_value.namespaced.type,
                            docs: ['', `Value: Defines a \`${registry_id}\` id.`] as NonEmptyList<string>
                        } as const)
                    }
                    if ('exclude' in id_attr.values) {
                        exclude = (reg: ts.TypeNode) => factory.createTypeReferenceNode('Exclude', [
                            reg,
                            factory.createParenthesizedType(factory.createUnionTypeNode(
                                Object.values(id_attr.values.exclude!.values).map((literal) => Bind.StringLiteral(literal.value.value))
                            ))
                        ])
                    }
                    if ('tags' in id_attr.values) {
                        const Tag = 'TagClass'

                        switch (id_attr.values.tags.value.value) {
                            case 'allowed': {
                                extras.push(
                                    factory.createTemplateLiteralType(
                                        factory.createTemplateHead('#'),
                                        [factory.createTemplateLiteralTypeSpan(
                                            factory.createIndexedAccessTypeNode(
                                                factory.createTypeReferenceNode('Registry'),
                                                Bind.StringLiteral(registry_id.replace(':', ':tag/'))
                                            ),
                                            factory.createTemplateTail('')
                                        )]
                                    ),
                                    factory.createTypeReferenceNode(
                                        Tag,
                                        [Bind.StringLiteral(registry_id.split(':')[1])]
                                    ),
                                    static_value.namespaced_tag.type
                                )
                                add_import(imports, `sandstone::${Tag}`)
                            } break
                            case 'implicit': {
                                return (args: Record<string, unknown>) => ({
                                    type: factory.createParenthesizedType(factory.createUnionTypeNode([
                                        factory.createIndexedAccessTypeNode(
                                            factory.createTypeReferenceNode('Registry'),
                                            Bind.StringLiteral(registry_id.replace(':', ':tag/'))
                                        ),
                                        static_value.namespaced.type
                                    ])),
                                    imports
                                } as const)
                            } break
                            case 'required': {
                                add_import(imports, 'sandstone::TagClass')
                                return (args: Record<string, unknown>) => ({
                                    type: factory.createParenthesizedType(factory.createUnionTypeNode([
                                        factory.createTemplateLiteralType(
                                            factory.createTemplateHead('#'),
                                            [factory.createTemplateLiteralTypeSpan(
                                                factory.createIndexedAccessTypeNode(
                                                    factory.createTypeReferenceNode('Registry'),
                                                    Bind.StringLiteral(registry_id.replace(':', ':tag/'))
                                                ),
                                                factory.createTemplateTail('')
                                            )]
                                        ),
                                        factory.createTypeReferenceNode(
                                            Tag,
                                            [Bind.StringLiteral(registry_id.split(':')[1])]
                                        ),
                                        static_value.namespaced.type
                                    ])),
                                    imports
                                } as const)
                            } break
                        }
                    }
                    if ('empty' in id_attr.values) {
                        extras.push(Bind.StringLiteral(''))
                    }
                    if ('prefix' in id_attr.values) {
                        throw new Error('[mcdoc_string] ID prefix is not currently supported as a value')
                    }
                }

                Resource = Resource()
                
                if (Resource !== undefined) {
                    extras.push(factory.createTypeReferenceNode(Resource))
                    add_import(imports, `sandstone::${Resource}`)
                }

                return (args: Record<string, unknown>) => ({
                    type: factory.createParenthesizedType(factory.createUnionTypeNode([
                        exclude(factory.createIndexedAccessTypeNode(
                            factory.createTypeReferenceNode('Registry'),
                            Bind.StringLiteral(registry_id)
                        )),
                        static_value.namespaced.type,
                        ...extras
                    ])),
                    imports
                } as const)
            }).narrow()
            .with({ name: 'color' }, ({ value: { value: { value } } }) => {
                Assert.ColorStringType(value)
                // TODO: Implement color abstraction in Sandstone
                return (args: Record<string, unknown>) => static_value.hash
            })
            .with({ name: 'command' }, ({ value: { values } }) => {
                // TODO: Implement anonymous command in Sandstone
                return (args: Record<string, unknown>) => ({ type: static_value.not_empty } as const)
            })
            .with({ name: 'crafting_ingredient' }, () => {
                // TODO: Implement CraftingShaped struct generic
                return (args: Record<string, unknown>) => ({ type: static_value.not_empty } as const)
            })
            .with({ name: 'criterion', value: P.optional(P.nullish) }, () => {
                // TODO: Implement Advancement generics
                return (args: Record<string, unknown>) => ({ type: static_value.not_empty } as const)
            })
            .with({ name: 'entity' }, ({ value }) => {
                let Target = 'SingleEntityArgument'

                if (value === undefined || (value.values.amount?.value.value !== 'single' && value.values.type?.value.value !== 'players')) {
                    Target = 'MultipleEntitiesArgument'
                } else if (value.values.amount?.value.value !== 'single' && value.values.type?.value.value === 'players') {
                    Target = 'MultiplePlayersArgument'
                } else if (value.values.amount?.value.value === 'single' && value.values.type?.value.value === 'players') {
                    Target = 'SinglePlayerArgument'
                }
                return (args: Record<string, unknown>) => ({
                    type: factory.createTypeReferenceNode(Target),
                    imports: {
                        ordered: [`sandstone::arguments::${Target}`] as NonEmptyList<string>,
                        check: new Map([[`sandstone::arguments::${Target}`, 0]])
                    }
                } as const)
            })
            .with({ name: 'integer' }, () => {
                return (args: Record<string, unknown>) => static_value.number
            })
            .with({ name: 'item_slots' }, () => {
                const ITEM_SLOTS = 'ITEM_SLOTS'
                const LiteralUnion = 'LiteralUnion'

                return (args: Record<string, unknown>) => ({
                    type: factory.createTypeReferenceNode(LiteralUnion, [
                        factory.createTypeReferenceNode(ITEM_SLOTS)
                    ]),
                    imports: {
                        ordered: [`sandstone::arguments::${ITEM_SLOTS}`, `sandstone::${LiteralUnion}`] as NonEmptyList<string>,
                        check: new Map([[`sandstone::arguments::${ITEM_SLOTS}`, 0], [`sandstone::${LiteralUnion}`, 1]])
                    }
                } as const)
            })
            .with({ name: 'nbt' }, ({ value }) => {
                // TODO: Add strict typing to NBT in Sandstone
                const NBT = 'NBTClass'
                return (args: Record<string, unknown>) => ({
                    type: factory.createUnionTypeNode([
                        static_value.not_empty,
                        factory.createTypeReferenceNode(NBT)
                    ]),
                    imports: {
                        ordered: [`sandstone::${NBT}`] as NonEmptyList<string>,
                        check: new Map([[`sandstone::${NBT}`, 0]])
                    }
                } as const)
            })
            .with({ name: 'nbt_path' }, ({ value }) => {
                // TODO: Add strict typing to DataPoint in Sandstone
                const DataPoint = 'DataPointClass'
                return (args: Record<string, unknown>) => ({
                    type: factory.createUnionTypeNode([
                        static_value.not_empty,
                        factory.createTypeReferenceNode(DataPoint)
                    ]),
                    imports: {
                        ordered: [`sandstone::${DataPoint}`] as NonEmptyList<string>,
                        check: new Map([[`sandstone::${DataPoint}`, 0]])
                    }
                } as const)
            })
            .with({ name: 'match_regex' }, ({ value: { value: { value } } }) => {
                return (args: Record<string, unknown>) => ({
                    type: static_value.not_empty,
                    docs: [`Must match regex of ${value}`] as NonEmptyList<string>
                } as const)
            })
            .with({ name: 'objective' }, () => {
                const Objective = 'ObjectiveClass'
                return (args: Record<string, unknown>) => ({
                    type: factory.createUnionTypeNode([
                        static_value.not_empty,
                        factory.createTypeReferenceNode(Objective)
                    ]),
                    imports: {
                        ordered: [`sandstone::${Objective}`] as NonEmptyList<string>,
                        check: new Map([[`sandstone::${Objective}`, 0]])
                    }
                } as const)
            })
            .with({ name: 'regex_pattern' }, () => {
                return (args: Record<string, unknown>) => ({
                    type: factory.createUnionTypeNode([
                        static_value.not_empty,
                        factory.createTypeReferenceNode('RegExp')
                    ]),
                } as const)
            })
            .with({ name: 'score_holder' }, () => {
                const Score = 'ScoreClass'
                return (args: Record<string, unknown>) => ({
                    type: factory.createUnionTypeNode([
                        static_value.not_empty,
                        factory.createTypeReferenceNode(Score)
                    ]),
                    imports: {
                        ordered: [`sandstone::${Score}`] as NonEmptyList<string>,
                        check: new Map([[`sandstone::${Score}`, 0]])
                    }
                } as const)
            })
            .with({ name: 'tag' }, () => {
                const Label = 'LabelClass'
                return (args: Record<string, unknown>) => ({
                    type: factory.createUnionTypeNode([
                        static_value.not_empty,
                        factory.createTypeReferenceNode(Label)
                    ]),
                    imports: {
                        ordered: [`sandstone::${Label}`] as NonEmptyList<string>,
                        check: new Map([[`sandstone::${Label}`, 0]])
                    }
                } as const)
            })
            .with({ name: 'team' }, () => {
                // TODO: Implement team abstraction in Sandstone
                return (args: Record<string, unknown>) => ({ type: static_value.not_empty } as const)
            })
            .with({ name: 'text_component' }, () => {
                // This has been phased out by mojang
                return (args: Record<string, unknown>) => ({ type: static_value.not_empty } as const)
            })
            .with({ name: 'texture_slot' }, ({ value: { values: { kind: { value: { value } } } } }) => {
                const Texture = 'TextureClass'
                // TODO: Implement Model struct generic, this is `kind="value"` or `kind="reference"`

                if (value === 'reference') {
                    return (args: Record<string, unknown>) => static_value.hash
                }

                return (args: Record<string, unknown>) => ({
                    type: factory.createUnionTypeNode([
                        static_value.not_empty,
                        static_value.hash.type,
                        factory.createTypeReferenceNode(Texture)
                    ]),
                    imports: {
                        ordered: [`sandstone::${Texture}`] as NonEmptyList<string>,
                        check: new Map([[`sandstone::${Texture}`, 0]])
                    }
                } as const)
            })
            .with({ name: 'time_pattern' }, () => {
                return (args: Record<string, unknown>) => static_value.time
            })
            .with({ name: 'translation_key' }, () => {
                // TODO: Add translation key abstraction in Sandstone
                const TRANSLATION_KEYS = 'TRANSLATION_KEYS'
                const LiteralUnion = 'LiteralUnion'

                return (args: Record<string, unknown>) => ({
                    type: factory.createTypeReferenceNode(LiteralUnion, [
                        factory.createTypeReferenceNode(TRANSLATION_KEYS)
                    ]),
                    imports: {
                        ordered: [`sandstone::arguments::${TRANSLATION_KEYS}`, `sandstone::${LiteralUnion}`] as NonEmptyList<string>,
                        check: new Map([[`sandstone::arguments::${TRANSLATION_KEYS}`, 0], [`sandstone::${LiteralUnion}`, 1]])
                    }
                } as const)
            })
            .with({ name: 'translation_value' }, () => {
                // TODO: Add translation value abstraction in Sandstone
                return (args: Record<string, unknown>) => static_value.normal
            })
            .with({ name: 'url' }, () => {
                return (args: Record<string, unknown>) => ({
                    type: factory.createUnionTypeNode([
                        static_value.not_empty,
                        factory.createTypeReferenceNode('URL')
                    ]),
                } as const)
            })
            .with({ name: 'vector' }, ({ value: { values } }) => {
                const Coordinates = 'Coordinates'
                return (args: Record<string, unknown>) => ({
                    type: factory.createTypeReferenceNode(Coordinates),
                    imports: {
                        ordered: [`sandstone::arguments::${Coordinates}`] as NonEmptyList<string>,
                        check: new Map([[`sandstone::arguments::${Coordinates}`, 0]])
                    }
                } as const)
            })
            .with({ name: P.union('game_rule', 'uuid', 'block_predicate') }, () => {
                // old
                return (args: Record<string, unknown>) => ({ type: static_value.not_empty } as const)
            })
            .otherwise(() => {
                console.log(attribute?.name)
                throw new Error(`[mcdoc_string] Unsupported string attribute: ${attribute}`)
            })
    }
}

export const McdocString = mcdoc_string satisfies TypeHandler