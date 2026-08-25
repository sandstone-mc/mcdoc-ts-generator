import ts from '@typescript/typescript6'
import { match, P } from 'ts-pattern'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { SymbolUtil } from '@spyglassmc/core'
import type { NonEmptyList, TypeHandler, TypeHandlerResult } from '..'
import { Assert } from '../assert'
import { Bind } from '../bind'
import { add_import, is_valid_registry, make_imports, merge_imports, NormalNonTagResources, TaggableRegistry, type NonTagRegistry, type NormalNonTagResource } from '../utils'
import { RESOURCE_CLASSES } from '../../resources'
import { prefix_name } from '../../prefix'

const { factory } = ts

const StringKeyword = factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)

const NamespacedStringImport = 'sandstone::NamespacedString'

const NamespacedStringImports = {
  ordered: [NamespacedStringImport] as NonEmptyList<string>,
  check: new Map([[NamespacedStringImport, 0]]),
} as const

const NonEmptyStringImport = 'sandstone::NonEmptyString'

const NonEmptyStringImports = {
  ordered: [NonEmptyStringImport] as NonEmptyList<string>,
  check: new Map([[NonEmptyStringImport, 0]]),
} as const

const static_value = {
  normal: {
    type: StringKeyword,
  },
  not_empty: {
    type: factory.createTypeReferenceNode('NonEmptyString'),
    imports: NonEmptyStringImports,
  },
  namespaced_tag: {
    type: factory.createTemplateLiteralType(
      factory.createTemplateHead('#'),
      [
        factory.createTemplateLiteralTypeSpan(
          factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
          factory.createTemplateMiddle(':'),
        ),
        factory.createTemplateLiteralTypeSpan(
          factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
          factory.createTemplateTail(''),
        ),
      ],
    ),
  },
  namespaced: {
    type: factory.createTypeReferenceNode('NamespacedString'),
    imports: NamespacedStringImports,
  },
  hash: {
    type: factory.createTemplateLiteralType(
      factory.createTemplateHead('#'),
      [factory.createTemplateLiteralTypeSpan(
        factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
        factory.createTemplateTail(''),
      )],
    ),
  },
  number: {
    type: factory.createTemplateLiteralType(
      factory.createTemplateHead(''),
      [factory.createTemplateLiteralTypeSpan(
        factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
        factory.createTemplateTail(''),
      )],
    ),
  },
  time: {
    type: factory.createParenthesizedType(factory.createUnionTypeNode([
      factory.createTemplateLiteralType(
        factory.createTemplateHead(''),
        [
          factory.createTemplateLiteralTypeSpan(
            factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
            factory.createTemplateMiddle('-'),
          ),
          factory.createTemplateLiteralTypeSpan(
            factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
            factory.createTemplateMiddle('-'),
          ),
          factory.createTemplateLiteralTypeSpan(
            factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
            factory.createTemplateTail(''),
          ),
        ],
      ),
      factory.createTemplateLiteralType(
        factory.createTemplateHead(''),
        [
          factory.createTemplateLiteralTypeSpan(
            factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
            factory.createTemplateMiddle(':'),
          ),
          factory.createTemplateLiteralTypeSpan(
            factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
            factory.createTemplateMiddle(':'),
          ),
          factory.createTemplateLiteralTypeSpan(
            factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
            factory.createTemplateTail(''),
          ),
        ],
      ),
    ])),
  },
} as const

/**
 * This only handles strings as value types, not struct keys
 */
