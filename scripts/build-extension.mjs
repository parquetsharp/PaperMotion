import { build } from "esbuild";
import { mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookOpen } from "lucide-react";
import sharp from "sharp";
import { collectBundleLicenses } from "./release/licenses.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "extension", "build");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: { panel: "extension/src/panel.tsx", background: "extension/src/background.ts", theme: "extension/src/theme.ts" },
  outdir: output,
  bundle: true,
  format: "esm",
  target: "chrome116",
  jsx: "automatic",
  minify: true,
  sourcemap: false,
  metafile: true,
  legalComments: "eof",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
});
await Promise.all(["manifest.json", "panel.html"].map(name => copyFile(path.join(root, "extension", name), path.join(output, name))));
await copyFile(path.join(root, "LICENSE"), path.join(output, "LICENSE"));
await copyFile(path.join(root, "release", "edge", "NOTICE.txt"), path.join(output, "NOTICE.txt"));
const inventory = await collectBundleLicenses(root.replace(/[\\/]$/, ""), result.metafile.inputs, output);
const icon = renderToStaticMarkup(React.createElement(BookOpen, { size: 128, color: "#b11f4b", strokeWidth: 1.6 }));
for (const size of [16, 32, 48, 128]) {
  await writeFile(path.join(output, `icon-${size}.png`), await sharp(Buffer.from(icon)).resize(size, size).png().toBuffer());
}
console.log(`Load unpacked extension: ${output}`);
console.log(`Included licenses for ${inventory.length} bundled packages.`);