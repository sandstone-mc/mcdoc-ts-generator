import * as mcdoc from '@spyglassmc/mcdoc'

export class Assert {
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
    static StringType(type: mcdoc.McdocType): asserts type is mcdoc.StringType {
        if (type.kind !== 'string') {
            throw new Error(`Type is not a StringType: ${type.kind}`)
        }
    }
}