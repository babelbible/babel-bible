import { defineConfig, adapterStatic, setActiveMarkdownConfig } from "@neutron-build/core";
import { codexMarkdownConfig, setShippedUnitIds } from "./src/lib/markdown-config.js";
import { collectShippedIds } from "./src/lib/shipped-ids.js";

setShippedUnitIds(collectShippedIds("./src/content/units"));
setActiveMarkdownConfig(codexMarkdownConfig);

export default defineConfig({
  runtime: "preact",
  adapter: adapterStatic({ precompress: true }),
  markdown: codexMarkdownConfig,
});
