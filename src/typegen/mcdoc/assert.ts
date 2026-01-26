import type * as mcdoc from '@spyglassmc/mcdoc'
import { Set } from './utils'
import { match, P } from 'ts-pattern'

type ReferenceType = {
  kind: 'reference',
  path: string,
  attributes: never,
}

type StringLiteral = Omit<(mcdoc.LiteralType & { value: mcdoc.LiteralStringValue }), 'attributes'>

/**
 * These Attribute types are based on what actually appears in vanilla-mcdoc to simplify handling, these may need updates in the future.
 */

type AttributeTreeChildType = ((
  | ReferenceType
  | (mcdoc.LiteralType & { value: mcdoc.LiteralStringValue | mcdoc.LiteralBooleanValue })
  | (mcdoc.AttributeTreeValue & { values: Record<`${number}`, StringLiteral> })
) & { attributes: never })

type AttributeRootValueType = ((
  | mcdoc.DispatcherType
  | ReferenceType
  | StringLiteral
  | (mcdoc.AttributeTreeValue & { values: Record<string, AttributeTreeChildType> })
) & { attributes: never })

type AttributeType = mcdoc.Attribute & {
  value: AttributeRootValueType
}

type CommandAttributeExtras = {
  empty?: {
    attributes: never,
    kind: 'literal',
    value: {
      attributes: never,
      kind: 'string',
      value: 'allowed'
    }
  },
  max_length?: {
    attributes: never,
    kind: 'literal',
    value: {
      attributes: never,
      kind: 'int',
      value: number
    }
  },
  incomplete?: {
    attributes: never,
    kind: 'literal',
    value: {
      attributes: never,
      kind: 'string',
      value: 'allowed'
    }
  }
}
// The `attributes: never` thing is really annoying but necessary
type ImplementedAttributes = {
  id: (undefined
    | {
      attributes: never
      kind: 'literal',
      value: {
        attributes: never
        kind: 'string',
        value: string
      }
    }
    | {
      attributes: never,
      kind: 'tree',
      values: {
        registry: {
          attributes: never,
          kind: 'literal',
          value: {
            attributes: never,
            kind: 'string',
            value: string
          }
        },
        path?: {
          attributes: never,
          kind: 'literal',
          value: {
            attributes: never,
            kind: 'string',
            value: `${string}/`
          }
        },
        definition?: {
          attributes: never,
          kind: 'literal',
          value: {
            attributes: never,
            kind: 'boolean',
            value: true
          }
        },
        exclude?: {
          attributes: never,
          kind: 'tree',
          values: {
            [K in `${number}`]: {
              attributes: never,
              kind: 'literal',
              value: {
                attributes: never,
                kind: 'string',
                value: string
              }
            }
          }
        },
        tags?: {
          attributes: never,
          kind: 'literal',
          value: {
            attributes: never,
            kind: 'string',
            value: KindType<typeof AssertKinds.RegistryAttributeTagsArgument>
          }
        },
        empty?: {
          attributes: never,
          kind: 'literal',
          value: {
            attributes: never,
            kind: 'string',
            value: 'allowed'
          }
        },
        prefix?: {
          attributes: never,
          kind: 'literal',
          value: {
            attributes: never,
            kind: 'string',
            value: '!'
          }
        },
      }
    }
  ),
  since: {
    attributes: never,
    kind: 'literal',
    value: {
      attributes: never,
      kind: 'string',
      value: `${number}.${number}.${number}`
    }
  },
  until: {
    attributes: never,
    kind: 'literal',
    value: {
      attributes: never,
      kind: 'string',
      value: `${number}.${number}.${number}`
    }
  },
  permutation: {
    attributes: never,
    kind: 'tree',
    values: {
      definition: {
        attributes: never,
        kind: 'literal',
        value: {
          kind: 'boolean',
          value: true
        }
      }
    }
  },
  texture_slot: {
    attributes: never,
    kind: 'tree',
    values: {
      kind: {
        attributes: never,
        kind: 'literal',
        value: {
          attributes: never,
          kind: 'string',
          value: KindType<typeof AssertKinds.TextureSlotAttributeKind>
        }
      }
    }
  },
  item_slots: undefined,
  tag: undefined,
  team: undefined,
  translation_key: undefined,
  translation_value: undefined,
  crafting_ingredient: (undefined | {
    attributes: never,
    kind: 'tree',
    values: {
      definition: {
        attributes: never,
        kind: 'literal',
        value: {
          attributes: never,
          kind: 'boolean',
          value: true
        }
      }
    }
  }),
  objective: undefined,
  dispatcher_key: {
    attributes: never,
    kind: 'literal',
    value: {
      attributes: never,
      kind: 'string',
      value: `${string}:${string}`
    }
  },
  regex_pattern: undefined,
  canonical: undefined,
  color: {
    attributes: never,
    kind: 'literal',
    value: {
      attributes: never,
      kind: 'string',
      value: KindType<typeof AssertKinds.ColorAttributeKind>
    }
  },
  time_pattern: undefined,
  criterion: (undefined | {
    attributes: never,
    kind: 'tree',
    values: {
      definition: {
        attributes: never,
        kind: 'literal',
        value: {
          attributes: never,
          kind: 'boolean',
          value: true
        }
      }
    }
  }),
  nbt: (undefined | mcdoc.DispatcherType | ReferenceType),
  nbt_path: (undefined | mcdoc.DispatcherType),
  match_regex: {
    attributes: never,
    kind: 'literal',
    value: {
      attributes: never,
      kind: 'string',
      value: string
    }
  },
  deprecated: undefined,
  command: {
    attributes: never,
    kind: 'tree',
    values: (
      | ({
        macro: {
          attributes: never,
          kind: 'literal',
          value: {
            attributes: never,
            kind: 'string',
            value: 'implicit' | 'allowed'
          }
        },
      } & CommandAttributeExtras)
      | ({
        slash: {
          attributes: never,
          kind: 'literal',
          value: {
            attributes: never,
            kind: 'string',
            value: KindType<typeof AssertKinds.CommandAttributeSlashKind>
          }
        },
      } & CommandAttributeExtras)
    )
  },
  uuid: undefined,
  url: undefined,
  random: undefined,
  divisible_by: {
    attributes: never,
    kind: 'literal',
    value: {
      attributes: never,
      kind: 'int',
      value: number
    }
  },
  entity: (undefined | {
    attributes: never,
    kind: 'tree',
    values: {
      amount?: {
        attributes: never,
        kind: 'literal',
        value: {
          attributes: never,
          kind: 'string',
          value: 'single' | 'multiple'
        }
      },
      type?: {
        attributes: never,
        kind: 'literal',
        value: {
          attributes: never,
          kind: 'string',
          value: 'entities' | 'players'
        }
      }
    }
  }),
  integer: {
    attributes: never,
    kind: 'tree',
    values: {
      min: {
        attributes: never,
        kind: 'literal',
        value: {
          attributes: never,
          kind: 'int',
          value: 1
        }
      }
    }
  },
  /**
   * This isn't correct, but ICBA
   */
  game_rule: undefined
  score_holder: undefined,
  vector: {
    attributes: never,
    kind: 'tree',
    values: {
      dimension: {
        attributes: never,
        kind: 'literal',
        value: {
          attributes: never,
          kind: 'int',
          value: 3
        }
      },
      integer: {
        attributes: never,
        kind: 'literal',
        value: {
          attributes: never,
          kind: 'boolean',
          value: true
        }
      }
    }
  },
  bitfield: ReferenceType,
  text_component: undefined,
  block_predicate: undefined,
}

