// Public types of the library. Re-exported from the package entry point, and reachable as
// members of the default export (`libmime.ParsedHeaderValue`) as well

/**
 * Configuration object of a Libmime instance, kept as `config`. The library itself does not read any keys
 */
export type LibmimeConfig = Record<string, any>;

/**
 * A single header line split into its key and value
 */
export interface HeaderLine {
    /** Lowercased header key */
    key: string;
    /** Header value, unfolded and trimmed, not mime word decoded */
    value: string;
}

/**
 * Parsed header block, every key holds the values of all the header lines with that key
 */
export type HeaderObject = Record<string, string[]>;

/**
 * Options of decodeHeaders()
 */
export interface DecodeHeadersOptions {
    /**
     * Leave out the headers whose name is also the name of an Object.prototype member, such as
     * `__proto__` and `constructor`. By default they are kept as own properties of the result,
     * where a lookup with the `in` operator or a merge into another object can not tell them
     * apart from the inherited members
     */
    skipPrototypeKeys?: boolean | undefined;
}

/**
 * Options of parseHeaderValue()
 */
export interface ParseHeaderValueOptions {
    /**
     * Drop the RFC 822 comments outside quoted strings. The MIME headers (Content-Type,
     * Content-Disposition) allow them and they are not part of the value, so `boundary=b (comment)`
     * names the boundary `b`. A parenthesis right behind a token of a parameter value continues
     * it, `filename=Invoice(1).pdf` keeps its name. A comment that never closes runs to the end
     * of the value, unless a parameter follows it, in which case it is content and the parameter
     * survives. By default comments are kept as they are, since a header such as
     * Authentication-Results carries information in them
     */
    stripComments?: boolean | undefined;
}

/**
 * Header value with key=value parameters as returned by parseHeaderValue()
 */
export interface ParsedHeaderValue {
    /** The value in front of the parameters, eg. "text/plain" */
    value: string;
    /** Parameters keyed by their lowercased names */
    params: Record<string, string>;
    /**
     * Names of the params assembled from rfc2231 segments. Their values are already decoded,
     * so a caller that runs decodeWords() over the params has to leave them out. Non-enumerable
     */
    decodedParams: string[];
}

/**
 * Header value with parameters as accepted by buildHeaderValue()
 */
export interface StructuredHeaderValue {
    value: string;
    params?: Record<string, unknown> | undefined;
}

/**
 * A parameter key and value pair as returned by buildHeaderParam()
 */
export interface HeaderParam {
    key: string;
    value: string;
}

/**
 * Header value with key=value parameters, the name the @types/libmime declarations used
 */
export interface StructuredHeader {
    value: string;
    params: { [key: string]: string };
}

/**
 * Encoding of a mime encoded word, Q for quoted printable and B for base64. Lowercase letters
 * and longer names that start with Q or B are accepted as well
 */
export type MimeWordEncoding = 'Q' | 'B';
