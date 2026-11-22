# RE2JS vendor snapshot

- Package: `re2js@2.10.0`, retrieved from the npm registry.
- Upstream: https://github.com/le0pard/re2js
- Included `re2js.js`: unchanged `build/index.umd.js` from that package.
- SHA-256: `6643cae301745d87d9120042d50e3b4de11e20b00a9fca6590ecbea30229be4a`.
- MIT license: `RE2JS_LICENSE.txt` (also embedded in the standalone plugin).

The build wraps this local module and exposes only its RE2JS class to Chronicle.
No remote script, worker, native regex fallback, or package install is required at runtime.
Removal rules accept `gimsu`, run on Unicode characters, and reject unsupported RE2 syntax.
The compiled program is limited to 10,000 instructions; the bounded cache holds at most 40 patterns.
