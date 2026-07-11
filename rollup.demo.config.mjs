import {fileURLToPath} from "node:url"
import {lezer} from "@lezer/generator/rollup"
import typescript from "@rollup/plugin-typescript"

function resolveDependencies() {
  return {
    name: "resolve-demo-dependencies",
    resolveId(source) {
      if (
        source.startsWith(".") ||
        source.startsWith("/") ||
        source.startsWith("\0") ||
        /^\w:/.test(source)
      ) {
        return null
      }
      return fileURLToPath(import.meta.resolve(source))
    },
  }
}

export default {
  input: "./demo/demo.ts",
  external: id => id === "@cedar-policy/cedar-wasm/web",
  output: {
    file: "dist/demo.js",
    format: "es",
    sourcemap: true,
  },
  plugins: [
    lezer(),
    resolveDependencies(),
    typescript({
      tsconfig: false,
      compilerOptions: {
        strict: true,
        target: "es2022",
        module: "esnext",
        moduleResolution: "node",
        sourceMap: true,
      },
    }),
  ],
}
