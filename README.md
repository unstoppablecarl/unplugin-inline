# unplugin-inline

AST-driven unplugin that supports inlining pure functions across Vite, Rollup, Webpack, and esbuild.

## Installation

```bash
npm install -D unplugin-inline
# or
yarn add -D unplugin-inline
# or
pnpm add -D unplugin-inline

```

## Usage

Mark any pure function with the `/* @__INLINE__ */` directive. The plugin will remove the function declaration and
inject its body directly into every place it is called.

**1. Mark your functions**

`input.js`

```javascript
/* @__INLINE__ */
function calculateSquare(x) {
  return x * x;
}

const a = 5;
const result = calculateSquare(a);
```

**2. Add to your bundler config**

Because this is powered by `unplugin`, you can import the specific wrapper for your bundler of choice.

**Vite**

`vite.config.ts`

```javascript
import { defineConfig } from 'vite';
import { vitePlugin } from 'unplugin-inline';

const pluginOpts = {
  inlineIdentifier: '@__MY_CUSTOM_INLINE__'
};

export default defineConfig({
  plugins: [
    vitePlugin(pluginOpts)
  ]
});
```

**esbuild / tsup**

`build.js`

```javascript
import esbuild from 'esbuild';
import { esbuildPlugin } from 'unplugin-inline';

const pluginOpts = {
  inlineIdentifier: '@__MY_CUSTOM_INLINE__'
};

const buildOptions = {
  entryPoints: ['input.js'],
  bundle: true,
  plugins: [
    esbuildPlugin(pluginOpts)
  ]
};

esbuild.build(buildOptions);
```

**Rollup**

`rollup.config.js`

```javascript
import { rollupPlugin } from 'unplugin-inline';

const pluginOpts = {
  inlineIdentifier: '@__MY_CUSTOM_INLINE__'
};

export default {
  input: 'input.js',
  plugins: [
    rollupPlugin(pluginOpts)
  ]
};
```

**Webpack**

```javascript
// webpack.config.js
const { webpackPlugin } = require('unplugin-inline');

const pluginOpts = {
  inlineIdentifier: '@__MY_CUSTOM_INLINE__'
};

module.exports = {
  plugins: [
    webpackPlugin(pluginOpts)
  ]
};
```

### The Output

The plugin handles local variable scoping and prevents collisions, replacing the function call with a flat, labeled
block:

`dist/output.js`

```javascript
const a = 5;
let _calculateSquareResult;

_calculateSquareLabel: {
  const _x = a;
  const multiplier = _x;
  _calculateSquareResult = _x * multiplier;
}

const result = _calculateSquareResult;
```

## Configuration Options

The plugin accepts an options object when initialized:

| Option             | Type        | Default                         | Description                                                                                                                                                                  |
|--------------------|-------------|---------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `inlineIdentifier` | `string`    | `'@__INLINE__'`                 | The comment string the plugin looks for to identify functions that should be inlined. We recommend `'@__INLINE__'` to match the visual style of standard bundler directives. |
| `allowedGlobals`   | `strring[]` | [See Defaults](src/defaults.ts) | variables/functions globally available                                                                                                                                       |
| `fileExtensions`   | `string[]`  | [See Defaults](src/defaults.ts) | File extensions used by code files in your project                                                                                                                           |

## ⚠️ Requirements

A function must be pure to be inlinable. The plugin enforces strict AST analysis and will throw build errors if you
violate any of the following rules:

An inlined function must act as if every call to it could be correctly marked with `/*@__PURE__*/`

* **No Async or Generators:** `async`/`await` and `function*` alter execution timing and cannot be safely inlined into
  synchronous blocks.
* **No `this` or `arguments`:** The dynamic context of `this` and the `arguments` object will bind to the caller,
  resulting in unpredictable behavior.
* **No Outer Scope Mutations:** Inlined functions cannot reassign variables declared outside of their own block scope.
* **No Outer Scope References:** Inlined functions cannot use any outer references. Standard globals are ok like `Math`.
* **No Caller Expressions:** You cannot call an inlined function inside complex conditional expressions (like ternaries
  or `if (inlineFn())`). It must be called as a standalone statement or a direct variable assignment.
* **Recursive Functions:** A recursive function cannot be inlined

For more info on `/*@__PURE__*/` See:

* https://rollupjs.org/configuration-options/#pure
* https://rollupjs.org/configuration-options/#no-side-effects
* https://terser.org/docs/miscellaneous/#annotations

## Releases Automation

* update `package.json` file version (example: `1.0.99`)
* manually create a github release with a tag matching the `package.json` version prefixed with `v` (example: `v1.0.99`)
* npm should be updated automatically

## License

MIT