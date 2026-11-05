import { build } from "esbuild";

// Bundled CommonJS dependencies (express, pg, ...) call require() for Node built-ins,
// which ESM output does not provide, so recreate it from import.meta.url.
const banner = `import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);`;

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outExtension: { ".js": ".mjs" },
  outdir: "dist",
  sourcemap: true,
  banner: { js: banner },
  external: ["pg-native"],
  logLevel: "info",
};

await build({ ...shared, entryPoints: { app: "src/app.ts", index: "src/index.ts", migrate: "src/migrate.ts" } });
