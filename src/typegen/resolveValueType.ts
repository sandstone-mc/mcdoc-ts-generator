import * as mcdoc from '@spyglassmc/mcdoc'
import ts from 'typescript'
import { add, integer_range_size, pascal_case, type ResolvedValueType } from '../util'
import { bindImport, bindNumericLiteral } from './binders'
import { nonEmptyString } from './static'
import type { TypesGenerator } from '.'

const { factory } = ts

// TODO: refactor use of bindRangedWholeNumber and finish range work

export function resolveValueType(type: mcdoc.McdocType, original_symbol: string, target_path: string, type_gen: TypesGenerator): ResolvedValueType {
    let doc_value: string[] = []
    const doc = () => add('doc', doc_value.length !== 0 ? doc_value : undefined)

    //console.log('\n\n')
    /* @ts-ignore */
    //console.log(JSON.stringify(type, null, 2))

    let numerical_range = factory.createTypeLiteralNode([])

    // TODO: implement special case value range handling
    if (Object.hasOwn(type, 'valueRange')) {
        const rangedType = type as (mcdoc.NumericType & { valueRange: mcdoc.NumericRange})

        let exceptions: string = ''

        const beginExclusive = mcdoc.RangeKind.isLeftExclusive(rangedType.valueRange.kind)

        const endExclusive = mcdoc.RangeKind.isRightExclusive(rangedType.valueRange.kind)

        let closedRange = false

        if (
            rangedType.valueRange.min !== undefined 
            && rangedType.valueRange.max !== undefined 
            && rangedType.kind !== 'double' 
            && rangedType.kind !== 'float' 
            && integer_range_size(rangedType.valueRange.min, rangedType.valueRange.max) <= 100
        ) {
            closedRange = true
            numerical_range = factory.createTypeLiteralNode([
                factory.createPropertySignature(
                    undefined,
                    factory.createIdentifier('min'),
                    undefined,
                    factory.createLiteralTypeNode(bindNumericLiteral(rangedType.valueRange.min!))
                ),
                factory.createPropertySignature(
                    undefined,
                    factory.createIdentifier('max'),
                    undefined,
                    factory.createLiteralTypeNode(bindNumericLiteral(rangedType.valueRange.max!))
                )
            ])
        }

        if (!closedRange && (rangedType.kind === 'double' || rangedType.kind === 'float')) {
            if (rangedType.valueRange.min !== undefined && rangedType.valueRange.min >= 0 && (rangedType.valueRange.max === undefined ? true : rangedType.valueRange.max > 1 ) && !endExclusive) {
                numerical_range = factory.createTypeLiteralNode([
                    factory.createPropertySignature(
                        undefined,
                        factory.createIdentifier('min'),
                        undefined,
                        factory.createLiteralTypeNode(bindNumericLiteral(rangedType.valueRange.min! === 0 ? 0 : 1))
                    )
                ])
            }
        }

        if (
            !closedRange
            && rangedType.valueRange.min !== undefined
            && (rangedType.valueRange.min >= 0)
        ) {
            numerical_range = factory.createTypeLiteralNode([
                factory.createPropertySignature(
                    undefined,
                    factory.createIdentifier('min'),
                    undefined,
                    factory.createLiteralTypeNode(bindNumericLiteral(rangedType.valueRange.min! === 0 ? 0 : 1))
                )
            ])
        }

        if (
            !closedRange
            && rangedType.valueRange.max !== undefined
            && (rangedType.valueRange.max <= 0)
        ) {
            numerical_range = factory.createTypeLiteralNode([
                factory.createPropertySignature(
                    undefined,
                    factory.createIdentifier('max'),
                    undefined,
                    factory.createLiteralTypeNode(bindNumericLiteral(rangedType.valueRange.max! === 0 ? 0 : -1))
                )
            ])
        }

        if (rangedType.valueRange.min !== undefined && rangedType.kind !== 'double' && rangedType.kind !== 'float') {
            const considerMax = (rangedType.valueRange.max !== undefined && integer_range_size(rangedType.valueRange.min!, rangedType.valueRange.max!) <= 100)

            // If the the minimum is lower than 1 & there isn't an acceptable value range, don't attempt to bind the value
            if (considerMax || rangedType.valueRange.min! >= 1) {
                numerical_range = factory.createTypeLiteralNode([
                    factory.createPropertySignature(
                        undefined,
                        factory.createIdentifier('min'),
                        undefined,
                        factory.createLiteralTypeNode(!considerMax ? bindNumericLiteral(1) : bindNumericLiteral(rangedType.valueRange.min!))
                    ),
                    ...(considerMax ? [factory.createPropertySignature(
                        undefined,
                        factory.createIdentifier('max'),
                        undefined,
                        factory.createLiteralTypeNode(bindNumericLiteral(rangedType.valueRange.max!))
                    )] : [])
                ])
            }
        }

        

        if (beginExclusive && endExclusive) {
            exceptions = ` Excludes minimum & maximum values of ${rangedType.valueRange.min} & ${rangedType.valueRange.max}.`
        } else if (beginExclusive && !endExclusive) {
            exceptions = ` Excludes minimum value of ${rangedType.valueRange.min}.`
        } else if (endExclusive) {
            exceptions = ` Excludes maximum value of ${rangedType.valueRange.max}.`
        }

        doc_value = [
            `Accepts ${pascal_case(rangedType.kind)} values of (${mcdoc.NumericRange.toString(rangedType.valueRange)}).${exceptions}`
        ]
    }

    if (type.kind.endsWith('_array')) {
        const arrayType = type as mcdoc.PrimitiveArrayType



        if (arrayType.lengthRange !== undefined) {
            const range = bindRangedWholeNumber(arrayType.lengthRange, 'array')


        }
    }

    switch (type.kind) {
        case 'struct':
            return type_gen.createStruct(type, original_symbol, target_path)
        case 'reference': {
            const existing = type_gen.resolved_references.get(type.path!)
            if (existing !== undefined) {
                if (target_path === existing.path) {
                    return {
                        type: factory.createTypeReferenceNode(factory.createIdentifier(existing.name), undefined),
                        imports: [],
                        modules: []
                    }
                } else {
                    return {
                        type: factory.createTypeReferenceNode(factory.createIdentifier(existing.name), undefined),
                        imports: [existing.import],
                        modules: []
                    }
                }
            } else {
                if (original_symbol === undefined) {
                    console.log('resolveValueType', type, target_path)
                }
                const resolved = type_gen.resolveReference(type, original_symbol, target_path)

                return {
                    type: factory.createTypeReferenceNode(factory.createIdentifier(resolved.name), undefined),
                    imports: resolved.import ? [resolved.import] : [],
                    modules: resolved.modules ? resolved.modules : []
                }
            }
        }
        case 'boolean':
            return {
                type: factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword),
                imports: [],
                modules: []
            }
        case 'string': {
            if (type.lengthRange !== undefined) {
                const no_minimum = type.lengthRange.min === undefined || type.lengthRange.min === 0
                return {
                    type: no_minimum ? factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword) : nonEmptyString,
                    imports: [],
                    modules: [],
                    doc: [
                        `Accepts a string with a ${
                            no_minimum ? '' : `minimum length of ${type.lengthRange.min}`
                        }${
                            type.lengthRange.max === undefined ? 
                                ''
                                : `${no_minimum ? '' : ' and a '}maximum length of ${type.lengthRange.max}`
                        }.`
                    ]
                }
            }

            // TODO: handle id attribute
            return {
                type: factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                imports: [],
                modules: []
            }
        }
        case 'byte': {
            let _type = factory.createTypeReferenceNode('NBTByte')

            let imports = [bindImport('NBTByte', 'sandstone/variables/nbt')]

            if (type.valueRange !== undefined) {
                const range = bindRangedWholeNumber(type.valueRange, 'value')

                switch (range.type) {
                    case 'closed':
                        _type = factory.createTypeReferenceNode('RangedNBTByte', [
                            factory.createLiteralTypeNode(bindNumericLiteral(type.valueRange.min!)),
                            factory.createLiteralTypeNode(bindNumericLiteral(type.valueRange.max!))
                        ])
                        imports = [bindImport('RangedNBTByte', 'sandstone/variables/nbt')]
                        break
                    case 'non-empty':
                        _type = factory.createTypeReferenceNode('NonZeroNBTByte')
                        imports = [bindImport('NonZeroNBTByte', 'sandstone/variables/nbt')]
                        break
                }
            }
            return {
                type: _type,
                imports,
                modules: [],
                ...doc()
            }
        }
        case 'short': {
            let _type = factory.createTypeReferenceNode('NBTShort')

            let imports = [bindImport('NBTShort', 'sandstone/variables/nbt')]

            if (type.valueRange !== undefined) {
                const range = bindRangedWholeNumber(type.valueRange, 'value')

                switch (range.type) {
                    case 'closed':
                        _type = factory.createTypeReferenceNode('RangedNBTShort', [
                            factory.createLiteralTypeNode(bindNumericLiteral(type.valueRange.min!)),
                            factory.createLiteralTypeNode(bindNumericLiteral(type.valueRange.max!))
                        ])
                        imports = [bindImport('RangedNBTShort', 'sandstone/variables/nbt')]
                        break
                    case 'non-empty':
                        _type = factory.createTypeReferenceNode('NonZeroNBTShort')
                        imports = [bindImport('NonZeroNBTShort', 'sandstone/variables/nbt')]
                        break
                }
            }
            return {
                type: _type,
                imports,
                modules: [],
                ...doc()
            }
        }
        case 'int': {
            let _type = factory.createTypeLiteralNode([])

            if (type.valueRange !== undefined) {
                const range = bindRangedWholeNumber(type.valueRange, 'value')

                switch (range.type) {
                    case 'closed':
                        _type = factory.createTypeLiteralNode([
                            factory.createPropertySignature(
                                undefined,
                                factory.createIdentifier("min"),
                                undefined,
                                factory.createLiteralTypeNode(bindNumericLiteral(type.valueRange.min!))
                            ),
                            factory.createPropertySignature(
                                undefined,
                                factory.createIdentifier("max"),
                                undefined,
                                factory.createLiteralTypeNode(bindNumericLiteral(type.valueRange.max!))
                            )
                        ])
                        break
                    case 'non-empty':
                        _type = factory.createTypeLiteralNode([
                            factory.createPropertySignature(
                                undefined,
                                factory.createIdentifier("min"),
                                undefined,
                                factory.createLiteralTypeNode(bindNumericLiteral(1))
                            ),
                        ])
                        break
                }
            }
            return {
                type: factory.createTypeReferenceNode('NBTInt', [_type]),
                imports: [bindImport('NBTInt', 'sandstone/variables/nbt')],
                modules: [],
                ...doc()
            }
        }
        case 'long': {
            let _type = factory.createTypeReferenceNode('NBTLong')

            let imports = [bindImport('NBTLong', 'sandstone/variables/nbt')]

            if (type.valueRange !== undefined) {
                const range = bindRangedWholeNumber(type.valueRange, 'value')

                switch (range.type) {
                    case 'closed':
                        _type = factory.createTypeReferenceNode('RangedNBTLong', [
                            factory.createLiteralTypeNode(bindNumericLiteral(type.valueRange.min!)),
                            factory.createLiteralTypeNode(bindNumericLiteral(type.valueRange.max!))
                        ])
                        imports = [bindImport('RangedNBTLong', 'sandstone/variables/nbt')]
                        break
                    case 'non-empty':
                        _type = factory.createTypeReferenceNode('NonZeroNBTLong')
                        imports = [bindImport('NonZeroNBTLong', 'sandstone/variables/nbt')]
                        break
                }
            }
            return {
                type: _type,
                imports,
                modules: [],
                ...doc()
            }
        }
        case 'float':
            return {
                type: factory.createTypeReferenceNode('NBTFloat'),
                imports: [bindImport('NBTFloat', 'sandstone/variables/nbt')],
                modules: [],
                ...doc()
            }
        case 'double':
            return {
                type: factory.createTypeReferenceNode('NBTDouble'),
                imports: [bindImport('NBTDouble', 'sandstone/variables/nbt')],
                modules: [],
                ...doc()
            }
        case 'list': {
            // TODO: Fix what is getting returned as undefined from resolveValueType (its dispatchers)
            const item = resolveValueType(type.item, original_symbol, target_path, type_gen) || {
                type: factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                imports: [],
                modules: []
            }

            if (type.lengthRange) {
                const range = bindRangedWholeNumber(type.lengthRange, 'list')
                switch (range.type) {
                    case 'static':
                        return {
                            type: factory.createTypeReferenceNode('FixedLengthList', [
                                item.type,
                                factory.createLiteralTypeNode(factory.createNumericLiteral(range.value))
                            ]),
                            imports: [bindImport('FixedLengthList', 'sandstone/utils'), ...item.imports],
                            modules: item.modules
                        }
                    case 'closed':
                        return {
                            type: factory.createTypeReferenceNode('RangedList', [
                                item.type,
                                factory.createLiteralTypeNode(factory.createNumericLiteral(type.lengthRange.min!)),
                                factory.createLiteralTypeNode(factory.createNumericLiteral(type.lengthRange.max!))
                            ]),
                            imports: [bindImport('RangedList', 'sandstone/utils'), ...item.imports],
                            modules: item.modules
                        }
                    case 'non-empty':
                        return {
                            type: factory.createTypeReferenceNode('NonEmptyList', [item.type]),
                            imports: [bindImport('NonEmptyList', 'sandstone/utils'), ...item.imports],
                            modules: item.modules,
                            doc: [range.doc]
                        }
                    case 'unbounded':
                        return {
                            type: factory.createTypeReferenceNode('Array', [item.type]),
                            imports: item.imports,
                            modules: item.modules,
                            doc: [range.doc]
                        }
                }
            }
            return {
                type: factory.createTypeReferenceNode('Array', [item.type]),
                imports: item.imports,
                modules: item.modules
            }
        }
        // TODO: Implement range/size support for these
        case 'byte_array': {
            return {
                type: factory.createTypeReferenceNode('NBTByteArray'),
                imports: [bindImport('NBTByteArray', 'sandstone/variables/nbt')],
                modules: []
            }
        }
        case 'int_array': {
            return {
                type: factory.createTypeReferenceNode('NBTIntArray'),
                imports: [bindImport('NBTIntArray', 'sandstone/variables/nbt')],
                modules: []
            }
        }
        case 'long_array': {
            return {
                type: factory.createTypeReferenceNode('NBTLongArray'),
                imports: [bindImport('NBTLongArray', 'sandstone/variables/nbt')],
                modules: []
            }
        }
        case 'union': {
            const members: ts.TypeNode[] = []
            const imports: ts.ImportDeclaration[] = []
            const modules: (ts.TypeAliasDeclaration | ts.EnumDeclaration | ts.ImportDeclaration)[] = []
            for (const member_type of type.members) {
                if (member_type.attributes !== undefined && member_type.attributes.findIndex((attr: mcdoc.Attribute) => attr.name == 'until') !== -1) {
                    continue
                }
                const resolved_union_member = resolveValueType(member_type, original_symbol, target_path, type_gen)

                if (resolved_union_member === undefined) {
                    continue
                }

                members.push(resolved_union_member.type)
                if (resolved_union_member.imports.length > 0) {
                    imports.push(...resolved_union_member.imports)
                }
                if (resolved_union_member.modules.length > 0) {
                    modules.push(...resolved_union_member.modules)
                }
            }

            if (members.length === 1) {
                return {
                    type: members[0],
                    imports,
                    modules
                }
            }

            if (members.length === 0) {
                return {
                    type: factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword),
                    imports,
                    modules
                }
            }

            return {
                type: factory.createParenthesizedType(factory.createUnionTypeNode(members)),
                imports,
                modules
            }
        }
        case 'enum': {
            const enum_identifier = factory.createIdentifier(`inlineEnum${type_gen.inline_enum_count++}`) // :husk:

            return {
                type: factory.createTypeReferenceNode(enum_identifier),
                imports: [],
                modules: [type_gen.createEnum(enum_identifier, type)]
            }
        }
        
        case 'literal': {
            // TODO: Add support for literal generic for these NBT primitives in Sandstone
            switch (type.value.kind) {
                case 'boolean':
                    return {
                        type: type.value.value ?
                            factory.createLiteralTypeNode(factory.createTrue())
                            : factory.createLiteralTypeNode(factory.createFalse()),
                        imports: [],
                        modules: []
                    }
                case 'string':
                    return {
                        type: factory.createLiteralTypeNode(factory.createStringLiteral(type.value.value, true)),
                        imports: [],
                        modules: []
                    }
                case 'byte': {
                    return {
                        type: factory.createTypeReferenceNode('NBTByte', [{
                            ...bindNumericLiteral(type.value.value),
                            _typeNodeBrand: ''
                        }]),
                        imports: [
                            bindImport('NBTByte', 'sandstone/variables/nbt')
                        ],
                        modules: []
                    }
                }
                case 'short': {
                    return {
                        type: factory.createTypeReferenceNode('NBTShort', [{
                            ...bindNumericLiteral(type.value.value),
                            _typeNodeBrand: ''
                        }]),
                        imports: [
                            bindImport('NBTShort', 'sandstone/variables/nbt')
                        ],
                        modules: []
                    }
                }
                case 'float': {
                    return {
                        type: factory.createTypeReferenceNode('NBTFloat', [{
                            ...bindNumericLiteral(type.value.value),
                            _typeNodeBrand: ''
                        }]),
                        imports: [
                            bindImport('NBTFloat', 'sandstone/variables/nbt')
                        ],
                        modules: []
                    }
                }
                default: // This is a hack, but it works. `double` is the default decimal SNBT value type, `int` is the default integer SNBT value type.
                    return {
                        type: factory.createLiteralTypeNode(bindNumericLiteral(type.value.value)),
                        imports: [],
                        modules: []
                    }
            }
        }
        // TODO
        /* case 'dispatcher': {
        } break */
        default: {
            return {
                type: factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                imports: [],
                modules: []
            }
        }
    }
}