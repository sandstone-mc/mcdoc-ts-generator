import ts from 'typescript'

const { factory } = ts

/**
 * Creates a TypeScript type that represents an empty object.
 * ```ts
 * type EmptyObject = Record<string, never> // <-- This type
 * ```
 */
export const EmptyObject = factory.createTypeReferenceNode('Record', [
    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
    factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
])

// TODO: Implement this in LiteralUnion
/**
 * Creates a template literal type that represents a non-empty string.
 * ```ts
 * type NonEmptyString = `${any}${string}` // <-- This type
 * ```
 */
export const NonEmptyString = factory.createTemplateLiteralType(
    factory.createTemplateHead('', ''),
    [
        factory.createTemplateLiteralTypeSpan(
            factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
            factory.createTemplateMiddle('', '')
        ),
        factory.createTemplateLiteralTypeSpan(
            factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
            factory.createTemplateTail('', '')
        )
    ]
)