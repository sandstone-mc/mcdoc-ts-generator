import * as mcdoc from '@spyglassmc/mcdoc'
import ts from 'typescript'
import { Assert } from '../assert'
import { Bind } from '../bind'
import type { NonEmptyList, TypeHandler } from '..'

const { factory } = ts

const NBTIntType = 'NBTInt'

function mcdoc_int(type: mcdoc.McdocType) {
    const int = type
    Assert.NumericType<'int'>(int)

    return (args: Record<string, unknown>) => {
        if (int.valueRange === undefined) {
            return {
                type: factory.createTypeReferenceNode(NBTIntType),
                imports: {
                    ordered: [`sandstone::${NBTIntType}`] as NonEmptyList<string>,
                    check: new Map([[`sandstone::${NBTIntType}`, 0]]) as Map<string, number>,
                },
            } as const
        } else {
            return whole_number_generic(int.valueRange, NBTIntType)
        }
    }
}

export const McdocInt = mcdoc_int satisfies TypeHandler


/**
 * 
 */
export function whole_number_generic<TYPE extends string>(range: mcdoc.NumericRange, type: TYPE) {
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
        if (left_exclusive) {
            docs.push(`Effective minimum: ${range.min + 1}`)
        }
    }
    if (range.max !== undefined) {
        has_max = true
        if (right_exclusive) {
            docs.push(`Effective maximum: ${range.max - 1}`)
        }
    }

    if (has_min && has_max) {
        if (integer_range_size(range.min!, range.max!) <= 100) {
            generic.push(
                factory.createPropertySignature(
                    undefined,
                    'min',
                    undefined,
                    Bind.NumericLiteral(range.min! + (left_exclusive ? 1 : 0))
                ),
                factory.createPropertySignature(
                    undefined,
                    'max',
                    undefined,
                    Bind.NumericLiteral(range.max! - (right_exclusive ? 1 : 0))
                )
            )
        } else if (range.min! >= 0) {
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

    /**
     * We don't allow for `number` for int because the `WholeNumber` trick only works for function generics, not type aliases.
     */
    return {
        type: factory.createTypeReferenceNode(type, [
            factory.createTypeLiteralNode(generic)
        ]),
        docs: docs as NonEmptyList<string>,
        imports: {
            ordered: [`sandstone::${type}`] as NonEmptyList<string>,
            check: new Map([[`sandstone::${type}`, 0]]) as Map<string, number>,
        } as const,
    } as const
}

/**
 * Returns the number of valid values within the range.
 * Lower value must actually be lower than the upper
 */
export function integer_range_size(lower: number, upper: number) {
	if (lower > upper) {
		throw new Error()
	}
	if (upper < 0) {
		return lower*-1 - upper*-1
	}
	if (lower < 0) {
		return lower*-1 + upper
	}
	return upper - lower
}