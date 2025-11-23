import * as mcdoc from '@spyglassmc/mcdoc'
import ts from 'typescript'
import { Assert } from '../assert'
import { Bind } from '../bind'
import type { NonEmptyList, TypeHandler } from '..'

const { factory } = ts

const NBTDoubleType = 'NBTDouble'

function mcdoc_double(type: mcdoc.McdocType) {
    const double = type
    Assert.NumericType<'double'>(double)

    return (...args: unknown[]) => {
        if (double.valueRange === undefined) {
            return {
                type: factory.createParenthesizedType(factory.createUnionTypeNode([
                    factory.createTypeReferenceNode(NBTDoubleType),
                    factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword)
                ])),
                imports: {
                    ordered: [`sandstone::${NBTDoubleType}`] as NonEmptyList<string>,
                    check: new Map([[`sandstone::${NBTDoubleType}`, 0]]) as Map<string, number>,
                },
            } as const
        } else {
            return non_integral_generic(double.valueRange, NBTDoubleType, true)
        }
    }
}

export const McdocDouble = mcdoc_double satisfies TypeHandler


export function non_integral_generic<TYPE extends string, JS_NUMBER_ALLOWED extends (true | undefined)>(range: mcdoc.NumericRange, type: TYPE, allow_js_number?: JS_NUMBER_ALLOWED) {
    const docs: string[] & { 0: string } = [
        `Range: ${mcdoc.NumericRange.toString(range)}`
    ]
    const generic: ts.PropertySignature[] = []
    // This code still sucks and I still need to rewrite it again
    let has_min = false
    let has_max = false
    const left_exclusive = mcdoc.RangeKind.isLeftExclusive(range.kind)
    const right_exclusive = mcdoc.RangeKind.isRightExclusive(range.kind)

    if (range.min !== undefined) {
        has_min = true
        generic.push(factory.createPropertySignature(
            undefined,
            'leftExclusive',
            undefined,
            factory.createLiteralTypeNode(
                left_exclusive ?
                    factory.createTrue() :
                    factory.createFalse()
            )
        ))
        if (left_exclusive) {
            docs.push(`Minimum is exclusive; must be higher than ${range.min}`)
        }
    }
    if (range.max !== undefined) {
        has_max = true
        generic.push(factory.createPropertySignature(
            undefined,
            'rightExclusive',
            undefined,
            factory.createLiteralTypeNode(
                right_exclusive ?
                    factory.createTrue() :
                    factory.createFalse()
            )
        ))
        if (right_exclusive) {
            docs.push(`Maximum is exclusive; must be lower than ${range.max}`)
        }
    }

    if (has_min && has_max) {
        // TODO
        if (range.min === 0 && range.max === 1) {
            generic.push(factory.createPropertySignature(
                undefined,
                'min',
                undefined,
                Bind.NumericLiteral(0)
            ))
            generic.push(factory.createPropertySignature(
                undefined,
                'max',
                undefined,
                Bind.NumericLiteral(1)
            ))
        }
    } else if (has_min) {
        if (range.min! >= 0) {
            let number = 0
            if ((left_exclusive && range.min! === 0) || range.min! >= 1) {
                number = 1
            }
            generic.push(factory.createPropertySignature(
                undefined,
                'min',
                undefined,
                Bind.NumericLiteral(number)
            ))
        } else if (left_exclusive) {
            generic.push(factory.createPropertySignature(
                undefined,
                'min',
                undefined,
                Bind.NumericLiteral(range.min!)
            ))
        }
    } else {
        if (range.max! < 0 || (right_exclusive && range.max! === 0)) {
            generic.push(factory.createPropertySignature(
                undefined,
                'max',
                undefined,
                Bind.NumericLiteral(-1)
            ))
        } else if (right_exclusive) {
            generic.push(factory.createPropertySignature(
                undefined,
                'max',
                undefined,
                Bind.NumericLiteral(range.max!)
            ))
        }
    }

    const returned_type = allow_js_number ?
        factory.createParenthesizedType(factory.createUnionTypeNode([
            factory.createTypeReferenceNode(type, [
                factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
                factory.createTypeLiteralNode(generic)
            ]),
            /** 
             * Yes this could be made more type-safe using the same conditional types that are being used in NBTDouble, but generally speaking if people want higher type-safety they should be using the NBT types anyway.
             */
            factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword)
        ])) :
        factory.createTypeReferenceNode(type, [
            factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
            factory.createTypeLiteralNode(generic)
        ])

    return {
        type: returned_type as JS_NUMBER_ALLOWED extends true ? ts.ParenthesizedTypeNode : ts.TypeReferenceNode,
        docs: docs as NonEmptyList<string>,
        imports: {
            ordered: [`sandstone::${type}`] as NonEmptyList<string>,
            check: new Map([[`sandstone::${type}`, 0]]) as Map<string, number>,
        } as const,
    } as const
}