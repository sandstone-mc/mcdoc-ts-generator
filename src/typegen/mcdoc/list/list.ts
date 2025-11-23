import ts from 'typescript'
import { match, P } from 'ts-pattern'
import * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList, type TypeHandler } from '..'
import { Assert } from '../assert'
import { integer_range_size } from '../primitives/int'
import { Bind } from '../bind'
import { add_import } from '../utils'

const { factory } = ts

const NBTListType = 'NBTList'

const NBTListImport = `sandstone::${NBTListType}`

function mcdoc_list(type: mcdoc.McdocType) {
    const list = type
    Assert.ListType(list)

    return (...args: unknown[]) => {
        const item = TypeHandlers[list.item.kind](list.item)(...args)

        const imports = {
            ordered: 'imports' in item ? item.imports.ordered : ([NBTListImport] as NonEmptyList<string>),
            check: 'imports' in item ? item.imports.check : new Map<string, number>([[NBTListImport, 0]]),
        } as const

        if ('imports' in item && !imports.check.has(NBTListImport)) {
            add_import(imports, NBTListImport)
        }

        if (list.lengthRange) {
            const range = list.lengthRange

            const docs: NonEmptyList<string> = [
                `List length range: ${mcdoc.NumericRange.toString(range)}`
            ]
            const generic: ts.PropertySignature[] = []

            // This code still sucks and I still need to rewrite it again

            let has_min = false
            let has_max = false
            const left_exclusive = mcdoc.RangeKind.isLeftExclusive(range.kind)
            const right_exclusive = mcdoc.RangeKind.isRightExclusive(range.kind)

            // actual capabilities that will be provided inside `NBTList`
            // FixedLengthList, RangedList, NonEmptyList, Array
            // We can probably play around with `Exclude` too

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
                    docs.push(`Effective minimum list length: ${range.min + 1}`)
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
                    docs.push(`Effective maximum list length: ${range.max - 1}`)
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

            return {
                type: factory.createTypeReferenceNode('NBTList', [
                    item.type,
                    factory.createTypeLiteralNode(generic),
                ]),
                imports,
                docs,
            } as const
        } else {
            return {
                type: factory.createTypeReferenceNode('NBTList', [item.type]),
                imports,
            } as const
        }
    }
}

export const McdocList = mcdoc_list satisfies TypeHandler