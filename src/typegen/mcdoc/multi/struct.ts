import ts from '@typescript/typescript6'
import { match, P } from 'ts-pattern'
import type * as mcdoc from '@spyglassmc/mcdoc'
import type { SymbolUtil, TaggableResourceLocationCategory } from '@spyglassmc/core'
import { TypeHandlers, type NonEmptyList, type TypeHandler, type TypeHandlerResult } from '..'
import { Assert } from '../assert'
import { add_import, is_valid_registry, merge_imports, type NonTagRegistry } from '../utils'
import { add, pascal_case } from '../../../util'
import { prefix_name } from '../../prefix'
import { ReleaseVersion, TARGET_VERSION } from '../version'
import { Bind } from '../bind'

const { factory } = ts

/**
 * Validates and extracts struct args from the unknown TypeHandler args.
 */
function StructArgs(_args: Record<string, unknown>): asserts _args is {
  root_type: boolean,
  name: string,
  spread?: true
} { }

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

    const spread = !!args.spread
    const root_type = !!args.root_type

    delete args.spread
    args.root_type = false

    let imports = undefined as unknown as TypeHandlerResult['imports']

    const pair_indices: Record<string, number> = {}
    const pairs: ts.PropertySignature[] = []

    const inherit: StructIntersection[] = []

    let pair_inserted = false

    const merge: StructIntersection[] = []

    let child_dispatcher: NonEmptyList<[parent_count: number, property: string]> | undefined

    let unresolved = false

    for (const field of struct.fields) {
      let unsupported = false

      if (field.attributes !== undefined) {
        Assert.Attributes(field.attributes, true)

        const attributes = field.attributes

        for (const attribute of attributes) {
          if (attribute.name === 'until' && ReleaseVersion.cmp(attribute.value.value.value as ReleaseVersion, TARGET_VERSION) <= 0) {
            unsupported = true
            break
          }
          if (attribute.name === 'deprecated') {
            unsupported = true
            break
          }
          if (attribute.name === 'since' && ReleaseVersion.cmp(attribute.value.value.value as ReleaseVersion, TARGET_VERSION) > 0) {
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

          if ((value as TypeHandlerResult).unresolved === true) {
            unresolved = true
          }

          if ('imports' in value) {
            imports = merge_imports(imports, value.imports)
          }
          if ('child_dispatcher' in value) {
            if (child_dispatcher === undefined) {
              child_dispatcher = [] as unknown as typeof child_dispatcher
            }
            child_dispatcher!.push(...(value.child_dispatcher as NonEmptyList<[number, string]>))
          }
          let field_docs = undefined as undefined | NonEmptyList<string | [string]>

          if ('desc' in pair && typeof pair.desc === 'string') {
            if (field_docs === undefined) {
              field_docs = [[pair.desc]]
            } else {
              field_docs.push([pair.desc])
            }
          }

          if ('docs' in value) {
            if (field_docs === undefined) {
              field_docs = ['Value:', ...value.docs]
            } else {
              field_docs.push('', 'Value:', ...value.docs)
            }
          }

          pair_indices[pair.key] = pairs.length
          pairs.push(Bind.Doc(factory.createPropertySignature(
            undefined,
            pair.key,
            pair.optional ? factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
            value.type,
          ), field_docs))

          pair_inserted = true
        }).narrow()
        .with({ kind: 'pair' }, (pair) => {
          Assert.StructKeyType(pair.key)

          const value = TypeHandlers[pair.type.kind](pair.type)({ ...args, name: `${name}IndexSignature` })

          if ((value as TypeHandlerResult).unresolved === true) {
            unresolved = true
          }

          if ('imports' in value) {
            imports = merge_imports(imports, value.imports)
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

              // TODO: Handle #[id]. As of 1.21.5, this no longer exists outside of FeatureFlag

              if ((key as TypeHandlerResult).unresolved === true) {
                unresolved = true
              }

              if ('imports' in key) {
                imports = merge_imports(imports, key.imports)
              }
              inherit.push(Bind.MappedType(key.type, value.type))
            })
            .with('string', () => {
              if (pair.key.attributes === undefined) {
                Assert.StringType(pair.key)
                // TODO: docs
                imports = add_import(imports, 'sandstone::NonEmptyString')
                inherit.push(Bind.MappedType(factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword), value.type))
              } else {
                Assert.Attributes(pair.key.attributes, true)

                // There's only ever one attribute
                const attribute = pair.key.attributes[0]

                match(attribute)
                  .with({ name: 'id' }, (attr) => {
                    const id_attr = attr.value

                    let registry_id: NonTagRegistry

                    if (id_attr === undefined) {
                      imports = add_import(imports, 'sandstone::NonEmptyString')
                      inherit.push(Bind.MappedType(
                        factory.createTypeReferenceNode('NonEmptyString'),
                        value.type,
                      ))
                      return
                    }
                    let exclude = (reg: ts.IndexedAccessTypeNode): ts.TypeReferenceNode | ts.IndexedAccessTypeNode => reg
                    if (id_attr.kind === 'literal') {
                      registry_id = id_attr.value.value as NonTagRegistry
                    } else {
                      registry_id = id_attr.values.registry.value.value as TaggableResourceLocationCategory

                      if ('exclude' in id_attr.values) {
                        exclude = (reg: ts.TypeNode) => factory.createTypeReferenceNode('Exclude', [
                          reg,
                          factory.createParenthesizedType(factory.createUnionTypeNode(
                            Object.values(id_attr.values.exclude!.values).map((literal) => Bind.StringLiteral(literal.value.value)),
                          )),
                        ])
                      }

                      if ('path' in id_attr.values) {
                        // Sadly typescript doesn't support JSDoc on Parameter Declarations
                        imports = add_import(imports, 'sandstone::NamespacedString')
                        inherit.push(Bind.MappedType(
                          factory.createTypeReferenceNode('NamespacedString'),
                          value.type,
                        ))
                        return
                      }
                    }

                    const symbols = 'symbols' in args ? (args.symbols as SymbolUtil | undefined) : undefined

                    // Check if registry exists; if not, fall back to namespaced string
                    if (!is_valid_registry(symbols, registry_id)) {
                      imports = add_import(imports, 'sandstone::NamespacedString')
                      inherit.push(Bind.MappedType(
                        factory.createTypeReferenceNode('NamespacedString'),
                        value.type,
                      ))
                      return
                    }

                    // Import the central Registry type and index by registry ID
                    const registry_import = '::java::registry::Registry'

                    imports = add_import(imports, registry_import)

                    inherit.push(Bind.MappedType(
                      exclude(factory.createIndexedAccessTypeNode(
                        factory.createTypeReferenceNode(prefix_name('Registry')),
                        Bind.StringLiteral(`minecraft:${registry_id}`),
                      )),
                      value.type,
                    ))
                  })
                  .with({ name: 'item_slots' }, () => {
                    const ENTITY_SLOTS = 'ENTITY_SLOTS'
                    const LiteralUnion = 'LiteralUnion'
                    imports = add_import(imports, `sandstone::arguments::${ENTITY_SLOTS}`)
                    imports = add_import(imports, `sandstone::${LiteralUnion}`)

                    inherit.push(Bind.MappedType(
                      factory.createTypeReferenceNode(LiteralUnion, [
                        factory.createTypeReferenceNode(ENTITY_SLOTS),
                      ]),
                      value.type,
                    ))
                  })
                  .with({ name: 'objective' }, () => {
                    const Objective = 'ObjectiveClass'
                    imports = add_import(imports, `sandstone::${Objective}`)

                    inherit.push(Bind.MappedType(
                      factory.createUnionTypeNode([
                        factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                        factory.createTypeReferenceNode(Objective),
                      ]),
                      value.type,
                    ))
                  })
                  .with({ name: 'texture_slot' }, () => {
                    // TODO: Implement Model struct generic, this is `kind="definition"`
                    imports = add_import(imports, 'sandstone::NonEmptyString')
                    inherit.push(Bind.MappedType(
                      factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                      value.type,
                    ))
                  })
                  .with({ name: 'criterion' }, () => {
                    // TODO: Implement Advancement struct generic, this is `definition=true`
                    imports = add_import(imports, 'sandstone::NonEmptyString')
                    inherit.push(Bind.MappedType(
                      factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                      value.type,
                    ))
                  })
                  .with({ name: 'crafting_ingredient' }, () => {
                    // TODO !: Implement CraftingShaped struct generic, this is `definition=true`
                    const CRAFTING_INGREDIENT = 'CRAFTING_INGREDIENT'
                    imports = add_import(imports, `sandstone::arguments::${CRAFTING_INGREDIENT}`) // 'A' | 'B' | 'C' ...

                    inherit.push(Bind.MappedType(
                      factory.createTypeReferenceNode(CRAFTING_INGREDIENT),
                      value.type,
                    ))
                  })
                  .with({ name: P.union('dispatcher_key', 'translation_key', 'permutation') }, () => {
                    // Permutation will be implemented as an abstracted mode of the Atlas class
                    imports = add_import(imports, 'sandstone::NonEmptyString')
                    inherit.push(Bind.MappedType(
                      factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                      value.type,
                    ))
                  })
                  .otherwise(() => {
                    throw new Error(`[mcdoc_struct] Unsupported dynamic key attribute: ${attribute}`)
                  })
              }
            })
            .with('union', () => {
              Assert.UnionType(pair.key)

              const surviving_members: mcdoc.McdocType[] = []

              for (const member of pair.key.members) {
                let unsupported = false
                if (member.attributes !== undefined) {
                  Assert.Attributes(member.attributes, true)
                  for (const attribute of member.attributes) {
                    if (attribute.name === 'until' && ReleaseVersion.cmp(attribute.value!.value.value as ReleaseVersion, TARGET_VERSION) <= 0) {
                      unsupported = true
                      break
                    }
                    if (attribute.name === 'since' && ReleaseVersion.cmp(attribute.value!.value.value as ReleaseVersion, TARGET_VERSION) > 0) {
                      unsupported = true
                      break
                    }
                  }
                }
                if (!unsupported) {
                  surviving_members.push(member)
                }
              }

              if (surviving_members.length === 0) {
                // All union members filtered out by version. Fall back to a `string`-keyed
                // index so the field still emits valid syntax instead of `Record<string, never>`.
                imports = add_import(imports, 'sandstone::NonEmptyString')
                inherit.push(Bind.MappedType(
                  factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                  value.type,
                ))
                return
              }

              const key_types: ts.TypeNode[] = []

              for (const member of surviving_members) {
                const key = TypeHandlers[member.kind](member)(args)

                if ((key as TypeHandlerResult).unresolved === true) {
                  unresolved = true
                }

                if ('imports' in key) {
                  imports = merge_imports(imports, key.imports)
                }
                if ('child_dispatcher' in key) {
                  if (child_dispatcher === undefined) {
                    child_dispatcher = [] as unknown as typeof child_dispatcher
                  }
                  child_dispatcher!.push(...(key.child_dispatcher as NonEmptyList<[number, string]>))
                }

                key_types.push(key.type)
              }

              const combined_key = key_types.length === 1
                ? key_types[0]
                : factory.createUnionTypeNode(key_types)

              inherit.push(Bind.MappedType(combined_key, value.type))
            })

        })
        .with({ kind: 'spread' }, (_spread) => {
          Assert.StructSpreadType(_spread.type)
          const spread = TypeHandlers[_spread.type.kind](_spread.type)({ spread: true, ...args })

          if ((spread as TypeHandlerResult).unresolved === true) {
            unresolved = true
          }

          if ('imports' in spread) {
            imports = merge_imports(imports, spread.imports)
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
          // Skip if this property was already processed (avoids duplicate child_dispatcher entries corrupting indexed_access_type)
          if (indexed_access === property) {
            return []
          }

          const generic_prop = pair_indices[property]

          if (generic_prop === undefined) {
            if (root_type) {
              template = (type_node: typeof inner_type) => factory.createTypeAliasDeclaration(
                [factory.createToken(ts.SyntaxKind.ExportKeyword)],
                args.name,
                [factory.createTypeParameterDeclaration(undefined, 'S', undefined, factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword))],
                type_node,
              )
              return []
            }
            throw new Error(`[mcdoc_struct] Received an invalid dynamic dispatcher trying to access '${property}'`)
          }

          indexed_access = property
          indexed_access_type = pairs[generic_prop].type

          // yes this is cursed
          if ('--mcdoc_has_non_indexable' in indexed_access_type!) {
            // Keep original type - don't replace with S
            // pairs[generic_prop].type stays as-is
            if (root_type) {
              template = (type_node: typeof inner_type) => factory.createTypeAliasDeclaration(
                [factory.createToken(ts.SyntaxKind.ExportKeyword)],
                args.name,
                [factory.createTypeParameterDeclaration(undefined, 'S', undefined, factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword))],
                type_node,
              )
            }
          } else if ('--mcdoc_id_ref' in indexed_access_type!) {
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
            [factory.createTypeParameterDeclaration(undefined, 'S', undefined, factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword))],
            type_node,
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
        ...add({ imports, child_dispatcher }),
        ...(unresolved ? { unresolved: true as const } : {}),
      } as const
    } else if ('--mcdoc_has_non_indexable' in indexed_access_type!) {
      // Skip mapped type pattern - just use inner_type directly
      // The type parameter S is already added by the template (line 337)
      return {
        type: template(inner_type),
        ...add({ imports, child_dispatcher }),
        ...(unresolved ? { unresolved: true as const } : {}),
      } as const
    } else {
      // Create the indexed access type: ({ [S in ...]?: ... }[...])
      // Constrain both the mapped key set and the indexed-access key to
      // `Extract<X, string>`. The dispatcher key union often contains class
      // constructors (e.g. `TagClass<'entity_type'>`) which aren't valid
      // index types — using the full union produces TS2538 at the consumer.
      const string_keys = factory.createTypeReferenceNode('Extract', [
        indexed_access_type!,
        factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
      ])
      const indexed_access_node = factory.createParenthesizedType(factory.createIndexedAccessTypeNode(
        Bind.MappedType(string_keys, inner_type, { key_name: 'S', parenthesized: false }),
        string_keys,
      ))

      // Wrap in NonNullable when this is a root type (top-level export)
      // because mapped type indexed access can return undefined
      const result_type = root_type
        ? factory.createTypeReferenceNode('NonNullable', [indexed_access_node])
        : indexed_access_node

      return {
        type: template(result_type),
        ...add({ imports, child_dispatcher }),
        ...(unresolved ? { unresolved: true as const } : {}),
      } as const
    }
  }
}

export const McdocStruct = mcdoc_struct satisfies TypeHandler
