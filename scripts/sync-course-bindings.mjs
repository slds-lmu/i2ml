import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(
  process.argv[2] ??
    "/workspace/i2ml-course-data/application/corpus/v1/hugo-lecture-bindings.json"
);
const destination = resolve(websiteRoot, "data/lecture_bindings.json");

const raw = await readFile(source, "utf8");
const value = JSON.parse(raw);
if (
  value?.schema_version !== 1 ||
  typeof value?.content_revision !== "string" ||
  !value.content_revision ||
  typeof value?.bindings !== "object" ||
  value.bindings === null ||
  Array.isArray(value.bindings) ||
  Object.keys(value.bindings).length === 0
) {
  throw new Error("course binding artifact does not satisfy the expected contract");
}

for (const [contentPath, binding] of Object.entries(value.bindings)) {
  if (
    !contentPath.startsWith("content/") ||
    !contentPath.endsWith(".md") ||
    typeof binding !== "object" ||
    binding === null ||
    typeof binding.lecture_id !== "string" ||
    !binding.lecture_id
  ) {
    throw new Error(`invalid course binding: ${contentPath}`);
  }
}

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, raw.endsWith("\n") ? raw : `${raw}\n`, "utf8");
process.stdout.write(
  `Synchronized ${Object.keys(value.bindings).length} course bindings for ${value.content_revision}.\n`
);
