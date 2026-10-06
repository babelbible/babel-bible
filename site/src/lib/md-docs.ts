// Generic markdown-doc reader used by /specs, /plans, and /sources.
// Reads a directory of .md files and renders each through marked + KaTeX.

import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";

export interface DocSummary {
  slug: string;       // filename without .md
  title: string;      // first H1 in the file
  filePath: string;
}

export interface RenderedDoc {
  slug: string;
  title: string;
  html: string;
}

// Raw HTML is permitted only for a narrow allowlist of structural tags
// used by the spec/plan docs (collapsible exercise hints etc.); allowed
// tags keep only class/open/title/data-*/aria-* attributes. Any other
// tag is emitted HTML-escaped: visible as source text, never executed,
// so a compromised or generated Markdown file cannot inject scripts,
// event handlers, or arbitrary markup into the built site.
const ALLOWED_TAGS = new Set([
  "aside", "details", "summary",
  "b", "i", "em", "strong", "sub", "sup", "br", "kbd", "mark",
]);
const ALLOWED_ATTR = /^(?:class|open|title|data-.+|aria-.+)$/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeRawHtml(chunk: string): string {
  return chunk.replace(
    /<\/?([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    (whole: string, name: string, attrs: string) => {
      const tag = name.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return escapeHtml(whole);
      if (whole.startsWith("</")) return `</${tag}>`;
      const kept: string[] = [];
      const attrRe = /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|[^\s>]+))?/g;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(attrs)) !== null) {
        const attr = m[1].toLowerCase();
        if (!ALLOWED_ATTR.test(attr)) continue;
        const val = m[2] ?? m[3] ?? "";
        kept.push(`${attr}="${val.replace(/"/g, "&quot;")}"`);
      }
      return `<${tag}${kept.length ? " " + kept.join(" ") : ""}>`;
    },
  );
}

const _marked = new Marked();
_marked.use(markedKatex({ throwOnError: false, output: "html", strict: "ignore", nonStandard: true }) as any);
// marked passes raw-HTML tokens (block and inline) through this
// renderer; everything else it generates itself is untouched.
_marked.use({
  renderer: {
    html(tokenOrText: any) {
      const text = typeof tokenOrText === "string" ? tokenOrText : tokenOrText.text;
      return sanitizeRawHtml(text ?? "");
    },
  },
});

function firstHeading(body: string): string {
  const m = /^#\s+(.+)$/m.exec(body);
  return m ? m[1].trim() : "";
}

export function listDocs(dir: string): DocSummary[] {
  if (!existsSync(dir)) return [];
  const out: DocSummary[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const filePath = resolve(dir, name);
    let s;
    try { s = statSync(filePath); } catch { continue; }
    if (!s.isFile()) continue;
    const slug = name.replace(/\.md$/, "");
    const body = readFileSync(filePath, "utf-8");
    out.push({ slug, title: firstHeading(body) || slug, filePath });
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

export function renderDoc(dir: string, slug: string): RenderedDoc | null {
  const filePath = resolve(dir, `${slug}.md`);
  if (!existsSync(filePath)) return null;
  const body = readFileSync(filePath, "utf-8");
  const title = firstHeading(body) || slug;
  const stripped = body.replace(/^#\s+.+\n/, "");
  const html = _marked.parse(stripped) as string;
  return { slug, title, html };
}

export const SPECS_DIR = resolve(import.meta.dirname, "../../../docs/specs");
export const PLANS_DIR = resolve(import.meta.dirname, "../../../docs/plans");