export type ImplementedAttributeType<KIND extends (keyof ImplementedAttributes | undefined) = undefined> = mcdoc.Attribute & (
  KIND extends undefined ?
  ({
    [K in keyof ImplementedAttributes]: ({
      name: K
    } & (ImplementedAttributes[K] extends undefined ? {} : {
      value: ImplementedAttributes[K]
    }))
  }[keyof ImplementedAttributes])
  : (ImplementedAttributes[Extract<KIND, string>] extends undefined ?
    {
      name: KIND
    }
    : (Extract<ImplementedAttributes[Extract<KIND, string>], undefined> extends never ?
      {
        name: KIND,
        value: ImplementedAttributes[Extract<KIND, string>]
      }
      : {
        name: KIND,
        value?: NonNullable<ImplementedAttributes[Extract<KIND, string>]>
      }
    )
  )
)

export type KindType<T> = T extends Set<infer U> ? U : never
export class AssertKinds {
  static readonly AttributeRootValueKind = new Set(['dispatcher', 'reference', 'literal', 'tree'] as const)
  static readonly AttributeTreeChildKind = new Set(['reference', 'literal', 'tree'] as const)

  static readonly ImplementedAttributes = new Set([
    'id',
    'since',
    'until',
    'permutation',
    'texture_slot',
    'item_slots',
    'tag',
    'team',
    'translation_key',
    'translation_value',
    'crafting_ingredient',
    'block_predicate',
    'game_rule',
    'objective',
    'dispatcher_key',
    'regex_pattern',
    'canonical',
    'color',
    'time_pattern',
    'criterion',
    'nbt',
    'nbt_path',
    'match_regex',
    'deprecated',
    'command',
    'url',
    'uuid',
    'random',
    'divisible_by',
    'entity',
    'integer',
    'score_holder',
    'vector',
    'bitfield',
    'text_component',
  ] as const)
  static readonly RegistryAttributeArgument = new Set(['registry', 'path', 'definition', 'exclude', 'tags', 'empty', 'prefix'] as const)
  static readonly RegistryAttributeTagsArgument = new Set(['allowed', 'implicit', 'required'] as const)
  static readonly ColorAttributeKind = new Set(['composite_rgb', 'composite_argb', 'hex_rgb', 'hex_argb', 'dec_rgb', 'dec_rgba', 'particle', 'named'] as const)
  static readonly CommandAttributeArgument = new Set(['macro', 'slash', 'incomplete', 'empty', 'max_length'] as const)
  static readonly CommandAttributeSlashKind = new Set(['allowed', 'required', 'chat', 'none'] as const)
  static readonly TextureSlotAttributeKind = new Set(['definition', 'value', 'reference'] as const)

