/**
 * Package version, and the single place it is written down.
 *
 * The User-Agent header and the MCP `clientInfo` both read it from here. They
 * used to carry the string "0.1.0" typed out by hand, which is how the
 * published 0.2.0 was caught announcing itself as 0.1.0: a version written
 * twice is a version that disagrees with itself. `tests/version.test.ts`
 * asserts this matches package.json.
 */
export const VERSION = "0.3.0";
