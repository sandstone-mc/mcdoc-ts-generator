/**
 * `Funny` represents the name of the dispatcher symbol map.
 * `SuperFunny` & `KindaFunny` represent members of a dispatcher symbol map
 */

type SuperFunny = {
    baz: number
    foo: string
}

type KindaFunny = {
    bar: boolean
    silly: number[]
}

type FunnyMap = {
    'super': SuperFunny,
    'kinda': KindaFunny,
}
type FunnyKeys = keyof FunnyMap
type FunnyFallback = (
    | SuperFunny
    | KindaFunny
)
type FunnyUnknown = (
    & SuperFunny
    & KindaFunny
)

type SymbolFunny<CASE extends ('map' | 'keys' | '%unknown' | '%fallback') = 'map'> = 
    CASE extends 'map' ? FunnyMap :
    CASE extends 'keys' ? FunnyKeys :
    CASE extends '%fallback' ? FunnyFallback :
    CASE extends '%unknown' ? FunnyUnknown :
    never;
