import { readFile, readdir, mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function collectBundleLicenses(root, inputs, output) {
  const supplements = JSON.parse(await readFile(path.join(root, "release/edge/licenses/sources.json"), "utf8"));
  const packages = new Map();
  for (const input of Object.keys(inputs)) {
    if (!input.replaceAll("\\", "/").includes("node_modules/")) continue;
    let directory = path.dirname(path.resolve(root, input));
    while (directory.startsWith(root + path.sep)) {
      try {
        const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
        if (manifest.name && manifest.version) {
          packages.set(directory, manifest);
          break;
        }
      } catch {}
      directory = path.dirname(directory);
    }
  }
  const inventory = [];
  for (const [directory, manifest] of [...packages].sort((left, right) => left[1].name.localeCompare(right[1].name))) {
    const names = (await readdir(directory)).filter(name => /^(licen[cs]e|copying|notice|copyright|ofl)(\b|[-_.])/i.test(name));
    if (typeof manifest.license === "string" && /^SEE LICENSE IN /i.test(manifest.license)) names.push(manifest.license.replace(/^SEE LICENSE IN /i, ""));
    const files = [];
    const key = `${manifest.name.replaceAll("/", "__")}@${manifest.version}`;
    const supplement = supplements[`${manifest.name}@${manifest.version}`];
    if (!names.length && supplement) {
      await mkdir(path.join(output, "licenses", key), { recursive: true });
      await copyFile(path.join(root, "release/edge/licenses", supplement.file), path.join(output, "licenses", key, "LICENSE.txt"));
      await copyFile(path.join(directory, "readme.md"), path.join(output, "licenses", key, "UPSTREAM_README.md"));
      await writeFile(path.join(output, "licenses", key, "SOURCE.json"), JSON.stringify(supplement, null, 2) + "\n");
      files.push(...["LICENSE.txt", "UPSTREAM_README.md", "SOURCE.json"].map(name => `licenses/${key}/${name}`));
    }
    for (const name of new Set(names)) {
      if (path.basename(name) !== name) throw new Error(`Unsafe license path in ${manifest.name}`);
      const destination = path.join(output, "licenses", key, name);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(directory, name), destination);
      files.push(`licenses/${key}/${name}`);
    }
    inventory.push({ name: manifest.name, version: manifest.version, license: manifest.license ?? "UNDECLARED", files });
  }
  const missing = inventory.filter(item => !item.files.length || item.license === "UNDECLARED");
  if (missing.length) throw new Error(`Release requires license review: ${missing.map(item => item.name).join(", ")}`);
  await writeFile(path.join(output, "THIRD_PARTY_NOTICES.md"), `# Bundled Third-Party Software\n\nGenerated from the extension bundle inputs. License and copyright texts are retained verbatim in the listed files. This inventory is not a legal opinion.\n\n${inventory.map(item => `## ${item.name} ${item.version}\n\nLicense: ${typeof item.license === "string" ? item.license : JSON.stringify(item.license)}\n\n${item.files.map(file => `- [${file}](${file})`).join("\n")}\n`).join("\n")}`);
  await writeFile(path.join(output, "third-party-inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
  return inventory;
}