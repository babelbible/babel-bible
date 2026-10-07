// Allowlist HTML sanitizer shared by EVERY markdown surface of the site:
// unit bodies (the codex marked pipeline), docs pages (md-docs), and the
// short-field inline renderers (titles, tier anchors, citations, concept
// catalog). Applied as a `renderer.html` override on each `Marked` instance
// so raw HTML embedded in markdown source is filtered before it reaches
// `dangerouslySetInnerHTML`; HTML that marked and its extensions generate
// themselves (KaTeX spans, Shiki code blocks, our own renderer output)
// never passes through `renderer.html` and is emitted untouched.
//
// Threat model: a compromised or generated Markdown file must not be able
// to inject scripts, event handlers, or dangerous URLs into the built
// site. Any tag outside the allowlist is emitted HTML-escaped — visible
// as source text, never executed. Allowed tags keep only allowlisted
// attributes; URL-bearing attributes (href, xmlns) additionally require a
// safe scheme (http(s), mailto, site-relative).
//
// The allowlist is deliberately a superset of what KaTeX emits, because
// `renderMathInHtmlItems` in marked-codex.ts pre-renders math inside raw
// HTML item blocks (`<li>$x$</li>`); that generated markup is re-tokenized
// by marked as a raw-HTML block and therefore passes back through this
// sanitizer. The emitted vocabulary was verified empirically by rendering
// every math span in content/ (831k spans) through katex with the site's
// options: only span/svg/path with class/style/aria-hidden/title/height/
// width/viewBox/preserveAspectRatio/xmlns/d appear. MathML tags are also
// allowed as future-proofing for `output: "htmlAndMathml"`.
//
// Known limitation (accepted): `style` attributes must remain allowed for
// KaTeX layout, so CSS injection into an allowed tag is possible; the CSP
// header in site/Caddyfile already permits inline styles, so this adds no
// new browser-level capability, and scripts/handlers/URLs stay blocked.

const ALLOWED_TAGS = new Set([
  // Structural markup used by unit bodies and docs (exercise scaffolding,
  // collapsibles, tables, emphasis; inventory of content/ as of 2026-10).
  "aside", "details", "summary", "p", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "td", "th",
  "strong", "em", "b", "i", "sub", "sup", "br", "kbd", "mark",
  "figure", "figcaption", "span", "code", "blockquote", "a",
  // KaTeX SVG glyph output.
  "svg", "path",
  // MathML tags KaTeX can emit with output "htmlAndMathml".
  "math", "semantics", "annotation", "annotation-xml", "mrow", "mi",
  "mo", "mn", "ms", "mtext", "mspace", "mfrac", "msqrt", "mroot",
  "msub", "msup", "msubsup", "munder", "mover", "munderover",
  "mmultiscripts", "mprescripts", "none", "mstyle", "mpadded",
  "mphantom", "menclose", "maction", "mglyph", "mtable", "mtr", "mtd",
  "mlabeledtr", "maligngroup", "malignmark",
]);

const ALLOWED_ATTR = /^(?:class|open|title|type|data-.+|aria-.+|style|role|href|target|rel|d|height|width|viewbox|preserveaspectratio|xmlns|encoding|mathvariant|scriptlevel|display|stretchy|fence|lspace|rspace|voffset|depth|mathcolor|mathbackground|columnalign|rowalign|notation|linethickness|separators|close)$/;

// URL-bearing attributes are kept only when their value is http(s), mailto,
// or site-relative — blocks javascript:, data:, and exotic schemes.
const URL_ATTR = /^(?:href|xmlns)$/;
const SAFE_URL = /^(?:https?:\/\/|mailto:|\/|\.\/|\.\.\/|#)/i;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function sanitizeRawHtml(chunk: string): string {
  return chunk.replace(
    /<\/?([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    (whole: string, name: string, attrs: string) => {
      const tag = name.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return escapeHtml(whole);
      if (whole.startsWith("</")) return `</${tag}>`;
      // Preserve self-closing syntax (`<path d="…"/>`) — KaTeX SVG
      // glyphs are self-closed, and dropping the slash would nest
      // sibling paths inside each other.
      const selfClosed = /\/\s*$/.test(attrs);
      const kept: string[] = [];
      const attrRe = /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|[^\s>]+))?/g;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(attrs)) !== null) {
        const attr = m[1].toLowerCase();
        if (!ALLOWED_ATTR.test(attr)) continue;
        const val = m[2] ?? m[3] ?? "";
        if (URL_ATTR.test(attr) && !SAFE_URL.test(val)) continue;
        kept.push(`${attr}="${val.replace(/"/g, "&quot;")}"`);
      }
      return `<${tag}${kept.length ? " " + kept.join(" ") : ""}${selfClosed ? " /" : ""}>`;
    },
  );
}

// marked v15+ passes an html token ({ text }) to renderer.html; older and
// inline paths may pass a bare string. Handle both shapes once, centrally.
export function sanitizeHtmlToken(tokenOrText: any): string {
  const text = typeof tokenOrText === "string"
    ? tokenOrText
    : tokenOrText?.text;
  return sanitizeRawHtml(text ?? "");
}

// KaTeX `trust` callback (rehype-katex / katex renderToString):KaTeX asks
// per potentially-dangerous command whether to honor it. We honor URL
// commands (\href, \url, \includegraphics) only for absolute http(s) or
// mailto URLs — never javascript: or other schemes — and refuse
// everything else (e.g. \htmlClass/\css).
export function trustedKatexUrl(context: any): boolean {
  const url = String(context?.url ?? "");
  return /^(?:https?:\/\/|mailto:)/i.test(url);
}
