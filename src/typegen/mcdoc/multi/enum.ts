import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { TypeHandler } from '..'
import { Assert } from '../assert'

const { factory } = ts

// `enum` exists at runtime because people still use vanilla JS, so we need dedicated binders.
const Bind = {
    NumericLiteral(literal: number) {
        if (Math.sign(literal) === -1) {
            return factory.createPrefixUnaryExpression(
                ts.SyntaxKind.MinusToken,
                factory.createNumericLiteral(Math.abs(literal))
            )
        }
        return factory.createNumericLiteral(literal)
    },
    StringLiteral(literal: string) {
        return factory.createStringLiteral(literal, true)
    }
} as const

function mcdoc_enum(type: mcdoc.McdocType) {
    const enum_type = type
    Assert.EnumType(enum_type)

    return (...args: unknown[]) => {
        // The module path generator provides the name for enums
        const [ named ] = args as [string]

        const bind_value = enum_type.enumKind === 'string'
            ? (value: string | number) => Bind.StringLiteral(value as string)
            : (value: number | string) => Bind.NumericLiteral(value as number)

        const members = enum_type.values.map((member) =>
            factory.createEnumMember(
                factory.createIdentifier(member.identifier),
                bind_value(member.value),
            )
        )

        return {
            type: factory.createEnumDeclaration(
                undefined,
                factory.createIdentifier(named),
                members,
            ),
        }
    }
}

export const McdocEnum = mcdoc_enum satisfies TypeHandler