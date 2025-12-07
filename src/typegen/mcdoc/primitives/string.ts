import ts from 'typescript'
import { match, P } from 'ts-pattern'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '..'
import { Assert } from '../assert'

const { factory } = ts

const StringKeyword = factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)

const static_value = {
    normal: {
        type: StringKeyword
    },
    not_empty: factory.createTemplateLiteralType(
        factory.createTemplateHead('', ''),
        [
            factory.createTemplateLiteralTypeSpan(
                factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                factory.createTemplateMiddle('', '')
            ),
            factory.createTemplateLiteralTypeSpan(
                StringKeyword,
                factory.createTemplateTail('', '')
            )
        ]
    ),
    namespaced: {
        type: factory.createTemplateLiteralType(
            factory.createTemplateHead('', ''),
            [
                factory.createTemplateLiteralTypeSpan(
                    StringKeyword,
                    factory.createTemplateMiddle(':', ':')
                ),
                factory.createTemplateLiteralTypeSpan(
                    StringKeyword,
                    factory.createTemplateTail('', '')
                )
            ]
        )
    }
} as const

/**
 * This only handles strings as value types, not struct keys
 */
function mcdoc_string(type: mcdoc.McdocType) {
    const string = type
    Assert.StringType(string)

    if (string.attributes === undefined && string.lengthRange === undefined) {
        return (...args: unknown[]) => static_value.normal
    } else if (string.attributes === undefined) {
        return (...args: unknown[]) => ({
            type: static_value.not_empty,
            docs: [`String length range: ${mcdoc.NumericRange.toString(string.lengthRange!)}`] as NonEmptyList<string>,
        } as const)
    } else {
        Assert.Attributes(string.attributes, true)

        // Note: if `#[canonical]` ever gets used on a string, this implementation will need some work
        const attribute = string.attributes.find((attr) => attr.name !== 'since' && attr.name !== 'until')

        return match(attribute)
            .with(P.nullish, () => {
                return (...args: unknown[]) => static_value.normal
            })
            .with({ name: 'id', value: P.optional(P.nullish) }, () => {
                // #[id] string
                return (...args: unknown[]) => static_value.namespaced
            })
            .with({ name: 'block_predicate' }, () => {
                // TODO: Add an abstraction in Sandstone
            })
            .with({ name: 'color' }, ({ value: { value: { value } } }) => {})
            .with({ name: 'command' }, ({ value: { values } }) => {
                // TODO: Figure out implementation in Sandstone
            })
            .with({ name: 'crafting_ingredient' }, () => {})
            .with({ name: 'criterion' }, () => {
                // TODO: Implement Advancement generics
            })
            .with({ name: 'entity' }, (entity) => {}) // TODO: Add types for entity in Assert
            .with({ name: 'game_rule' }, ({ value: { values: { type: { value: { value } } } } }) => {})
            .with({ name: 'id', value: P.nonNullable }, ({ value }) => {}).narrow()
            .with({ name: 'integer' }, () => {})
            .with({ name: 'item_slots' }, () => {})
            .with({ name: 'nbt' }, ({ value }) => {})
            .with({ name: 'nbt_path' }, ({ value }) => {
                // TODO: Figure out implementation in Sandstone
            })
            .with({ name: 'objective' }, () => {})
            .with({ name: 'regex_pattern' }, () => {
                // Add docs
            })
            .with({ name: 'score_holder' }, () => {})
            .with({ name: 'texture_slot' }, ({ value: { values: { kind: { value: { value } } } } }) => {})
            .with({ name: 'time_pattern' }, () => {})
            .with({ name: 'translation_key' }, () => {
                // TODO: Add translation key abstraction in Sandstone
                // For now this will just be a LiteralUnion of vanilla translation keys
            })
            .with({ name: 'translation_value' }, () => {
                // TODO: Add translation value abstraction in Sandstone
                // For now this will just be a string
            })
            .with({ name: 'uuid' }, () => {
                // mojang pls, literally just zombified piglin HurtBy
                // gonna just implement this as a string because its so niche
            })
            .with({ name: 'vector' }, ({ value: { values } }) => {})
            .otherwise(() => {
                throw new Error(`[mcdoc_string] Unsupported string attribute: ${attribute}`)
            })
    }
}

export const McdocString = mcdoc_string satisfies TypeHandler