// Build the landing page: inject the brand fonts (from the app's
// node_modules) + logo.svg into landing-template.html. Output is a single
// self-contained HTML file (also published as a claude.ai artifact).
//   node website/build-landing.mjs [out.html]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "apps", "app");
const b64 = (p) => readFileSync(p).toString("base64");
const font = (n) =>
  b64(join(app, "node_modules", "@fontsource", n.split("/")[0], "files", n.split("/")[1]));

let html = readFileSync(join(root, "website", "landing-template.html"), "utf8");
const logo = readFileSync(join(app, "public", "logo.svg"), "utf8")
  .replace(/<\?xml[^>]*\?>/, "")
  .trim();
html = html
  .replace("{{F_H700}}", font("stack-sans-headline/stack-sans-headline-latin-700-normal.woff"))
  .replace("{{F_H300}}", font("stack-sans-headline/stack-sans-headline-latin-300-normal.woff"))
  .replace("{{F_T400}}", font("stack-sans-text/stack-sans-text-latin-400-normal.woff"))
  .replaceAll("{{LOGO_SVG_SM}}", logo)
  .replaceAll("{{LOGO_SVG}}", logo);

const out = process.argv[2] ?? join(root, "website", "landing.html");
writeFileSync(out, html);
console.log(`✓ ${out} (${(html.length / 1024).toFixed(0)}KB)`);
