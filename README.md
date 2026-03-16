# unplugin-inline

AST-driven unplugin that inlines pure functions at build time across Vite, Rollup, Webpack, and esbuild.

---

## Why

V8 refuses to inline functions whose bytecode exceeds ~460 instructions or ~600 bytes, even on the hot path—every call still pays full frame
setup cost at runtime. Marking a function with `/* @__INLINE__ */` moves that cost to build time instead, flattening the
logic directly into the caller.

## Installation

```bash
pnpm add -D unplugin-inline
# or
npm install -D unplugin-inline
# or
yarn add -D unplugin-inline
```

## Example Usage

Consider a physics simulation where `transformPoint` is called millions of times per frame. The function is large enough
that V8 refuses to inline it automatically.

### Source Code

**`src/physics.ts`**

```ts
/* @__INLINE__ */
function transformPoint(x: number, y: number, z: number, matrix: Float32Array): number {
  const m = matrix;
  const tx = m[0] * x + m[4] * y + m[8] * z + m[12]
  const ty = m[1] * x + m[5] * y + m[9] * z + m[13]
  const tz = m[2] * x + m[6] * y + m[10] * z + m[14]
  const tw = m[3] * x + m[7] * y + m[11] * z + m[15]

  return Math.sqrt(tx * tx + ty * ty + tz * tz) / tw
}

// Called millions of times per frame — no function call overhead in the output
export function processVertices(vertices: Float32Array, matrix: Float32Array): number {
  let sum = 0
  for (let i = 0; i < vertices.length; i += 3) {
    sum += transformPoint(vertices[i], vertices[i + 1], vertices[i + 2], matrix)
  }
  return sum
}
```

### Compiled Output

The compiled output has no `transformPoint` declaration. Its body is placed directly at the call site as a flat labeled
block:

**`dist/physics.js`**

```js
function processVertices(vertices, matrix) {
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 3) {
    let _transformPointResult;
    _transformPointLabel: {
      const _x = vertices[i];
      const _y = vertices[i + 1];
      const _z = vertices[i + 2];
      const _matrix = matrix;
      const tx = _matrix[0] * _x + _matrix[4] * _y + _matrix[8] * _z + _matrix[12];
      const ty = _matrix[1] * _x + _matrix[5] * _y + _matrix[9] * _z + _matrix[13];
      const tz = _matrix[2] * _x + _matrix[6] * _y + _matrix[10] * _z + _matrix[14];
      const tw = _matrix[3] * _x + _matrix[7] * _y + _matrix[11] * _z + _matrix[15];
      _transformPointResult = Math.sqrt(tx * tx + ty * ty + tz * tz) / tw;
    }
    sum += _transformPointResult;
  }
  return sum;
}
```

*Both block (`/* @__INLINE__ */`) and line (`// @__INLINE__`) comment styles are recognized.*

## Bundler Configuration

### Vite

**`vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import { vitePlugin } from 'unplugin-inline'

export default defineConfig({
  plugins: [vitePlugin()]
})
```

### esbuild

**`build.js`**

```js
import esbuild from 'esbuild'
import { esbuildPlugin } from 'unplugin-inline'

esbuild.build({
  entryPoints: ['input.js'],
  bundle: true,
  plugins: [esbuildPlugin()],
})
```

### tsup

**`tsup.config.ts`**

```ts
import { defineConfig } from 'tsup'
import { esbuildPlugin } from 'unplugin-inline'

export default defineConfig({
  esbuildPlugins: [esbuildPlugin()],
})
```

### Rollup

**`rollup.config.js`**

```js
import { rollupPlugin } from 'unplugin-inline'

export default {
  input: 'input.js',
  plugins: [rollupPlugin()],
}

```

### Webpack

**`webpack.config.js`**

```js
const { webpackPlugin } = require('unplugin-inline')

module.exports = {
  plugins: [webpackPlugin()],
}
```

## Configuration Options

| Option             | Type       | Default                                                         | Description                                            |
|--------------------|------------|-----------------------------------------------------------------|--------------------------------------------------------|
| `inlineIdentifier` | `string`   | `'@__INLINE__'`                                                 | The comment string used to mark functions.             |
| `allowedGlobals`   | `string[]` | [See Defaults](https://www.google.com/search?q=src/defaults.ts) | Global identifiers available inside inlined functions. |
| `fileExtensions`   | `string[]` | [See Defaults](https://www.google.com/search?q=src/defaults.ts) | File extensions the plugin will process.               |

## ⚠️ Requirements & Restrictions

A function must be **pure** to be inlinable. The plugin enforces strict AST analysis and will throw build errors if you
violate these rules:

- **No async or generators** — `async`/`await` and `function*` alter execution timing.
- **No `this` or `arguments`** — both bind to the caller after inlining, producing unpredictable results.
- **No outer scope mutations** — cannot reassign variables declared outside the function's own block.
- **No outer scope references** — cannot read variables from an outer scope. Standard globals (`Math`, `JSON`, etc.) are
  permitted — see `allowedGlobals` for the full default list.
- **No recursive functions** — recursion cannot be unrolled at the call site.
- **No call expressions in conditionals** — the function must be called as a standalone statement or direct assignment,
  not inside a ternary or `if` condition. Assign the result first:

```js
// ❌ Not allowed
if (processValue(x) > 100) { // ...
}

// ✅ Assign first, then use
const processed = processValue(x)
if (processed > 100) { // ...
}
```

## Benchmarks

```bash
npm run bench
```

## Release Automation

* update `package.json` file version (example: `1.0.99`)
* manually create a github release with a tag matching the `package.json` version prefixed with `v` (example: `v1.0.99`)
* npm should be updated automatically

## License

MIT