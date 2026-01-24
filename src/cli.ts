#!/usr/bin/env node
import { generate, type GeneratorOptions } from './index'

function print_help(): void {
    console.log(`
@sandstone-mc/mcdoc_ts_generator

Generate TypeScript types from Minecraft mcdoc definitions.

Usage:
  mcdoc-ts-generator [options]

Options:
  -o, --out-dir <dir>   Output directory for generated types (default: "types")
  --no-tsconfig         Skip generating tsconfig.json in output directory
  -h, --help            Show this help message

Examples:
  mcdoc-ts-generator
  mcdoc-ts-generator -o ./generated
  mcdoc-ts-generator --out-dir ./src/types --no-tsconfig
`)
}

function parse_args(args: string[]): GeneratorOptions | null {
    const options: GeneratorOptions = {}

    let i = 0
    while (i < args.length) {
        const arg = args[i]

        if (arg === '-h' || arg === '--help') {
            print_help()
            return null
        }

        if (arg === '-o' || arg === '--out-dir') {
            const value = args[i + 1]
            if (!value || value.startsWith('-')) {
                console.error(`Error: ${arg} requires a directory path`)
                process.exit(1)
            }
            options.out_dir = value
            i += 2
            continue
        }

        if (arg === '--no-tsconfig') {
            options.tsconfig = false
            i++
            continue
        }

        console.error(`Error: Unknown option "${arg}"`)
        console.error('Run with --help for usage information')
        process.exit(1)
    }

    return options
}

async function main(): Promise<void> {
    const args = process.argv.slice(2)
    const options = parse_args(args)

    if (options === null) {
        return
    }

    console.log('Generating TypeScript types from mcdoc definitions...')
    if (options.out_dir) {
        console.log(`Output directory: ${options.out_dir}`)
    }

    await generate(options)

    console.log('Done!')
}

main().catch((error) => {
    console.error('Error:', error.message || error)
    process.exit(1)
})
