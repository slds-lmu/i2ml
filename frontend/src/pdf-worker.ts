/**
 * PDF.js worker entry: installs the runtime polyfills inside the worker scope
 * before the pdf.js worker code evaluates, so PDF parsing also works in
 * browsers that predate the map-upsert / Promise.try / Iterator-helper APIs.
 */
import "./runtime-compat";
import "pdfjs-dist/build/pdf.worker.min.mjs";
