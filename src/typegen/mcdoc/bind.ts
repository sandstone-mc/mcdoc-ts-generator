import ts from 'typescript'

const { factory } = ts

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
}