import type ts from 'typescript'
import type * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList, type TypeHandler, type TypeHandlerResult } from '..'
import { Assert } from '../assert'
import { merge_imports } from '../utils'
import { add } from '../../../util'

/**
 * Handles `concrete` types which are type references with generic arguments.
 *
 * A concrete type has:
 * - `child`: The base type being referenced (always a `reference` or `dispatcher` type)
 * - `typeArgs`: The generic arguments being passed to the template
 *
 * Example: `SomeTemplate<boolean, string>` would have child=reference to SomeTemplate, typeArgs=[boolean, string]
 */
function mcdoc_concrete(type: mcdoc.McdocType) {
  Assert.ConcreteType(type)

  return (args: Record<string, unknown>) => {
    // Resolve each type argument
    const generic_types = [] as unknown as NonEmptyList<ts.TypeNode>
    let imports = undefined as unknown as TypeHandlerResult['imports']

    let child_dispatcher: NonEmptyList<[number, string]> | undefined

    // Process each type argument
    for (const generic of type.typeArgs) {
      const generic_type = TypeHandlers[generic.kind](generic)(args)

      if ('imports' in generic_type) {
        imports = merge_imports(imports, generic_type.imports)
      }
      if ('child_dispatcher' in generic_type) {
        if (child_dispatcher === undefined) {
          child_dispatcher = [] as unknown as typeof child_dispatcher
        }
        child_dispatcher!.push(...(generic_type.child_dispatcher as NonEmptyList<[number, string]>))
      }
      generic_types.push(generic_type.type)
    }

    const child = TypeHandlers[type.child.kind](type.child)({ ...args, generic_types })

    if ('imports' in child) {
      imports = merge_imports(imports, child.imports!)
    }
    if ('child_dispatcher' in child) {
      if (child_dispatcher === undefined) {
        child_dispatcher = [] as unknown as typeof child_dispatcher
      }
      child_dispatcher!.push(...(child.child_dispatcher as NonEmptyList<[number, string]>))
    }

    return {
      type: child.type,
      ...add({ imports, child_dispatcher }),
    } as const
  }
}

export const McdocConcrete = mcdoc_concrete satisfies TypeHandler
