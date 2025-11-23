import * as mcdoc from '@spyglassmc/mcdoc'

export class Assert {
    static ListType(type: mcdoc.McdocType): asserts type is mcdoc.ListType {
        if (type.kind !== 'list') {
            throw new Error(`Type is not a ListType: ${type.kind}`)
        }
    }
    static EnumType(type: mcdoc.McdocType): asserts type is mcdoc.EnumType {
        if (type.kind !== 'enum') {
            throw new Error(`Type is not an EnumType: ${type.kind}`)
        }
    }
    static StructType(type: mcdoc.McdocType): asserts type is mcdoc.StructType {
        if (type.kind !== 'struct') {
            throw new Error(`Type is not a StructType: ${type.kind}`)
        }
    }
    static StructKeyType(type: mcdoc.McdocType): asserts type is (mcdoc.ReferenceType | mcdoc.StringType) {
        if (type.kind !== 'reference' && type.kind !== 'string') {
            throw new Error(`Struct field key must be a ReferenceType or StringType, got: ${type.kind}`)
        }
        if (type.kind === 'reference' && type.path === undefined) {
            throw new Error(`Struct field key ReferenceType must have a path defined. ${type}`)
        }
    }
    static StructSpreadType(type: mcdoc.McdocType): asserts type is (mcdoc.ReferenceType | mcdoc.DispatcherType | mcdoc.ConcreteType | mcdoc.TemplateType) {
        const reference_alike = new Set(['reference', 'dispatcher', 'concrete', 'template'])

        if (!reference_alike.has(type.kind)) {
            throw new Error(`Struct spread type must be a reference-alike, got: ${type.kind}`)
        }
    }
    static KeywordType<KIND extends (mcdoc.KeywordType['kind'] | undefined) = undefined>(type: mcdoc.McdocType): asserts type is (
        KIND extends undefined ? never :
        mcdoc.KeywordType & { kind: KIND }
    ) {
        if (type.kind !== 'any' && type.kind !== 'boolean' && type.kind !== 'unsafe') {
            throw new Error(`Type is not a KeywordType: ${type.kind}`)
        }
    }
    static NumericType<KIND extends (mcdoc.NumericTypeKind | undefined) = undefined>(type: mcdoc.McdocType): asserts type is (
        KIND extends undefined ? never :
        mcdoc.NumericType & { kind: KIND }
    ) {
        if (type.kind !== 'byte' && type.kind !== 'double' && type.kind !== 'float' && type.kind !== 'int' && type.kind !== 'long' && type.kind !== 'short') {
            throw new Error(`Type is not a NumericType: ${type.kind}`)
        }
    }
    static LiteralType(type: mcdoc.McdocType): asserts type is mcdoc.LiteralType {
        if (type.kind !== 'literal') {
            throw new Error(`Type is not a LiteralType: ${type.kind}`)
        }
    }
    static ReferenceType(type: mcdoc.McdocType): asserts type is (mcdoc.ReferenceType & { path: string }) {
        if (type.kind !== 'reference' || type.path === undefined) {
            throw new Error(`Type is not a valid ReferenceType: ${type}`)
        }
    }
    static StringType(type: mcdoc.McdocType): asserts type is mcdoc.StringType {
        if (type.kind !== 'string') {
            throw new Error(`Type is not a StringType: ${type.kind}`)
        }
    }
}