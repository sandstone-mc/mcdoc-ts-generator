import ts from 'typescript'
import os from 'os'
import { join } from '../util'

export async function compile_types(nodes: ts.Node[]) {
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, omitTrailingSemicolon: true });
    const resultFile = ts.createSourceFile(
        'code.ts',
        '',
        ts.ScriptTarget.Latest,
        false,
        ts.ScriptKind.TS
    )

    const printed = printer.printList(ts.ListFormat.MultiLine, ts.factory.createNodeArray(nodes), resultFile)

    return printed
    
    // TODO: Use something other than Biome, probably eslint

    const executable = os.platform() === 'win32' ? join('node_modules/.bin/biome.exe') : 'node_modules/@biomejs/biome/bin/biome'

    const shell = Bun.spawn({
        cmd: [executable, 'format', '--verbose', '--format-with-errors=true', '--max-diagnostics=none', '--stdin-file-path=code.ts'],
        stdout: 'pipe',
        //windowsHide: true,
        //windowsVerbatimArguments: true,
        stdin: 'pipe',
        stderr: 'pipe'
    })

    shell.stdin.write(printed)

    shell.stdin.end()

    const stdout = shell.stdout.getReader()

    const decoder = new TextDecoder()

    let formatted = ''

    async function* read(reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>) {
        let done = false

        while (!done) {
            const chunk = await reader.read()

            if (chunk.done) {
                done = true
            } else {
                yield decoder.decode(chunk.value, { stream: true })
            }
        }
    }

    for await (const chunk of read(stdout)) {
        formatted += chunk
    }

    let errors = ''

    const stderr = shell.stderr.getReader()

    for await (const chunk of read(stderr)) {
        errors += chunk
    }

    await shell.exited

    if (errors !== '') {
        console.log('Errors during formatting:')
        console.log('printed: ', printed)
        console.log('formatted: ', formatted)
        console.log('errors: ', errors)

        return printed
    }

    return formatted
}