  static readonly ArrayKind = new Set(['byte_array', 'int_array', 'long_array'] as const)

  static readonly StructKeyKind = new Set(['reference', 'concrete', 'string', 'union'] as const)

  static readonly StructSpreadKind = new Set(['reference', 'dispatcher', 'concrete', 'template', 'struct', 'union'] as const)

  static readonly NumericKind = new Set(['byte', 'double', 'float', 'int', 'long', 'short'])
}

export class Assert {
  static Attributes<IMPLEMENTED extends (undefined | true)>(type: mcdoc.Attribute[], implemented?: IMPLEMENTED): asserts type is (
    // TODO: This only works when IMPLEMENTED is set to true ugh
    IMPLEMENTED extends true ? ImplementedAttributeType[]
    : AttributeType[]
  ) {
    if (type !== undefined) {
      for (const attribute of type) {
        if (attribute.value !== undefined && !AssertKinds.AttributeRootValueKind.has(attribute.value.kind)) {
          throw new Error(`[mcdoc_assert] Attribute Type value is an unsupported kind ${attribute}`)
        }
        if (implemented) {
          if (!AssertKinds.ImplementedAttributes.has(attribute.name)) {
            throw new Error(`[mcdoc_assert] Attribute Type is unsupported ${attribute.name}`)
          }
          const attribute_type = attribute.name as KindType<typeof AssertKinds.ImplementedAttributes>

          match(attribute_type)
            .with('since', 'until', 'deprecated', () => {
              if (attribute.value === undefined) {
                // @author Claude - versioned attributes require a value
                throw new Error(`[mcdoc_assert] Versioned attribute '${attribute_type}' must have a value`)
              }
              if (attribute.value.kind !== 'literal' || attribute.value.value.kind !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(attribute.value.value.value)) {
                throw new Error(`[mcdoc_assert] Versioned Attribute Type value is invalid ${attribute.value}`)
              }
            })
            .with('id', () => {
              if (attribute.value !== undefined) {
                match(attribute.value)
                  .with({ kind: 'literal', value: { kind: 'string', value: P.string } }, () => { })
                  .with({ kind: 'tree', values: { registry: { kind: 'literal', value: { kind: 'string', value: P.string } } } }, (tree) => {
                    const invalid_argument = Object.keys(tree.values).find((argument) => !AssertKinds.RegistryAttributeArgument.has(argument))

                    if (invalid_argument !== undefined) {
                      throw new Error(`[mcdoc_assert] Invalid Registry Attribute Type argument ${invalid_argument}`)
                    }
                    const args = tree.values as Record<KindType<typeof AssertKinds.RegistryAttributeArgument>, AttributeTreeChildType | undefined>

                    if (args.exclude !== undefined) {
                      if (args.exclude.kind === 'tree') {
                        if ('0' in args.exclude.values) {
                          Object.values(args.exclude.values).forEach((exclusion) => {
                            if (exclusion.kind !== 'literal' || exclusion.value.kind !== 'string') {
                              throw new Error(`[mcdoc_assert] Invalid Registry Attribute Type exclusion ${args.exclude}`)
                            }
                          })
                        } else {
                          throw new Error(`[mcdoc_assert] Invalid Registry Attribute Type exclusion ${args.exclude}`)
                        }
                      } else {
                        throw new Error(`[mcdoc_assert] Invalid Registry Attribute Type exclusion ${args.exclude}`)
                      }
                    }
                    if (args.empty !== undefined) {
                      if (args.empty.kind !== 'literal' || args.empty.value.value !== 'allowed') {
                        throw new Error(`[mcdoc_assert] Invalid Registry Attribute Type empty argument ${args.empty}`)
                      }
                    }
                    if (args.definition !== undefined) {
                      if (args.definition.kind !== 'literal' || args.definition?.value.value !== true) {
                        throw new Error(`[mcdoc_assert] Invalid Definition Registry Attribute Type ${args.empty}`)
                      }
                    }
                    if (args.path !== undefined) {
                      if (args.path.kind !== 'literal' || !`${args.path.value.value}`.endsWith('/')) {
                        throw new Error(`[mcdoc_assert] Invalid Pathed Registry Attribute Type ${args.path}`)
                      }
                    }
                    if (args.prefix !== undefined) {
                      if (args.prefix.kind !== 'literal' || args.prefix.value.value !== '!') {
                        throw new Error(`[mcdoc_assert] Invalid Registry Attribute Type prefix ${args.prefix}`)
                      }
                    }
                    if (args.tags !== undefined) {
                      if (args.tags.kind !== 'literal' || !AssertKinds.RegistryAttributeTagsArgument.has(args.tags.value.value)) {
                        throw new Error(`[mcdoc_assert] Invalid Tag Registry Attribute Type ${args.tags}`)
                      }
                    }
                  })
                  .otherwise(() => {
                    // @author Claude - #[id] value must be a literal string or a tree with registry
                    throw new Error(`[mcdoc_assert] Invalid #[id] attribute value format: expected literal string or tree with registry, got kind '${attribute.value?.kind}'`)
                  })
              }
            })
            .with('bitfield', () => {
              if (attribute.value === undefined || attribute.value.kind !== 'reference' || attribute.value.path === undefined) {
                // @author Claude - #[bitfield] requires a reference with a valid path
                throw new Error(`[mcdoc_assert] #[bitfield] attribute must have a reference value with a defined path, got: ${JSON.stringify(attribute.value)}`)
              }
            })
            .with('color', () => {
              if (attribute.value === undefined) {
                // @author Claude - #[color] requires a value specifying the color format
                throw new Error('[mcdoc_assert] #[color] attribute must have a value')
              }
              if (attribute.value.kind !== 'literal' || attribute.value.value.kind !== 'string') {
                // @author Claude - #[color] value must be a string literal
                throw new Error(`[mcdoc_assert] #[color] attribute value must be a string literal, got kind '${attribute.value.kind}'`)
              }
              if (!AssertKinds.ColorAttributeKind.has(attribute.value.value.value)) {
                // @author Claude - #[color] value must be a recognized color format
                throw new Error(`[mcdoc_assert] #[color] attribute has invalid color kind '${attribute.value.value.value}', expected one of: ${[...AssertKinds.ColorAttributeKind].join(', ')}`)
              }
            })
            .with('command', () => {
              if (attribute.value === undefined) {
                // @author Claude - #[command] requires configuration values
                throw new Error('[mcdoc_assert] #[command] attribute must have a value')
              }
              if (attribute.value.kind === 'tree') {
                const invalid_argument = Object.keys(attribute.value.values).find((argument) => !AssertKinds.CommandAttributeArgument.has(argument))

                if (invalid_argument) {
                  // @author Claude - unknown argument in #[command] tree
                  throw new Error(`[mcdoc_assert] #[command] attribute has invalid argument '${invalid_argument}', expected one of: ${[...AssertKinds.CommandAttributeArgument].join(', ')}`)
                }
                if ('macro' in attribute.value.values && !('slash' in attribute.value.values)) {
                  if (attribute.value.values.macro.kind === 'literal') {
                    if (attribute.value.values.macro.value.value !== 'implicit' && attribute.value.values.macro.value.value !== 'allowed') {
                      // @author Claude - macro must be 'implicit' or 'allowed'
                      throw new Error(`[mcdoc_assert] #[command(macro)] value must be 'implicit' or 'allowed', got '${attribute.value.values.macro.value.value}'`)
                    }
                  } else {
                    // @author Claude - macro argument must be a literal
                    throw new Error(`[mcdoc_assert] #[command(macro)] must be a literal, got kind '${attribute.value.values.macro.kind}'`)
                  }
                } else if ('slash' in attribute.value.values) {
                  if (attribute.value.values.slash.kind === 'literal') {
                    if (!AssertKinds.CommandAttributeSlashKind.has(attribute.value.values.slash.value.value)) {
                      // @author Claude - slash must be a recognized value
                      throw new Error(`[mcdoc_assert] #[command(slash)] value must be one of: ${[...AssertKinds.CommandAttributeSlashKind].join(', ')}, got '${attribute.value.values.slash.value.value}'`)
                    }
                  } else {
                    // @author Claude - slash argument must be a literal
                    throw new Error(`[mcdoc_assert] #[command(slash)] must be a literal, got kind '${attribute.value.values.slash.kind}'`)
                  }
                } else {
                  // @author Claude - #[command] requires either macro or slash argument
                  throw new Error('[mcdoc_assert] #[command] attribute must have either \'macro\' or \'slash\' argument')
                }
                if ('empty' in attribute.value.values) {
                  if (attribute.value.values.empty.kind === 'literal') {
                    if (attribute.value.values.empty.value.value !== 'allowed') {
                      // @author Claude - empty must be 'allowed'
                      throw new Error(`[mcdoc_assert] #[command(empty)] value must be 'allowed', got '${attribute.value.values.empty.value.value}'`)
                    }
                  } else {
                    // @author Claude - empty argument must be a literal
                    throw new Error(`[mcdoc_assert] #[command(empty)] must be a literal, got kind '${attribute.value.values.empty.kind}'`)
                  }
                }
                if ('max_length' in attribute.value.values) {
                  if (attribute.value.values.max_length.kind === 'literal') {
                    if (attribute.value.values.max_length.value.kind !== 'int' || attribute.value.values.max_length.value.value < 4) {
                      // @author Claude - max_length must be an int >= 4
                      throw new Error(`[mcdoc_assert] #[command(max_length)] value must be an integer >= 4, got '${attribute.value.values.max_length.value.value}'`)
                    }
                  } else {
                    // @author Claude - max_length argument must be a literal
                    throw new Error(`[mcdoc_assert] #[command(max_length)] must be a literal, got kind '${attribute.value.values.max_length.kind}'`)
                  }
                }
                if ('incomplete' in attribute.value.values) {
                  if (attribute.value.values.incomplete.kind === 'literal') {
                    if (attribute.value.values.incomplete.value.value !== 'allowed') {
                      // @author Claude - incomplete must be 'allowed'
                      throw new Error(`[mcdoc_assert] #[command(incomplete)] value must be 'allowed', got '${attribute.value.values.incomplete.value.value}'`)
                    }
                  } else {
                    // @author Claude - incomplete argument must be a literal
                    throw new Error(`[mcdoc_assert] #[command(incomplete)] must be a literal, got kind '${attribute.value.values.incomplete.kind}'`)
                  }
                }
              } else {
                // @author Claude - #[command] value must be a tree
                throw new Error(`[mcdoc_assert] #[command] attribute value must be a tree, got kind '${attribute.value.kind}'`)
              }
            })
            .with('criterion', 'crafting_ingredient', () => {
              if (attribute.value !== undefined) {
                if (attribute.value.kind !== 'tree' || !('definition' in attribute.value.values) || attribute.value.values.definition.kind !== 'literal' || attribute.value.values.definition.value.value !== true) {
                  // @author Claude - if value is provided, it must be {definition: true}
                  throw new Error(`[mcdoc_assert] #[${attribute_type}] attribute value must be a tree with 'definition: true', got: ${JSON.stringify(attribute.value)}`)
                }
                if (Object.keys(attribute.value.values).length > 1) {
                  // @author Claude - only 'definition' argument is allowed
                  throw new Error(`[mcdoc_assert] #[${attribute_type}] attribute tree has unexpected extra arguments: ${Object.keys(attribute.value.values).filter(k => k !== 'definition').join(', ')}`)
                }
              }
            })
            .with('dispatcher_key', () => {
              if (attribute.value === undefined) {
                // @author Claude - #[dispatcher_key] requires a namespaced ID value
                throw new Error('[mcdoc_assert] #[dispatcher_key] attribute must have a value')
              }
              if (attribute.value.kind !== 'literal' || !/^[\w_]+:[\w_]+$/.test(`${attribute.value.value.value}`)) {
                // @author Claude - must be a valid namespaced ID like 'namespace:path'
                throw new Error(`[mcdoc_assert] #[dispatcher_key] attribute value must be a namespaced ID (e.g., 'namespace:path'), got '${attribute.value?.kind === 'literal' ? attribute.value.value.value : attribute.value.kind}'`)
              }
            })
            .with('divisible_by', () => {
              if (attribute.value === undefined) {
                // @author Claude - #[divisible_by] requires an integer divisor value
                throw new Error('[mcdoc_assert] #[divisible_by] attribute must have a value')
              }
              if (attribute.value.kind !== 'literal' || !Number.isInteger(Number(attribute.value.value.value))) {
                // @author Claude - divisor must be an integer literal
                throw new Error(`[mcdoc_assert] #[divisible_by] attribute value must be an integer literal, got: ${JSON.stringify(attribute.value)}`)
              }
            })
            .with('integer', () => {
              // Mojang why
              if (attribute.value === undefined) {
                // @author Claude - #[integer] requires a value with min constraint
                throw new Error('[mcdoc_assert] #[integer] attribute must have a value')
              }
              // I know this is bad, but hopefully this doesn't get used again
              if (attribute.value.kind !== 'tree' || !('min' in attribute.value.values) || attribute.value.values.min.kind !== 'literal' || attribute.value.values.min.value.value !== 1) {
                // @author Claude - #[integer] currently only supports {min: 1}
                throw new Error(`[mcdoc_assert] #[integer] attribute value must be a tree with 'min: 1', got: ${JSON.stringify(attribute.value)}`)
              }
              if (Object.keys(attribute.value.values).length > 1) {
                // @author Claude - only 'min' argument is currently supported
                throw new Error(`[mcdoc_assert] #[integer] attribute tree has unexpected extra arguments: ${Object.keys(attribute.value.values).filter(k => k !== 'min').join(', ')}`)
              }
            })
            .with('nbt', () => {
              if (attribute.value !== undefined && attribute.value.kind !== 'dispatcher' && attribute.value.kind !== 'reference') {
                // @author Claude - #[nbt] value must be a dispatcher or reference type
                throw new Error(`[mcdoc_assert] #[nbt] attribute value must be a dispatcher or reference, got kind '${attribute.value.kind}'`)
              }
              if (attribute.value?.kind === 'reference' && attribute.value.path === undefined) {
                // @author Claude - #[nbt] reference must have a valid path
                throw new Error('[mcdoc_assert] #[nbt] attribute reference value must have a defined path')
              }
            })
            .with('nbt_path', () => {
              if (attribute.value !== undefined && attribute.value.kind !== 'dispatcher') {
                // @author Claude - #[nbt_path] value must be a dispatcher type
                throw new Error(`[mcdoc_assert] #[nbt_path] attribute value must be a dispatcher, got kind '${attribute.value.kind}'`)
              }
            })
            .with('match_regex', () => {
              if (attribute.value === undefined || attribute.value.kind !== 'literal' || attribute.value.value.kind !== 'string') {
                // @author Claude - #[match_regex] requires a string literal pattern
                throw new Error(`[mcdoc_assert] #[match_regex] attribute value must be a string literal, got: ${JSON.stringify(attribute.value)}`)
              } else {
                try {
                  new RegExp(attribute.value.value.value)
                } catch (e) {
                  // @author Claude - regex pattern must be valid
                  throw new Error(`[mcdoc_assert] #[match_regex] attribute contains invalid regex pattern '${attribute.value.value.value}': ${e}`)
                }
              }
            })
            .with('permutation', () => {
              if (attribute.value === undefined) {
                // @author Claude - #[permutation] requires a value
                throw new Error('[mcdoc_assert] #[permutation] attribute must have a value')
              }
              if (!(attribute.value.kind === 'tree' && 'definition' in attribute.value.values && attribute.value.values.definition.kind === 'literal' && attribute.value.values.definition.value.value === true)) {
                // @author Claude - #[permutation] value must be {definition: true}
                throw new Error(`[mcdoc_assert] #[permutation] attribute value must be a tree with 'definition: true', got: ${JSON.stringify(attribute.value)}`)
              }
              if (Object.keys(attribute.value.values).length > 1) {
                // @author Claude - only 'definition' argument is allowed
                throw new Error(`[mcdoc_assert] #[permutation] attribute tree has unexpected extra arguments: ${Object.keys(attribute.value.values).filter(k => k !== 'definition').join(', ')}`)
              }
            })
            .with('entity', () => {
              if (attribute.value !== undefined) {
                if (attribute.value.kind !== 'tree') {
                  throw new Error(`[mcdoc_assert] #[entity] attribute value must contain arguments, received a ${attribute.value.kind}`)
                }
                const keys = new Set(Object.keys(attribute.value.values))

                if ('amount' in attribute.value.values) {
                  keys.delete('amount')
                  if (attribute.value.values.amount.kind !== 'literal' || attribute.value.values.amount.value.kind !== 'string') {
                    throw new Error(`[mcdoc_assert] #[entity(amount)] has unsupported value: ${JSON.stringify(attribute.value.values.amount)}`)
                  }
                  if (attribute.value.values.amount.value.value !== 'multiple' && attribute.value.values.amount.value.value !== 'single') {
                    throw new Error(`[mcdoc_assert] #[entity(amount="${attribute.value.values.amount.value.value}")] is unsupported`)
                  }
                }
                if ('type' in attribute.value.values) {
                  keys.delete('type')
                  if (attribute.value.values.type.kind !== 'literal' || attribute.value.values.type.value.kind !== 'string') {
                    throw new Error(`[mcdoc_assert] #[entity(type)] has unsupported value: ${JSON.stringify(attribute.value.values.type)}`)
                  }
                  if (attribute.value.values.type.value.value !== 'entities' && attribute.value.values.type.value.value !== 'players') {
                    throw new Error(`[mcdoc_assert] #[entity(type="${attribute.value.values.type.value.value}")] is unsupported`)
                  }
                }
                if (keys.size > 0) {
                  throw new Error(`[mcdoc_assert] Unsupported #[entity] attribute arguments: ${[...keys.values()].join(', ')}`)
                }
              }
            })
            .with('random', 'regex_pattern', 'time_pattern', 'canonical', 'text_component', 'score_holder', 'objective', 'translation_key', 'translation_value', 'item_slots', 'uuid', 'url', 'team', 'game_rule', 'tag', 'block_predicate', (a) => {
              // these two are old attributes
              if (a !== 'translation_key' && a !== 'game_rule' && attribute.value !== undefined) {
                console.log(attribute)
                throw new Error(`[mcdoc_assert] Unexpected value on attribute '${a}'`)
              }
            })
            .with('texture_slot', () => {
              if (attribute.value === undefined) {
                // @author Claude - #[texture_slot] requires a value with kind
                throw new Error('[mcdoc_assert] #[texture_slot] attribute must have a value')
              }
              if (attribute.value.kind !== 'tree' || !('kind' in attribute.value.values) || attribute.value.values.kind.kind !== 'literal' || !AssertKinds.TextureSlotAttributeKind.has(attribute.value.values.kind.value.value)) {
                // @author Claude - #[texture_slot] must have a valid kind value
                throw new Error(`[mcdoc_assert] #[texture_slot] attribute value must be a tree with a valid 'kind' (one of: ${[...AssertKinds.TextureSlotAttributeKind].join(', ')}), got: ${JSON.stringify(attribute.value)}`)
              }
              if (Object.keys(attribute.value.values).length > 1) {
                // @author Claude - only 'kind' argument is allowed
                throw new Error(`[mcdoc_assert] #[texture_slot] attribute tree has unexpected extra arguments: ${Object.keys(attribute.value.values).filter(k => k !== 'kind').join(', ')}`)
              }
            })
            .with('vector', () => {
              // Mojang why
              if (attribute.value === undefined) {
                // @author Claude - #[vector] requires dimension and integer values
                throw new Error('[mcdoc_assert] #[vector] attribute must have a value')
              }
              if (attribute.value.kind !== 'tree' || !('dimension' in attribute.value.values) || !('integer' in attribute.value.values)) {
                // @author Claude - #[vector] must have both dimension and integer arguments
                throw new Error(`[mcdoc_assert] #[vector] attribute value must be a tree with 'dimension' and 'integer' arguments, got: ${JSON.stringify(attribute.value)}`)
              }
              if (attribute.value.values.dimension.kind !== 'literal' || attribute.value.values.dimension.value.value !== 3) {
                // @author Claude - currently only 3D vectors are supported
                throw new Error(`[mcdoc_assert] #[vector(dimension)] must be 3, got: ${JSON.stringify(attribute.value.values.dimension)}`)
              }
              if (attribute.value.values.integer.kind !== 'literal' || attribute.value.values.integer.value.value !== true) {
                // @author Claude - integer must be true for integer vectors
                throw new Error(`[mcdoc_assert] #[vector(integer)] must be true, got: ${JSON.stringify(attribute.value.values.integer)}`)
              }
              if (Object.keys(attribute.value.values).length > 2) {
                // @author Claude - only 'dimension' and 'integer' arguments are supported
                throw new Error(`[mcdoc_assert] #[vector] attribute tree has unexpected extra arguments: ${Object.keys(attribute.value.values).filter(k => k !== 'dimension' && k !== 'integer').join(', ')}`)
              }
            })
            .exhaustive()
        } else if (attribute.value !== undefined) {
          switch (attribute.value.kind) {
            case 'literal': {
              if (attribute.value.value.kind !== 'string') {
                throw new Error(`[mcdoc_assert] Literal Attribute Type value type is an unsupported kind ${attribute}`)
              }
            } break
            case 'reference': {
              if (attribute.value.path === undefined) {
                throw new Error(`[mcdoc_assert] Reference Attribute Type value type must have a defined path ${attribute}`)
              }
            } break
            case 'tree': {
              for (const [key, value] of Object.entries(attribute.value.values)) {
                if (!Number.isNaN(Number(key.charAt(0)))) {
                  throw new Error(`[mcdoc_assert] Root Tree Attribute Type value type is an array, this is unsupported ${attribute}`)
                }
                if (!AssertKinds.AttributeTreeChildKind.has(value.kind)) {
                  throw new Error(`[mcdoc_assert] Root Tree Attribute Type value value is an unsupported kind ${attribute}`)
                }
                switch (value.kind) {
                  case 'literal': {
                    if (value.value.kind !== 'boolean' && value.value.kind !== 'string') {
                      throw new Error(`[mcdoc_assert] Numerical Literal Root Tree Attribute Type value value type is unsupported ${attribute}`)
                    }
                  } break
                  case 'tree': {
                    if (!('0' in value.values)) {
                      throw new Error(`[mcdoc_assert] Nested Named Tree Attribute value type is unsupported ${attribute}`)
                    }
                    for (const member of Object.values(value.values)) {
                      if (member.kind !== 'literal' || member.value.kind !== 'string') {
                        throw new Error(`[mcdoc_assert] Array Attribute Type value type is not string, this is unsupported ${attribute}`)
                      }
                    }
                  }
                }
              }
            } break
          }
        }
      }
    }
  }

