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
