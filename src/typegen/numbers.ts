import ts from 'typescript'

const { factory } = ts

/**
 * Whether generated NBT number types also accept a plain JavaScript `number`.
 *
 * Set `MCDOC_ALLOW_JS_NUMBER` to any non-empty value to enable:
 *   MCDOC_ALLOW_JS_NUMBER=1 bun compile
 *
 * Defaults to off, which leaves every number type exactly as it was.
 *
 * The NBT number classes exist to keep Minecraft's numeric tag types apart -
 * `NBTInt` and `NBTShort` are not interchangeable, and a bare `number` can't
 * say which one it is. Turning this on trades that away for ergonomics, so
 * `{ count: 3 }` type-checks instead of requiring `{ count: NBTInt(3) }`.
 *
 * `NBTDouble` already accepts `number` unconditionally (it is the type a bare
 * JS number naturally maps to), so this flag does not change it.
 *
 * Ranged types lose their range checking under this flag - the range lives in
 * the class's generic parameter, and `number` carries no such constraint. See
 * the note in `whole_number_generic` about why the `WholeNumber` trick can't
 * be applied to type aliases.
 */
export const ALLOW_JS_NUMBER = (process.env['MCDOC_ALLOW_JS_NUMBER'] ?? '') !== ''

/**
 * Unions a plain-number alternative onto an NBT number type when
 * `ALLOW_JS_NUMBER` is set, and returns `type` untouched when it isn't.
 *
 * @param type The NBT number type, e.g. `NBTInt` or `NBTByte<1>`
 * @param alternative What to accept alongside it. Defaults to `number`; literal
 *   handlers pass the literal value instead so the exact value stays pinned
 *   (`NBTByte<1>` widens to `(NBTByte<1> | 1)`, not to `(NBTByte<1> | number)`).
 */
export function with_js_number(type: ts.TypeNode, alternative?: ts.TypeNode): ts.TypeNode {
  if (!ALLOW_JS_NUMBER) {
    return type
  }
  return factory.createParenthesizedType(factory.createUnionTypeNode([
    type,
    alternative ?? factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
  ]))
}
