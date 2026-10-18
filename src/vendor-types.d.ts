// Minimal declarations for the runtime dependencies that ship without type
// definitions. Only the members libmime uses are declared.

declare module 'libqp' {
    const libqp: {
        encode(value: string | Buffer): string;
    };
    export = libqp;
}

declare module 'libbase64' {
    const libbase64: {
        encode(value: string | Buffer): string;
        decode(value: string): Buffer;
    };
    export = libbase64;
}
