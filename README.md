# @sjincho/codemirror-lang-cedar

CodeMirror 6 language support for the [Cedar](https://www.cedarpolicy.com/) policy language: a Lezer grammar with highlighting, plus **optional Cedar-powered linting** (syntax + schema validation with precise source ranges) and **schema-aware completion** — backed by Cedar's official WebAssembly SDK.

The one existing community package (`codemirror-lang-cedar`) is an unmaintained, highlighting-only scaffold; this adds the validation and schema-awareness that make Cedar authoring practical in the browser.

## Install

This package is distributed from GitHub (not the npm registry). The built `dist/` is
committed, so installing it runs **no build or install scripts** — nothing from this
package executes on `npm install` (no supply-chain surface from lifecycle scripts).
Install it as a git dependency:

```sh
npm install github:sjincho/codemirror-lang-cedar
```

Or pin it in a consumer's `package.json`:

```json
{
  "dependencies": {
    "@sjincho/codemirror-lang-cedar": "github:sjincho/codemirror-lang-cedar"
  }
}
```

Install the optional Cedar peer only when the editor needs local validation or schema-aware completion:

```sh
npm install @cedar-policy/cedar-wasm
```

## Features

- Parsing and Lezer syntax highlighting for Cedar static policies and templates
- Debounced syntax and strict schema-validation diagnostics for both policy forms
- Cedar keyword, entity, action, and attribute completion
- Human-format and JSON Cedar schemas
- Dependency-injected Cedar WASM, with no hidden runtime import
- CodeMirror 6 extensions that compose with an existing editor setup

Syntax highlighting does **not** require WASM. The optional `@cedar-policy/cedar-wasm` peer is loaded only when the caller imports it and injects its methods into the linter or completion source.

## Basic language support

```ts
import {EditorState} from "@codemirror/state"
import {EditorView} from "@codemirror/view"
import {syntaxHighlighting} from "@codemirror/language"
import {cedar, cedarHighlightStyle} from "@sjincho/codemirror-lang-cedar"

const state = EditorState.create({
  doc: `permit(principal, action, resource);`,
  extensions: [
    cedar(),
    syntaxHighlighting(cedarHighlightStyle),
  ],
})

new EditorView({state, parent: document.querySelector("#editor")!})
```

## Browser validation and completion

The `/web` build must be initialized exactly once before constructing the editor. The example serves dependencies from the repository root; in production, copy the `.wasm` file to a public URL and update the URL below.

```ts
import {autocompletion} from "@codemirror/autocomplete"
import {syntaxHighlighting} from "@codemirror/language"
import {EditorState} from "@codemirror/state"
import {EditorView} from "@codemirror/view"
import initCedarWasm, * as cedarWasm from "@cedar-policy/cedar-wasm/web"
import type {Schema} from "@cedar-policy/cedar-wasm/web"
import {
  cedar,
  cedarCompletion,
  cedarHighlightStyle,
  cedarLinter,
} from "@sjincho/codemirror-lang-cedar"

const schema: Schema = `
namespace Demo {
  entity Role;
  entity Datasource { classification: String };
  action "query" appliesTo {
    principal: [Role],
    resource: [Datasource],
    context: { readOnly: Bool }
  };
}
`

await initCedarWasm({
  module_or_path: new URL(
    "../node_modules/@cedar-policy/cedar-wasm/web/cedar_wasm_bg.wasm",
    import.meta.url,
  ),
})

// Pass initialized methods, not the namespace's `default` initializer.
const cedarMethods = {
  policySetTextToParts: cedarWasm.policySetTextToParts,
  checkParsePolicySet: cedarWasm.checkParsePolicySet,
  schemaToJson: cedarWasm.schemaToJson,
  validate: cedarWasm.validate,
}

const state = EditorState.create({
  doc: `permit(principal, action == Demo::Action::"query", resource);`,
  extensions: [
    cedar(),
    syntaxHighlighting(cedarHighlightStyle),
    cedarLinter({cedar: cedarMethods, schema}),
    autocompletion({
      override: [cedarCompletion({cedar: cedarMethods, schema})],
    }),
  ],
})

new EditorView({state, parent: document.querySelector("#editor")!})
```

Passing an initialized method-only object is important: it prevents the package adapter from invoking the `/web` default initializer a second time.

## Linting

Local linting handles static policies, templates such as `permit(principal == ?principal, action, resource);`, and source that mixes both forms. Syntax linting requires `policySetTextToParts` and `checkParsePolicySet`; add `schema` and `validate` for strict Cedar schema validation:

```ts
const syntaxMethods = {
  policySetTextToParts: cedarWasm.policySetTextToParts,
  checkParsePolicySet: cedarWasm.checkParsePolicySet,
}

cedarLinter({cedar: syntaxMethods})

cedarLinter({
  cedar: {
    ...syntaxMethods,
    validate: cedarWasm.validate,
  },
  schema,
  delay: 400,
})
```

A server can be the validator instead. Return ordinary CodeMirror diagnostics; this path does not load Cedar WASM in the browser:

```ts
import type {Diagnostic} from "@codemirror/lint"

cedarLinter({
  delay: 500,
  validate: async source => {
    const response = await fetch("/api/cedar/validate", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({source}),
    })
    if (!response.ok) throw new Error(`Validation failed: ${response.status}`)
    return await response.json() as Diagnostic[]
  },
})
```

## Completion

`cedarCompletion()` always provides Cedar keywords. Inject both `cedar` and `schema` to add entities, actions, and attributes from the schema. Completion only uses schema conversion, so an editor without local linting may inject a smaller object containing only `schemaToJson`:

```ts
import {autocompletion} from "@codemirror/autocomplete"

const completionMethods = {
  schemaToJson: cedarWasm.schemaToJson,
}

const completion = autocompletion({
  override: [cedarCompletion({cedar: completionMethods, schema})],
})
```

In React, Vue, or another reactive wrapper, keep the extension array and injected config objects stable or memoized. Recreating them on every render discards the completion cache and needlessly reconfigures the editor.

## Demo

```sh
npm install
npm run demo:build
python3 -m http.server 8000
```

Then open `http://localhost:8000/demo/`. Serving over HTTP is required so the browser can fetch the WASM module.

## API

- `cedar()` — Cedar `LanguageSupport` for CodeMirror 6.
- `cedarLanguage` — the configured Cedar `LRLanguage`.
- `cedarHighlightStyle` — the package's default `HighlightStyle`.
- `cedarLinter(config?)` — a debounced linter using injected Cedar methods or a custom validator.
- `cedarCompletion(config?)` — a Cedar completion source with optional schema enrichment.
- `CedarSchema`, `CedarWasmModule`, `CedarLinterConfig`, and `CedarCompletionConfig` — exported TypeScript contracts.

## Version and support

The `0.x` series may refine grammar coverage and TypeScript APIs between minor releases. It targets CodeMirror 6 and the declared `@cedar-policy/cedar-wasm` peer range; use the package peer-dependency warnings as the compatibility source of truth.

MIT licensed. See [LICENSE](./LICENSE).
