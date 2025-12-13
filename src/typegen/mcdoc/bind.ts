import ts from 'typescript'

const { factory } = ts

type NonEmptyList<T> = T[] & { 0: T }

export class Bind {
    static NumericLiteral(literal: number) {
        if (Math.sign(literal) === -1) {
            return factory.createLiteralTypeNode(factory.createPrefixUnaryExpression(
                ts.SyntaxKind.MinusToken,
                factory.createNumericLiteral(Math.abs(literal))
            ))
        } else {
            return factory.createLiteralTypeNode(factory.createNumericLiteral(literal))
        }
    }
    static StringLiteral(literal: string) {
        return factory.createLiteralTypeNode(factory.createStringLiteral(literal, true))
    }

    // TODO: Implement this in LiteralUnion
    /**
     * Creates a template literal type that represents a non-empty string.
     * ```ts
     * type NonEmptyString = `${any}${string}` // <-- This type
     * ```
     */
    static readonly NonEmptyString = factory.createTemplateLiteralType(
        factory.createTemplateHead(''),
        [
            factory.createTemplateLiteralTypeSpan(
                factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                factory.createTemplateMiddle('')
            ),
            factory.createTemplateLiteralTypeSpan(
                factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                factory.createTemplateTail('')
            )
        ]
    )

    /**
     * Creates a TypeScript type that represents an empty object.
     * ```ts
     * type EmptyObject = Record<string, never> // <-- This type
     * ```
     */
    static readonly EmptyObject = factory.createTypeReferenceNode('Record', [
        factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
        factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
    ])

    static DocPart(doc: string) {
        return doc.trim().replaceAll('\n\n\n\n ', '@@bad@@').replaceAll('\n\n', '\n').replaceAll('@@bad@@', '\n\n').split('\n')
    }

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
                    const sanitized = _doc[0].trim().replaceAll('\n\n\n\n ', '@@bad@@').replaceAll('\n\n', '\n').replaceAll('@@bad@@', '\n\n').split('\n')
                    for (const __doc of sanitized) {
                        if (__doc === '') {
                            doc += '\n *'
                        } else {
                            doc += `\n * ${__doc}`
                        }
                    }
                } catch (e) {
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