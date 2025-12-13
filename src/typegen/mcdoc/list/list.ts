import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList, type TypeHandler, type TypeHandlerResult } from '..'
import { Assert } from '../assert'
import { Bind } from '../bind'
import { integer_range_size } from '../primitives/int'
import { add_import, merge_imports } from '../utils'
import { add } from '../../../util'

const { factory } = ts

const NBTListType = 'NBTList'

const NBTListImport = `sandstone::${NBTListType}`

function mcdoc_list(type: mcdoc.McdocType) {
    const list = type
    Assert.ListType(list)

    return (args: Record<string, unknown>) => {
        args.root_type = false
        const item = TypeHandlers[list.item.kind](list.item)(args)

        let imports: TypeHandlerResult['imports'] = 'imports' in item ? item.imports : undefined

        const child_dispatcher = 'child_dispatcher' in item ? ((item.child_dispatcher as NonEmptyList<[number, string]>).map(([parent_count, property]) => {
            if (parent_count === 0) {
                throw new Error(`[mcdoc_list] List contains a dynamic dispatcher with invalid parenting: ${item}`)
            }
            return [parent_count - 1, property]
        }) as NonEmptyList<[number, string]>) : undefined

        if (list.lengthRange) {
            const { generic, docs } = length_range_generic(list.lengthRange, 'List')

            imports = add_import(imports, NBTListImport)

            return {
                type: factory.createTypeReferenceNode(NBTListType, [
                    item.type,
                    factory.createTypeLiteralNode(generic),
                ]),
                docs,
                ...add({imports, child_dispatcher}),
            } as const
        } else {
            return {
                type: factory.createTypeReferenceNode('Array', [item.type]),
                ...add({imports, child_dispatcher}),
            } as const
        }
    }
}

export const McdocList = mcdoc_list satisfies TypeHandler

/**
 * Generates TypeScript property signatures and documentation for a length range constraint.
 * Used by list and primitive array types (byte_array, int_array, long_array).
 *
 * @param range The numeric range constraint
 * @param label Label for docs (e.g., "List", "Array")
 * @returns Object with `generic` (property signatures) and `docs` (documentation strings)
 */
export function length_range_generic(range: mcdoc.NumericRange, label: string): {
    generic: ts.PropertySignature[]
    docs: NonEmptyList<string>
} {
    const docs: NonEmptyList<string> = [
        `${label} length range: ${mcdoc.NumericRange.toString(range)}`
    ]
    const generic: ts.PropertySignature[] = []

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
            docs.push(`Effective minimum ${label.toLowerCase()} length: ${range.min + 1}`)
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
            docs.push(`Effective maximum ${label.toLowerCase()} length: ${range.max - 1}`)
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

    return { generic, docs }
}