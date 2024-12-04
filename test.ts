type Bar = {
    'baz': {},
    'qux': {},
}

interface Baz<T> {
    kind: T,
    funny: T extends 'baz' ? 'yes' : 'no';
}

type Foo = {
    [FooKey in keyof Bar]?: Baz<FooKey>
}