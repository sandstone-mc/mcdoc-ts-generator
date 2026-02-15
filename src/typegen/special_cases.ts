import ts from 'typescript'
import type { TypeHandlerResult } from './mcdoc'
import { add_import } from './mcdoc/utils'
import { Bind } from './mcdoc/bind'

const { factory } = ts

/**
 * Special case overrides for types that can't be correctly generated from mcdoc.
 *
 * These are hardcoded due to:
 * - Upstream vanilla-mcdoc issues
 * - Complex patterns not representable in the mcdoc type system
 * - TypeScript optimizations (e.g., using keyof Symbol instead of Registry[...])
 */

export type SpecialCaseResult = {
  type: ts.TypeNode
  imports: TypeHandlerResult['imports'] | undefined
  /** Optional type parameters for generic type aliases */
  typeParameters?: ts.TypeParameterDeclaration[]
}

/**
 * Map of full symbol paths to their hardcoded type generators.
 *
 * Checked before standard type resolution in resolve_module_symbols().
 */
export const SPECIAL_CASES = new Map<string, () => SpecialCaseResult>([
  // EntityEffect: Use LiteralUnion<keyof SymbolEntityEffect> instead of Registry-based pattern
  // TODO: This reduces type complexity for sandstone for this type, but really this should be addressed more broadly for all patterns similar to this. Might want an upstream solution though because dispatcher docs are desirable.
  ['::java::data::enchantment::effect::EntityEffect', (): SpecialCaseResult => {
    let imports: TypeHandlerResult['imports'] = undefined as unknown as TypeHandlerResult['imports']
    imports = add_import(imports, 'sandstone::LiteralUnion')
    imports = add_import(imports, '::java::dispatcher::SymbolEntityEffect')
    imports = add_import(imports, 'sandstone::arguments::nbt::RootNBT')

    // ({
    //   [S in LiteralUnion<keyof SymbolEntityEffect>]?: ({
    //     type: S
    //   } & (S extends keyof SymbolEntityEffect ? SymbolEntityEffect[S] : RootNBT))
    // }[LiteralUnion<keyof SymbolEntityEffect>])
    const key_type = factory.createTypeReferenceNode('LiteralUnion', [
      factory.createTypeOperatorNode(
        ts.SyntaxKind.KeyOfKeyword,
        factory.createTypeReferenceNode('SymbolEntityEffect'),
      ),
    ])

    const value_type = factory.createParenthesizedType(factory.createIntersectionTypeNode([
      factory.createTypeLiteralNode([
        factory.createPropertySignature(
          undefined,
          'type',
          undefined,
          factory.createTypeReferenceNode('S'),
        ),
      ]),
      factory.createParenthesizedType(factory.createConditionalTypeNode(
        factory.createTypeReferenceNode('S'),
        factory.createTypeOperatorNode(
          ts.SyntaxKind.KeyOfKeyword,
          factory.createTypeReferenceNode('SymbolEntityEffect'),
        ),
        factory.createIndexedAccessTypeNode(
          factory.createTypeReferenceNode('SymbolEntityEffect'),
          factory.createTypeReferenceNode('S'),
        ),
        factory.createTypeReferenceNode('RootNBT'),
      )),
    ]))

    const mapped_type = Bind.MappedType(key_type, value_type, { key_name: 'S', parenthesized: false })

    return {
      type: factory.createParenthesizedType(factory.createIndexedAccessTypeNode(
        factory.createParenthesizedType(mapped_type),
        key_type,
      )) as ts.TypeNode,
      imports,
    }
  }],

  // BlockStateProperty: Simple object type instead of dispatcher pattern
  // This type technically works but it is way too large for TS to handle, it needs to be simplified at an unfortunate cost.
  ['::java::data::loot::condition::BlockStateProperty', (): SpecialCaseResult => {
    let imports: TypeHandlerResult['imports'] = undefined as unknown as TypeHandlerResult['imports']
    imports = add_import(imports, '::java::registry::Registry')
    imports = add_import(imports, '::java::dispatcher::SymbolMcdocBlockStates')

    // {
    //   block: Registry['minecraft:block']
    //   properties?: SymbolMcdocBlockStates<'%none'>
    // }
    return {
      type: factory.createTypeLiteralNode([
        factory.createPropertySignature(
          undefined,
          'block',
          undefined,
          factory.createIndexedAccessTypeNode(
            factory.createTypeReferenceNode('Registry'),
            Bind.StringLiteral('minecraft:block'),
          ),
        ),
        factory.createPropertySignature(
          undefined,
          'properties',
          factory.createToken(ts.SyntaxKind.QuestionToken),
          factory.createTypeReferenceNode('SymbolMcdocBlockStates', [
            Bind.StringLiteral('%none'),
          ]),
        ),
      ]) as ts.TypeNode,
      imports,
    }
  }],

  // DataComponentPatch: Use keyof SymbolDataComponent instead of Registry pattern
  // TODO: same issue as EntityEffect but further complicated by negation component patches.
  ['::java::world::component::DataComponentPatch', (): SpecialCaseResult => {
    let imports: TypeHandlerResult['imports'] = undefined as unknown as TypeHandlerResult['imports']
    imports = add_import(imports, '::java::dispatcher::SymbolDataComponent')

    // (
    //   ({
    //     [Key in keyof SymbolDataComponent]?: (SymbolDataComponent[Key])
    //   })
    //   & ({
    //     [Key in keyof SymbolDataComponent as `!${Extract<Key, string>}`]?: Record<string, never>
    //   })
    // )
    const keyof_symbol = factory.createTypeOperatorNode(
      ts.SyntaxKind.KeyOfKeyword,
      factory.createTypeReferenceNode('SymbolDataComponent'),
    )

    const base_mapped_type = Bind.MappedType(
      keyof_symbol,
      factory.createParenthesizedType(factory.createIndexedAccessTypeNode(
        factory.createTypeReferenceNode('SymbolDataComponent'),
        factory.createTypeReferenceNode('Key'),
      )),
      { parenthesized: false },
    )

    // Negation mapped type: [Key in keyof SymbolDataComponent as `!${Extract<Key, string>}`]?: Record<string, never>
    const negation_name_type = factory.createTemplateLiteralType(
      factory.createTemplateHead('!'),
      [factory.createTemplateLiteralTypeSpan(
        factory.createTypeReferenceNode('Extract', [
          factory.createTypeReferenceNode('Key'),
          factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
        ]),
        factory.createTemplateTail(''),
      )],
    )

    const negation_mapped_type = Bind.MappedType(
      keyof_symbol,
      Bind.EmptyObject,
      { name_type: negation_name_type, parenthesized: false },
    )

    return {
      type: factory.createParenthesizedType(factory.createIntersectionTypeNode([
        factory.createParenthesizedType(base_mapped_type),
        factory.createParenthesizedType(negation_mapped_type),
      ])) as ts.TypeNode,
      imports,
    }
  }],

  // ComponentStrings: Use keyof SymbolDataComponent instead of Registry pattern
  // Avoids TypeScript error where conditional type can't satisfy NBTObject constraint
  ['::java::assets::item_definition::ComponentStrings', (): SpecialCaseResult => {
    let imports: TypeHandlerResult['imports'] = undefined as unknown as TypeHandlerResult['imports']
    imports = add_import(imports, '::java::dispatcher::SymbolDataComponent')
    imports = add_import(imports, '::java::assets::item_definition::SelectCases')
    imports = add_import(imports, 'sandstone::arguments::nbt::RootNBT')

    // (NonNullable<({
    //   [S in keyof SymbolDataComponent]?: ({
    //     component: S,
    //   } & SelectCases<SymbolDataComponent[S]>)
    // }[keyof SymbolDataComponent])> | (RootNBT & {
    //   component: `${string}${string}`
    // }))
    const keyof_symbol = factory.createTypeOperatorNode(
      ts.SyntaxKind.KeyOfKeyword,
      factory.createTypeReferenceNode('SymbolDataComponent'),
    )

    const component_property = factory.createPropertySignature(
      undefined,
      'component',
      undefined,
      factory.createTypeReferenceNode('S'),
    )

    // Add JSDoc to the component property
    const component_property_with_doc = Bind.Doc(component_property, [
      'The component type to check the values of.',
      'If the selected value comes from a registry that the client doesn\'t have access to,',
      'the entry will be silently ignored.',
    ])

    const value_type = factory.createParenthesizedType(factory.createIntersectionTypeNode([
      factory.createTypeLiteralNode([component_property_with_doc]),
      factory.createTypeReferenceNode('SelectCases', [
        factory.createIndexedAccessTypeNode(
          factory.createTypeReferenceNode('SymbolDataComponent'),
          factory.createTypeReferenceNode('S'),
        ),
      ]),
    ]))

    const mapped_type = Bind.MappedType(keyof_symbol, value_type, { key_name: 'S', parenthesized: false })

    const indexed_access = factory.createIndexedAccessTypeNode(
      factory.createParenthesizedType(mapped_type),
      keyof_symbol,
    )

    const non_nullable = factory.createTypeReferenceNode('NonNullable', [
      factory.createParenthesizedType(indexed_access),
    ])

    // Fallback: (RootNBT & { component: `${string}${string}` })
    const fallback_type = factory.createParenthesizedType(factory.createIntersectionTypeNode([
      factory.createTypeReferenceNode('RootNBT'),
      factory.createTypeLiteralNode([
        factory.createPropertySignature(
          undefined,
          'component',
          undefined,
          factory.createTemplateLiteralType(
            factory.createTemplateHead(''),
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
        ),
      ]),
    ]))

    return {
      type: factory.createParenthesizedType(factory.createUnionTypeNode([
        non_nullable,
        fallback_type,
      ])) as ts.TypeNode,
      imports,
    }
  }],

  // Text: Use NBTList<(string | TextObject), ...> instead of NBTList<Text, ...>
  // Recursive type causes issues, need non-recursive alternative
  ['::java::util::text::Text', (): SpecialCaseResult => {
    let imports: TypeHandlerResult['imports'] = undefined as unknown as TypeHandlerResult['imports']
    imports = add_import(imports, '::java::util::text::TextObject')
    imports = add_import(imports, 'sandstone::NBTList')

    // (string | TextObject | NBTList<(string | TextObject), {
    //   leftExclusive: false
    //   min: 1
    // }>)
    const text_content = factory.createParenthesizedType(factory.createUnionTypeNode([
      factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
      factory.createTypeReferenceNode('TextObject'),
    ]))

    return {
      type: factory.createParenthesizedType(factory.createUnionTypeNode([
        factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
        factory.createTypeReferenceNode('TextObject'),
        factory.createTypeReferenceNode('NBTList', [
          text_content,
          factory.createTypeLiteralNode([
            factory.createPropertySignature(
              undefined,
              'leftExclusive',
              undefined,
              factory.createLiteralTypeNode(factory.createFalse()),
            ),
            factory.createPropertySignature(
              undefined,
              'min',
              undefined,
              Bind.NumericLiteral(1),
            ),
          ]),
        ]),
      ])) as ts.TypeNode,
      imports,
    }
  }],

  // CraftingShaped: Generic type that derives `key` from `pattern` characters
  // This enables compile-time validation that key entries match characters used in the pattern
  ['::java::data::recipe::CraftingShaped', (): SpecialCaseResult => {
    let imports: TypeHandlerResult['imports'] = undefined as unknown as TypeHandlerResult['imports']
    imports = add_import(imports, '::java::data::recipe::NotificationInfo')
    imports = add_import(imports, '::java::data::recipe::CraftingBookInfo')
    imports = add_import(imports, '::java::data::recipe::Ingredient')
    imports = add_import(imports, '::java::world::item::ItemStackTemplate')
    imports = add_import(imports, 'sandstone::arguments::StringSmallerThan4')
    imports = add_import(imports, 'sandstone::arguments::PatternKeys')

    // Type parameter: PATTERN extends readonly [StringSmallerThan4<string>, StringSmallerThan4<string>?, StringSmallerThan4<string>?]
    //                       = readonly [string, string?, string?]
    const stringSmallerThan4String = factory.createTypeReferenceNode('StringSmallerThan4', [
      factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
    ])

    const patternConstraint = factory.createTypeOperatorNode(
      ts.SyntaxKind.ReadonlyKeyword,
      factory.createTupleTypeNode([
        stringSmallerThan4String,
        factory.createOptionalTypeNode(stringSmallerThan4String),
        factory.createOptionalTypeNode(stringSmallerThan4String),
      ]),
    )

    const patternDefault = factory.createTypeOperatorNode(
      ts.SyntaxKind.ReadonlyKeyword,
      factory.createTupleTypeNode([
        factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
        factory.createOptionalTypeNode(factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)),
        factory.createOptionalTypeNode(factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)),
      ]),
    )

    const patternTypeParam = factory.createTypeParameterDeclaration(
      undefined,
      'PATTERN',
      patternConstraint,
      patternDefault,
    )

    // Build the type body: (NotificationInfo & CraftingBookInfo & { pattern: PATTERN, key: PatternKeys<PATTERN, Ingredient>, result: ItemStackTemplate })
    const typeBody = factory.createParenthesizedType(factory.createIntersectionTypeNode([
      factory.createTypeReferenceNode('NotificationInfo'),
      factory.createTypeReferenceNode('CraftingBookInfo'),
      factory.createTypeLiteralNode([
        factory.createPropertySignature(
          undefined,
          'pattern',
          undefined,
          factory.createTypeReferenceNode('PATTERN'),
        ),
        factory.createPropertySignature(
          undefined,
          'key',
          undefined,
          factory.createTypeReferenceNode('PatternKeys', [
            factory.createTypeReferenceNode('PATTERN'),
            factory.createTypeReferenceNode('Ingredient'),
          ]),
        ),
        factory.createPropertySignature(
          undefined,
          'result',
          undefined,
          factory.createTypeReferenceNode('ItemStackTemplate'),
        ),
      ]),
    ]))

    return {
      type: typeBody,
      imports,
      typeParameters: [patternTypeParam],
    }
  }],
])

/**
 * Get the special case result for a symbol path, or undefined if not a special case.
 */
export function get_special_case(path: string): SpecialCaseResult | undefined {
  const generator = SPECIAL_CASES.get(path)
  if (generator) {
    return generator()
  }
  return undefined
}