function mcdoc_string(type: mcdoc.McdocType) {
  const string = type
  Assert.StringType(string)

  if (string.attributes === undefined && string.lengthRange === undefined) {
    return (_args: Record<string, unknown>) => static_value.normal
  } else if (string.attributes === undefined) {
    return (_args: Record<string, unknown>) => ({
      ...static_value.not_empty,
      docs: [`String length range: ${mcdoc.NumericRange.toString(string.lengthRange!)}`] as NonEmptyList<string>,
    } as const)
  } else {
    Assert.Attributes(string.attributes, true)

    // Note: if `#[canonical]` ever gets used on a string, this implementation will need some work
    const attribute = string.attributes.find((attr) => attr.name !== 'since' && attr.name !== 'until')

    return match(attribute)
      .with(P.nullish, () => {
        return (_args: Record<string, unknown>) => static_value.normal
      })
      .with({ name: 'id', value: P.optional(P.nullish) }, () => {
        // #[id] string
        return (_args: Record<string, unknown>) => static_value.namespaced
      })
      .with({ name: 'id', value: P.nonNullable }, ({ value }) => {
        const id_attr = value

        return (args: Record<string, unknown>) => {
          const symbols = args.symbols as SymbolUtil | undefined

          let registry_id: NonTagRegistry

          let exclude = (reg: ts.TypeNode) => reg

          let Resource: undefined | typeof RESOURCE_CLASSES[NormalNonTagResource] | (() => typeof RESOURCE_CLASSES[NormalNonTagResource] | undefined) = () => {
            if (NormalNonTagResources.has(registry_id)) {
              return RESOURCE_CLASSES[registry_id]
            }
            return undefined
          }

          const make_resource_type_ref = (entry: typeof RESOURCE_CLASSES[NormalNonTagResource]): ts.TypeNode => {
            if (Array.isArray(entry)) {
              const [class_name, generic_name] = entry
              return factory.createTypeReferenceNode(class_name, [
                factory.createTypeReferenceNode(generic_name),
              ])
            }
            return factory.createTypeReferenceNode(entry as string)
          }

          const register_resource_imports = (entry: typeof RESOURCE_CLASSES[NormalNonTagResource]) => {
            if (Array.isArray(entry)) {
              const [class_name, generic_name] = entry
              add_import(imports, `sandstone::${class_name}`)
              add_import(imports, `sandstone::arguments::${generic_name}`)
            } else {
              add_import(imports, `sandstone::${entry}`)
            }
          }

          const registry_import = '::java::registry::Registry'

          const types: ts.TypeNode[] = []

          let has_non_indexable = false

          const imports = add_import(undefined as unknown as TypeHandlerResult['imports'], registry_import)

          if (id_attr.kind === 'literal') {
            registry_id = id_attr.value.value as typeof registry_id

            if (is_valid_registry(symbols, registry_id)) {
              types.push(exclude(factory.createIndexedAccessTypeNode(
                factory.createTypeReferenceNode(prefix_name('Registry')),
                Bind.StringLiteral(`minecraft:${registry_id}`),
              )))
            } else {
              types.push(static_value.namespaced.type)
              add_import(imports, NamespacedStringImport)
            }
          } else {
            registry_id = id_attr.values.registry.value.value as typeof registry_id

            if (is_valid_registry(symbols, registry_id)) {
              types.push(exclude(factory.createIndexedAccessTypeNode(
                factory.createTypeReferenceNode(prefix_name('Registry')),
                Bind.StringLiteral(`minecraft:${registry_id}`),
              )))
            } else {
              types.push(static_value.namespaced.type)
              add_import(imports, NamespacedStringImport)
            }

            if ('path' in id_attr.values) {
              return {
                type: static_value.namespaced.type,
                docs: ['', `Value: A ${registry_id} ID within a path root of \`(namespace)/textures/${id_attr.values.path!.value.value}\``] as NonEmptyList<string>,
                imports: NamespacedStringImports,
              } as const
            }
            if ('definition' in id_attr.values) {
              return {
                type: static_value.namespaced.type,
                docs: ['', `Value: Defines a \`${registry_id}\` id.`] as NonEmptyList<string>,
                imports: NamespacedStringImports,
              } as const
            }
            if ('exclude' in id_attr.values) {
              exclude = (reg: ts.TypeNode) => factory.createTypeReferenceNode('Exclude', [
                reg,
                factory.createParenthesizedType(factory.createUnionTypeNode(
                  Object.values(id_attr.values.exclude!.values).map((literal) => Bind.StringLiteral(literal.value.value)),
                )),
              ])
            }
            if ('tags' in id_attr.values && TaggableRegistry.has(registry_id)) {
              const Tag = 'TagClass'
              const tag_registry_id = `tag/${registry_id}` as `tag/${typeof registry_id}`
              const empty_tag_registry = !is_valid_registry(symbols, tag_registry_id)

              switch (id_attr.values.tags.value.value) {
                case 'allowed': {
                  types.push(
                    empty_tag_registry ? static_value.namespaced_tag.type : factory.createTemplateLiteralType(
                      factory.createTemplateHead('#'),
                      [factory.createTemplateLiteralTypeSpan(
                        factory.createIndexedAccessTypeNode(
                          factory.createTypeReferenceNode(prefix_name('Registry')),
                          Bind.StringLiteral(`minecraft:${tag_registry_id}`),
                        ),
                        factory.createTemplateTail(''),
                      )],
                    ),
                    factory.createTypeReferenceNode(
                      Tag,
                      [Bind.StringLiteral(registry_id)],
                    ),
                  )
                  add_import(imports, `sandstone::${Tag}`)
                  has_non_indexable = true
                } break
                case 'implicit': {
                  if (empty_tag_registry) {
                    add_import(imports, NamespacedStringImport)
                  }
                  return {
                    type: empty_tag_registry ? static_value.namespaced.type : factory.createParenthesizedType(factory.createUnionTypeNode([
                      factory.createIndexedAccessTypeNode(
                        factory.createTypeReferenceNode(prefix_name('Registry')),
                        Bind.StringLiteral(`minecraft:${tag_registry_id}`),
                      ),
                    ])),
                    imports,
                  } as const
                }
                case 'required': {
                  add_import(imports, 'sandstone::TagClass')
                  return {
                    type: factory.createParenthesizedType(factory.createUnionTypeNode([
                      empty_tag_registry ? static_value.namespaced_tag.type : factory.createTemplateLiteralType(
                        factory.createTemplateHead('#'),
                        [factory.createTemplateLiteralTypeSpan(
                          factory.createIndexedAccessTypeNode(
                            factory.createTypeReferenceNode(prefix_name('Registry')),
                            Bind.StringLiteral(`minecraft:${tag_registry_id}`),
                          ),
                          factory.createTemplateTail(''),
                        )],
                      ),
                      factory.createTypeReferenceNode(
                        Tag,
                        [Bind.StringLiteral(registry_id)],
                      ),
                    ])),
                    imports,
                  } as const
                }
              }
            }
            if ('empty' in id_attr.values) {
              types.push(Bind.StringLiteral(''))
            }
            if ('prefix' in id_attr.values) {
              throw new Error('[mcdoc_string] ID prefix is not currently supported as a value')
            }
          }

          Resource = Resource()

          if (Resource !== undefined) {
            types.push(make_resource_type_ref(Resource))
            register_resource_imports(Resource)
            has_non_indexable = true
          } else if (registry_id.endsWith('_variant')) {
            // Handle variant resources with VariantClass<'variant_type'>
            const variant_type = registry_id.match(/^([\w_]+)_variant$/)![1]
            types.push(factory.createTypeReferenceNode('VariantClass', [
              factory.createLiteralTypeNode(factory.createStringLiteral(variant_type)),
            ]))
            add_import(imports, 'sandstone::VariantClass')
            has_non_indexable = true
          }

          const result_type = types.length === 1 ? types[0] : factory.createParenthesizedType(factory.createUnionTypeNode(types))

          if (has_non_indexable) {
            Object.assign(result_type, { '--mcdoc_has_non_indexable': true })
          }

          return {
            type: result_type,
            imports,
          } as const
        }
      }).narrow()
      .with({ name: 'color' }, ({ value: { value: { value } } }) => {
        Assert.ColorStringType(value)
        // TODO: Implement color abstraction in Sandstone
        return (_args: Record<string, unknown>) => static_value.hash
      })
      /* oxlint-disable-next-line no-unused-vars */
      .with({ name: 'command' }, ({ value: { values } }) => {
        // TODO: Implement anonymous command in Sandstone
        return (_args: Record<string, unknown>) => static_value.not_empty
      })
      .with({ name: 'crafting_ingredient' }, () => {
        // TODO: Implement CraftingShaped struct generic
        return (_args: Record<string, unknown>) => static_value.not_empty
      })
      .with({ name: 'criterion', value: P.optional(P.nullish) }, () => {
        // TODO: Implement Advancement generics
        return (_args: Record<string, unknown>) => static_value.not_empty
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
        return (_args: Record<string, unknown>) => ({
          type: factory.createTypeReferenceNode(Target),
          imports: {
            ordered: [`sandstone::arguments::${Target}`] as NonEmptyList<string>,
            check: new Map([[`sandstone::arguments::${Target}`, 0]]),
          },
        } as const)
      })
      .with({ name: 'integer' }, () => {
        return (_args: Record<string, unknown>) => static_value.number
      })
      .with({ name: 'item_slots' }, () => {
        const ENTITY_SLOTS = 'ENTITY_SLOTS'
        const LiteralUnion = 'LiteralUnion'

        return (_args: Record<string, unknown>) => ({
          type: factory.createTypeReferenceNode(LiteralUnion, [
            factory.createTypeReferenceNode(ENTITY_SLOTS),
          ]),
          imports: {
            ordered: [`sandstone::arguments::${ENTITY_SLOTS}`, `sandstone::${LiteralUnion}`] as NonEmptyList<string>,
            check: new Map([[`sandstone::arguments::${ENTITY_SLOTS}`, 0], [`sandstone::${LiteralUnion}`, 1]]),
          },
        } as const)
      })
      /* oxlint-disable-next-line no-unused-vars */
      .with({ name: 'nbt' }, ({ value }) => {
        // TODO: Add strict typing to NBT in Sandstone
        const NBT = 'NBTClass'
        return (_args: Record<string, unknown>) => ({
          type: factory.createUnionTypeNode([
            static_value.not_empty.type,
            factory.createTypeReferenceNode(NBT),
          ]),
          imports: merge_imports(static_value.not_empty.imports, {
            ordered: [`sandstone::${NBT}`] as NonEmptyList<string>,
            check: new Map([[`sandstone::${NBT}`, 0]]),
          }),
        } as const)
      })
      /* oxlint-disable-next-line no-unused-vars */
      .with({ name: 'nbt_path' }, ({ value }) => {
        // TODO: Add strict typing to DataPoint in Sandstone
        const DataPoint = 'DataPointClass'
        return (args: Record<string, unknown>) => {
          // DataPointClass is not valid for nbt_path fields inside text components —
          // it triggers TS2859 when mixed into the recursive Text union.
          if (typeof args.current_path === 'string' && args.current_path.startsWith('::java::util::text::')) {
            return static_value.not_empty
          }
          return {
            type: factory.createUnionTypeNode([
              static_value.not_empty.type,
              factory.createTypeReferenceNode(DataPoint),
            ]),
            imports: merge_imports(static_value.not_empty.imports, {
              ordered: [`sandstone::${DataPoint}`] as NonEmptyList<string>,
              check: new Map([[`sandstone::${DataPoint}`, 0]]),
            }),
          } as const
        }
      })
      .with({ name: 'match_regex' }, ({ value: { value: { value } } }) => {
        return (_args: Record<string, unknown>) => ({
          ...static_value.not_empty,
          docs: [`Must match regex of ${value}`] as NonEmptyList<string>,
        } as const)
      })
      .with({ name: 'objective' }, () => {
        const Objective = 'ObjectiveClass'
        return (_args: Record<string, unknown>) => ({
          type: factory.createUnionTypeNode([
            static_value.not_empty.type,
            factory.createTypeReferenceNode(Objective),
          ]),
          imports: merge_imports(static_value.not_empty.imports, {
            ordered: [`sandstone::${Objective}`] as NonEmptyList<string>,
            check: new Map([[`sandstone::${Objective}`, 0]]),
          }),
        } as const)
      })
      .with({ name: 'regex_pattern' }, () => {
        return (_args: Record<string, unknown>) => ({
          type: factory.createUnionTypeNode([
            static_value.not_empty.type,
            factory.createTypeReferenceNode('RegExp'),
          ]),
          imports: static_value.not_empty.imports,
        } as const)
      })
      .with({ name: 'score_holder' }, () => {
        const SingleEntityArgument = 'SingleEntityArgument'
        return (args: Record<string, unknown>) => {
          return {
            type: factory.createUnionTypeNode([
              static_value.not_empty.type,
              factory.createTypeReferenceNode(SingleEntityArgument),
            ]),
            imports: merge_imports(static_value.not_empty.imports, {
              ordered: [`sandstone::arguments::${SingleEntityArgument}`] as NonEmptyList<string>,
              check: new Map([[`sandstone::arguments::${SingleEntityArgument}`, 0]]),
            }),
          } as const
        }
      })
      .with({ name: 'tag' }, () => {
        const Label = 'LabelClass'
        return (_args: Record<string, unknown>) => ({
          type: factory.createUnionTypeNode([
            static_value.not_empty.type,
            factory.createTypeReferenceNode(Label),
          ]),
          imports: merge_imports(static_value.not_empty.imports, {
            ordered: [`sandstone::${Label}`] as NonEmptyList<string>,
            check: new Map([[`sandstone::${Label}`, 0]]),
          }),
        } as const)
      })
      .with({ name: 'team' }, () => {
        // TODO: Implement team abstraction in Sandstone
        return (_args: Record<string, unknown>) => static_value.not_empty
      })
      .with({ name: 'text_component' }, () => {
        // This has been phased out by mojang
        return (_args: Record<string, unknown>) => static_value.not_empty
      })
      .with({ name: 'texture_slot' }, ({ value: { values: { kind: { value: { value } } } } }) => {
        const Texture = 'TextureClass'
        const TextureType = 'TextureType'
        // TODO: Implement Model struct generic, this is `kind="value"` or `kind="reference"`

        if (value === 'reference') {
          return (_args: Record<string, unknown>) => static_value.hash
        }

        return (_args: Record<string, unknown>) => ({
          type: factory.createUnionTypeNode([
            static_value.not_empty.type,
            static_value.hash.type,
            factory.createTypeReferenceNode(Texture, [
              factory.createTypeReferenceNode(TextureType),
            ]),
          ]),
          imports: merge_imports(static_value.not_empty.imports, make_imports(
            `sandstone::${Texture}`,
            `sandstone::arguments::${TextureType}`,
          )),
        } as const)
      })
      .with({ name: 'time_pattern' }, () => {
        return (_args: Record<string, unknown>) => static_value.time
      })
      .with({ name: 'translation_key' }, () => {
        // TODO: Add translation key abstraction in Sandstone
        const Registry = '::java::registry::Registry'

        return (_args: Record<string, unknown>) => ({
          type: factory.createIndexedAccessTypeNode(
            factory.createTypeReferenceNode(prefix_name('Registry')),
            Bind.StringLiteral('minecraft:translation_key'),
          ),
          imports: add_import(undefined as unknown as TypeHandlerResult['imports'], Registry),
        } as const)
      })
      .with({ name: 'translation_value' }, () => {
        // TODO: Add translation value abstraction in Sandstone
        return (_args: Record<string, unknown>) => static_value.normal
      })
      .with({ name: 'url' }, () => {
        return (_args: Record<string, unknown>) => ({
          type: factory.createUnionTypeNode([
            static_value.not_empty.type,
            factory.createTypeReferenceNode('URL'),
          ]),
          imports: static_value.not_empty.imports,
        } as const)
      })
      .with({ name: 'vector' }, () => {
        const Coordinates = 'Coordinates'
        return (_args: Record<string, unknown>) => ({
          type: factory.createTypeReferenceNode(Coordinates),
          imports: {
            ordered: [`sandstone::arguments::${Coordinates}`] as NonEmptyList<string>,
            check: new Map([[`sandstone::arguments::${Coordinates}`, 0]]),
          },
        } as const)
      })
      .with({ name: P.union('game_rule', 'uuid', 'block_predicate') }, () => {
        // old
        return (_args: Record<string, unknown>) => static_value.not_empty
      })
      .otherwise(() => {
        console.log(attribute?.name)
        throw new Error(`[mcdoc_string] Unsupported string attribute: ${attribute}`)
      })
  }
}

export const McdocString = mcdoc_string satisfies TypeHandler
