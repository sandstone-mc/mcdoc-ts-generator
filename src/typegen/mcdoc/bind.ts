import ts from 'typescript'
import { abs, sign } from './utils'

const { factory } = ts

type NonEmptyList<T> = T[] & { 0: T }

export class Bind {
  static NumericLiteral(literal: number | bigint) {
    const innerLiteral = (num: number | bigint) => typeof num === 'number' ? factory.createNumericLiteral(num) : factory.createBigIntLiteral(`${literal}n`)
    if (sign(literal) === -1) {
      return factory.createLiteralTypeNode(factory.createPrefixUnaryExpression(
        ts.SyntaxKind.MinusToken,
        innerLiteral(abs(literal)),
      ))
    } else {
      return factory.createLiteralTypeNode(innerLiteral(literal))
    }
  }
  static StringLiteral(literal: string) {
    return factory.createLiteralTypeNode(factory.createStringLiteral(literal, true))
  }

  /**
   * Creates a mapped type with optional properties.
   *
   * The key type is always wrapped in `Extract<KeyType, string>` for safety.
   *
   * @param key_type - The type to iterate over (will be wrapped in Extract)
   * @param value_type - The type of each property value
   * @param options.key_name - The name of the type parameter (default `'Key'`)
   * @param options.name_type - Optional key remapping type (the `as` clause)
   * @param options.parenthesized - Whether to wrap the result in parentheses (default `true`)
   * @returns A mapped type node: `({ [Key in Extract<KeyType, string>]?: ValueType })`
   *
   * @example
   * ```ts
   * // Default usage:
   * Bind.MappedType(keyType, valueType)
   * // Produces: ({ [Key in Extract<KeyType, string>]?: ValueType })
   *
   * // Custom key name, no parentheses:
   * Bind.MappedType(keyType, valueType, { key_name: 'S', parenthesized: false })
   * // Produces: { [S in Extract<KeyType, string>]?: ValueType }
   *
   * // With key remapping (as clause):
   * Bind.MappedType(keyType, valueType, { name_type: templateLiteralType })
   * // Produces: ({ [Key in Extract<KeyType, string> as TemplateLiteralType]?: ValueType })
   * ```
   */
  static MappedType(key_type: ts.TypeNode, value_type: ts.TypeNode, options?: { key_name?: string, name_type?: ts.TypeNode, parenthesized?: boolean }) {
    const { key_name = 'Key', name_type, parenthesized = true } = options ?? {}
    const constraint_type = key_type.kind === ts.SyntaxKind.StringKeyword ?
      factory.createTypeReferenceNode('NonEmptyString')
      : factory.createTypeReferenceNode('Extract', [
        key_type,
        factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
      ])

    const mapped_type = factory.createMappedTypeNode(
      undefined,
      factory.createTypeParameterDeclaration(
        undefined,
        key_name,
        constraint_type,
      ),
      name_type,
      factory.createToken(ts.SyntaxKind.QuestionToken),
      value_type,
      undefined,
    )
    return parenthesized ? factory.createParenthesizedType(mapped_type) : mapped_type
  }

  /**
   * Creates a TypeScript type that represents an empty object.
   * ```ts
   * type EmptyObject = Record<string, never>
   * ```
   */
  static readonly EmptyObject = factory.createTypeReferenceNode('Record', [
    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
    factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword),
  ])

  /**
   * https://stackoverflow.com/questions/67575784/typescript-ast-factory-how-to-use-comments
   */
  static Doc<N extends ts.Node>(node: N, docs?: NonEmptyList<string | [string]>): N {
    let doc: string = '*'
    if (docs === undefined) {
      return node
    }
    for (const _doc of docs) {
      if (Array.isArray(_doc)) {
        // y e s
        try {
          const sanitized = _doc[0].trim().split('\n')
          for (const __doc of sanitized) {
            if (__doc === '') {
              doc += '\n *'
            } else {
              doc += `\n * ${__doc}`
            }
          }
        } catch {
          console.log(node, docs)
        }
      } else {
        if (_doc === '') {
          doc += '\n *'
        } else {
          doc += `\n * ${_doc}`
        }
      }
    }
    return ts.addSyntheticLeadingComment(
      node,
      ts.SyntaxKind.MultiLineCommentTrivia,
      `${doc}\n `,
      true,
    )
  }
}
