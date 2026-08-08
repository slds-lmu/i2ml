import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "static/vendor");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const copies = [
  ["node_modules/bootstrap/dist/css/bootstrap.min.css", "bootstrap/bootstrap.min.css"],
  ["node_modules/bootstrap/LICENSE", "bootstrap/LICENSE"],
  ["node_modules/mathjax/tex-mml-chtml.js", "mathjax/tex-mml-chtml.js"],
  ["node_modules/mathjax/input", "mathjax/input"],
  ["node_modules/mathjax/output", "mathjax/output"],
  ["node_modules/mathjax/adaptors", "mathjax/adaptors"],
  ["node_modules/mathjax/a11y", "mathjax/a11y"],
  ["node_modules/mathjax/ui/safe.js", "mathjax/ui/safe.js"],
  ["node_modules/mathjax/sre", "mathjax/sre"],
  ["node_modules/mathjax/LICENSE", "mathjax/LICENSE"],
  [
    "node_modules/@mathjax/mathjax-newcm-font/chtml.js",
    "mathjax-fonts/mathjax-newcm-font/chtml.js"
  ],
  [
    "node_modules/@mathjax/mathjax-newcm-font/chtml",
    "mathjax-fonts/mathjax-newcm-font/chtml"
  ],
  [
    "node_modules/@mathjax/mathjax-newcm-font/package.json",
    "mathjax-fonts/mathjax-newcm-font/package.json"
  ],
  ["node_modules/quizdown/public/build/quizdown.js", "quizdown/quizdown.js"],
  [
    "node_modules/quizdown/public/build/extensions/quizdownKatex.js",
    "quizdown/quizdownKatex.js"
  ],
  [
    "node_modules/quizdown/public/build/extensions/quizdownHighlight.js",
    "quizdown/quizdownHighlight.js"
  ],
  ["node_modules/quizdown/LICENSE", "quizdown/LICENSE"],
  [
    "node_modules/pdfjs-dist/build/pdf.min.mjs",
    "pdfjs/pdf.min.mjs"
  ],
  [
    "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    "pdfjs/pdf.worker.min.mjs"
  ],
  ["node_modules/pdfjs-dist/LICENSE", "pdfjs/LICENSE"]
];

for (const [source, target] of copies) {
  const destination = resolve(output, target);
  await mkdir(dirname(destination), { recursive: true });
  await cp(resolve(root, source), destination, { recursive: true });
}

const packages = [
  "@mathjax/mathjax-newcm-font",
  "bootstrap",
  "dompurify",
  "marked",
  "mathjax",
  "pdfjs-dist",
  "quizdown"
];
const versions = {};
for (const packageName of packages) {
  const raw = await readFile(resolve(root, "node_modules", packageName, "package.json"), "utf8");
  const metadata = JSON.parse(raw);
  versions[packageName] = metadata.version;
}
await writeFile(
  resolve(output, "versions.json"),
  `${JSON.stringify(versions, null, 2)}\n`,
  "utf8"
);