  static DispatcherType(type: mcdoc.McdocType): asserts type is mcdoc.DispatcherType {
    if (type.kind !== 'dispatcher') { }
  }
  static IndexedType(type: mcdoc.McdocType): asserts type is mcdoc.IndexedType {
    if (type.kind !== 'indexed') {
      throw new Error(`[mcdoc_assert] Type is not an IndexedType: ${type.kind}`)
    }
  }
  static TemplateType(type: mcdoc.McdocType): asserts type is mcdoc.TemplateType {
    if (type.kind !== 'template') {
      throw new Error(`[mcdoc_assert] Type is not a TemplateType: ${type.kind}`)
    }
  }
  static ArrayType<KIND extends ('byte_array' | 'int_array' | 'long_array' | undefined) = undefined>(type: mcdoc.McdocType): asserts type is (
    KIND extends undefined ? never :
    mcdoc.PrimitiveArrayType & { kind: KIND }
  ) {
    if (!AssertKinds.ArrayKind.has(type.kind)) {
      throw new Error(`[mcdoc_assert] Type is not a PrimitiveArrayType: ${type.kind}`)
    }
  }
  static ListType(type: mcdoc.McdocType): asserts type is mcdoc.ListType {
    if (type.kind !== 'list') {
      throw new Error(`[mcdoc_assert] Type is not a ListType: ${type.kind}`)
    }
  }
  static EnumType(type: mcdoc.McdocType): asserts type is mcdoc.EnumType {
    if (type.kind !== 'enum') {
      throw new Error(`[mcdoc_assert] Type is not an EnumType: ${type.kind}`)
    }
  }
  static StructType(type: mcdoc.McdocType): asserts type is mcdoc.StructType {
    if (type.kind !== 'struct') {
      throw new Error(`[mcdoc_assert] Type is not a StructType: ${type.kind}`)
    }
  }
  static StructKeyType(type: mcdoc.McdocType): asserts type is (ReferenceType | mcdoc.ConcreteType | mcdoc.StringType | mcdoc.UnionType) {
    if (!AssertKinds.StructKeyKind.has(type.kind)) {
      throw new Error(`[mcdoc_assert] Struct field key must be a ReferenceType or StringType, got: ${type.kind}`)
    }
    if (type.kind === 'concrete' && (type.child.kind !== 'reference' || type.child.path === undefined)) {
      throw new Error(`[mcdoc_assert] Struct field key ConcreteType must wrap a ReferenceType with a defined path. ${type}`)
    }
    if (type.kind === 'reference' && type.path === undefined) {
      throw new Error(`[mcdoc_assert] Struct field key ReferenceType must have a path defined. ${type}`)
    }
  }
  static StructSpreadType(type: mcdoc.McdocType): asserts type is (ReferenceType | mcdoc.DispatcherType | mcdoc.ConcreteType | mcdoc.TemplateType | mcdoc.StructType | mcdoc.UnionType) {
    if (!AssertKinds.StructSpreadKind.has(type.kind)) {
      throw new Error(`[mcdoc_assert] Struct spread type must be a reference-alike, got: ${type.kind}`)
    }
    if (type.kind === 'reference' && type.path === undefined) {
      throw new Error(`[mcdoc_assert] Struct spread ReferenceType must have a path defined. ${type}`)
    }
  }
  static TupleType(type: mcdoc.McdocType): asserts type is mcdoc.TupleType {
    if (type.kind !== 'tuple') {
      throw new Error(`[mcdoc_assert] Type is not a TupleType: ${type.kind}`)
    }
  }
  static UnionType(type: mcdoc.McdocType): asserts type is mcdoc.UnionType {
    if (type.kind !== 'union') {
      throw new Error(`[mcdoc_assert] Type is not a UnionType: ${type.kind}`)
    }
  }
  static KeywordType<KIND extends (mcdoc.KeywordType['kind'] | undefined) = undefined>(type: mcdoc.McdocType): asserts type is (
    KIND extends undefined ? never :
    mcdoc.KeywordType & { kind: KIND }
  ) {
    if (type.kind !== 'any' && type.kind !== 'boolean' && type.kind !== 'unsafe') {
      throw new Error(`[mcdoc_assert] Type is not a KeywordType: ${type.kind}`)
    }
  }
  static NumericType<KIND extends (mcdoc.NumericTypeKind | undefined) = undefined>(type: mcdoc.McdocType): asserts type is (
    KIND extends undefined ? never :
    mcdoc.NumericType & { kind: KIND }
  ) {
    if (!AssertKinds.NumericKind.has(type.kind)) {
      throw new Error(`[mcdoc_assert] Type is not a NumericType: ${type.kind}`)
    }
  }
  static ConcreteType(type: mcdoc.McdocType): asserts type is (mcdoc.ConcreteType & { child: (ReferenceType | mcdoc.DispatcherType) }) {
    if (type.kind !== 'concrete') {
      throw new Error(`[mcdoc_assert] Type is not a ConcreteType: ${type.kind}`)
    }
    if (type.child.kind === 'reference') {
      if (type.child.path === undefined) {
        throw new Error(`[mcdoc_assert] ConcreteType child type of ReferenceType is missing a path: ${type}`)
      }
    } else if (type.child.kind !== 'dispatcher') {
      throw new Error(`[mcdoc_assert] Concrete child type is invalid: ${type}`)
    }
  }
  static LiteralType(type: mcdoc.McdocType): asserts type is mcdoc.LiteralType {
    if (type.kind !== 'literal') {
      throw new Error(`[mcdoc_assert] Type is not a LiteralType: ${type.kind}`)
    }
  }
  static ReferenceType(type: mcdoc.McdocType): asserts type is ReferenceType {
    if (type.kind !== 'reference' || type.path === undefined) {
      throw new Error(`[mcdoc_assert] Type is not a valid ReferenceType: ${type}`)
    }
  }
  static StringType(type: mcdoc.McdocType): asserts type is mcdoc.StringType {
    if (type.kind !== 'string') {
      throw new Error(`[mcdoc_assert] Type is not a StringType: ${type.kind}`)
    }
  }
  static ColorStringType(type: KindType<typeof AssertKinds.ColorAttributeKind>): asserts type is ('hex_argb' | 'hex_rgb') {
    if (type !== 'hex_argb' && type !== 'hex_rgb') {
      throw new Error(`[mcdoc_assert] String color type is not valid ${type}`)
    }
  }
}
