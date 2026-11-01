/** Portable UTF-8 encoding shared by browser and native storage owners. */
export const encodeUtf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
export const utf8ByteLength = (text: string): number => encodeUtf8(text).byteLength;
