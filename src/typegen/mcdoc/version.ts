import { ReleaseVersion } from '@spyglassmc/java-edition/lib/dependency/index.js'

/**
 * Target Minecraft version for generated types. Sandstone 1.1.x targets mc 26.2.
 *
 * Override at runtime with the `MCDOC_TARGET_VERSION` environment variable, e.g.:
 *   MCDOC_TARGET_VERSION=26.2 bun compile
 *   MCDOC_TARGET_VERSION=26.3 bun update-from-mcdoc
 *
 * The latest vanilla-mcdoc snapshot may include entries for versions newer
 * than our target. The `since`/`until` filters in struct/union/tuple and
 * dispatcher_symbol use `ReleaseVersion.cmp` against this value to drop
 * entries that aren't available in the targeted Minecraft release.
 */
export const TARGET_VERSION: ReleaseVersion = (process.env['MCDOC_TARGET_VERSION'] ?? '26.2') as ReleaseVersion

export { ReleaseVersion }