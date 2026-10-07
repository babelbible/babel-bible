// Custom `marked` extensions for Codex inline syntaxes.
//
// Implements:
//   [ref: source locator]   — citation footnote, hyperlinked + tooltipped
//   [unit-id]               — cross-reference to another unit (status-aware)
//
// Both are inline-level extensions. They do not interact with each other
// or with KaTeX (they require literal square brackets in markdown text).
// The unit-id matcher is restricted to the canonical id grammar
// (\d{2}\.\d{2}\.\d{2}, \d{2}\.\d{2}\.E\d+, \d{2}\.essays\.\d{2}) so it
// does not collide with ordinary markdown link references.

import type { TokenizerExtension, RendererExtension } from "marked";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import { sanitizeHtmlToken } from "./sanitize.js";

// Local katex-enabled inline renderer for math nested inside opaque HTML
// blocks (e.g. `<li>$x$</li>`). Kept local to avoid a circular import with
// `inline-math.ts` (which now consumes `preprocessMath` from this module).
// Raw HTML in the input is sanitized with the shared allowlist — this is
// one of the sinks for citation text (`[ref: …]`) and html-item bodies.
const _inlineMd = new Marked({ gfm: true });
_inlineMd.use(
  markedKatex({
    throwOnError: false,
    output: "html",
    strict: "ignore",
    nonStandard: true,
  }) as any,
);
_inlineMd.use({
  renderer: {
    html(tokenOrText: any) {
      return sanitizeHtmlToken(tokenOrText);
    },
  },
});
function renderInlineLocal(s: string): string {
  if (!s) return "";
  return (_inlineMd.parseInline(s) as string).trim();
}

type Tok = {
  type: string;
  raw: string;
  inner: string;
} | {
  type: string;
  raw: string;
  unitId: string;
};

// ---------------------------------------------------------------------------
// [ref: ...]
// ---------------------------------------------------------------------------
// One inline syntax, three reader-facing outcomes:
//
//   [ref: tong p.40]              resolved — `tong` is a registered source
//                                 key; the side-panel shows full metadata.
//   [ref: Schrödinger 1944]      free-form citation — shown verbatim, no
//                                 registered key, no panel metadata.
//   [ref: TODO_REF Kadanoff1966] pending — source not yet wired in. Readers
//   [ref: Lewis 1916, pending+pointer]   see only the cleaned citation; the
//                                 internal sentinels (`TODO_REF`,
//                                 `pending+pointer`) are stripped from view.
//
// The tokenizer captures the whole inner string so author names with
// non-ASCII letters (e.g. "Wächtershäuser") tokenize instead of leaking the
// raw `[ref: ...]` marker into the page.

const REF_RE = /^\[ref:\s*([^\]]*)\]/;

// Strip the internal pending sentinels so they never reach the reader.
function cleanCite(s: string): string {
  return s
    .replace(/\s*[—-]\s*pending acquisition.*$/i, "")
    .replace(/;?\s*see NEED_TO_SOURCE.*$/i, "")
    .replace(/\s*[—-]\s*acquisition.*$/i, "")
    // Combined refs like "Arnold 1966; ref: TODO_REF Marsden-Ratiu Ch. 13"
    // collapse to "Arnold 1966; Marsden-Ratiu Ch. 13".
    .replace(/[;,]\s*ref:\s*TODO_REF\s*/gi, "; ")
    .replace(/\bref:\s*TODO_REF\s*/gi, "")
    .replace(/\bTODO_REF\s*/g, "")
    .replace(/,?\s*pending\s*\+\s*pointer/gi, "")
    .replace(/,?\s*\bpending\b/gi, "")
    .replace(/\s*[;,]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const refTokenizer: TokenizerExtension = {
  name: "codexRef",
  level: "inline",
  start(src: string) {
    const i = src.indexOf("[ref:");
    return i === -1 ? undefined : i;
  },
  tokenizer(src: string) {
    const m = REF_RE.exec(src);
    if (!m) return undefined;
    return { type: "codexRef", raw: m[0], inner: m[1] };
  },
};

const refRenderer: RendererExtension = {
  name: "codexRef",
  renderer(token: any) {
    const inner = ((token as { inner: string }).inner || "").trim();
    const sp = inner.search(/\s/);
    const head = sp === -1 ? inner : inner.slice(0, sp);
    const rest = sp === -1 ? "" : inner.slice(sp + 1).trim();

    // Pending: explicit `TODO_REF` head or a `pending` sentinel anywhere.
    if (head === "TODO_REF" || /\bpending\b/i.test(inner)) {
      const cite = cleanCite(head === "TODO_REF" ? rest : inner) || "source pending";
      const c = escapeHtml(cite);
      const rendered = renderInlineLocal(cite);
      const h = escapeHtml(rendered);
      return `<span class="ref ref--pending" data-ref-pending="1" data-ref-cite="${c}" data-ref-html="${h}" title="${c} — source being verified"><sup>[${rendered}]</sup></span>`;
    }

    // Resolved: a lowercase slug head is a registered source key, looked up
    // in the citation panel's source table.
    if (/^[a-z][a-z0-9_-]*$/.test(head)) {
      const renderedRest = rest ? renderInlineLocal(rest) : "";
      const supBody = rest ? `${escapeHtml(head)} ${renderedRest}` : escapeHtml(head);
      const title = rest ? escapeHtml(`${head} — ${rest}`) : escapeHtml(head);
      const html = rest ? escapeHtml(renderedRest) : "";
      return `<span class="ref" data-ref-source="${escapeHtml(head)}" data-ref-locator="${escapeHtml(rest)}" data-ref-html="${html}" title="${title}"><sup>[${supBody}]</sup></span>`;
    }

    // Free-form citation (e.g. author-year) with no registered key.
    const cite = cleanCite(inner);
    const c = escapeHtml(cite);
    const rendered = renderInlineLocal(cite);
    const h = escapeHtml(rendered);
    return `<span class="ref" data-ref-cite="${c}" data-ref-html="${h}" title="${c}"><sup>[${rendered}]</sup></span>`;
  },
};

// ---------------------------------------------------------------------------
// [<section>.<chapter>.<ordinal>]  — bare unit-id reference
// ---------------------------------------------------------------------------
// Full canonical unit-id grammar: NN.NN.NN units, NN.NN.EN exercise packs,
// NN.essays.NN essays. The match stays anchored to the bracketed id so
// arbitrary bracket text never links; malformed ids still do not link.

const UNIT_ID_RE = /^\[(\d{2}\.(?:\d{2}\.\d{2}|\d{2}\.E\d+|essays\.\d{2}))\]/;
const UNIT_ID_START_RE = /\[\d{2}\.(?:\d{2}\.\d{2}|\d{2}\.E\d+|essays\.\d{2})\]/;

const unitRefTokenizer: TokenizerExtension = {
  name: "codexUnitRef",
  level: "inline",
  start(src: string) {
    const m = src.match(UNIT_ID_START_RE);
    return m ? src.indexOf(m[0]) : undefined;
  },
  tokenizer(src: string) {
    const m = UNIT_ID_RE.exec(src);
    if (!m) return undefined;
    return {
      type: "codexUnitRef",
      raw: m[0],
      unitId: m[1],
    };
  },
};

// Build-time set of shipped unit IDs (filled in by content collection scan).
// We default to empty; the codex app populates it via a side-effect import.
const shippedUnitIds = new Set<string>();

export function setShippedUnitIds(ids: Iterable<string>) {
  shippedUnitIds.clear();
  for (const id of ids) shippedUnitIds.add(id);
}

const unitRefRenderer: RendererExtension = {
  name: "codexUnitRef",
  renderer(token: any) {
    const t = token as { unitId: string };
    if (shippedUnitIds.has(t.unitId)) {
      return `<a class="unit-ref" href="/u/${t.unitId}"><code>${t.unitId}</code></a>`;
    }
    return `<span class="unit-ref unit-ref--pending" title="unit pending"><code>${t.unitId}</code> <span class="unit-ref__badge">pending</span></span>`;
  },
};

// ---------------------------------------------------------------------------
// Image renderer override
// ---------------------------------------------------------------------------
// Default marked v15 passes alt text through unescaped, so quoted labels in
// the markdown source ("ker T", "coker T", etc.) produce HTML attributes with
// literal inner double quotes — which break Vite's parse5 HTML transform in
// dev, and any strict downstream HTML consumer. Override the renderer to
// escape href, alt, and title at attribute level.

interface MarkedImageToken {
  href: string;
  title: string | null;
  text: string;
}

// ---------------------------------------------------------------------------
// Internal production-note suppression
// ---------------------------------------------------------------------------
// The production pipeline appends a trailing provenance note to each unit /
// essay body — production wave/cycle, date, agent model, `hooks_out` targets,
// `PLAN.md §` pointers, draft status. These are useful project records but
// leak internal scaffolding onto reader-facing pages. We keep them in the
// markdown source and strip them at render time.
//
// Signature: a paragraph that opens with a *single* `*`/`_` (italic, never a
// `**bold**` content lead-in) and carries an unambiguous production token.
// Validated to match every production note and no curriculum prose.

const PRODUCTION_NOTE_TOKENS =
  /(agent-drafted|hooks_out|hooks_in|All hooks|\bseed unit\b|to be resolved during|cross-domain audit|sourcing pass|Cross-references\.|Citation status\.|docs\/plans\/|PLAN\.md|reference\/ archive|pending\+pointer|\bunit #\d|[Pp]roduced manually|[Pp]roduced 20\d\d|produced by (?:claude|gpt|glm|deepseek)|First production by|deepened (?:to|from|in|as|per|\d)|deepening\b|\bWave \d|\bCycle [0-9A-Z]|\bPass \d unit|\bP\d unit|v0\.\d Strand|Strand [A-Z] unit|Phase \d\.\d|Pilot unit|claude-opus|claude-sonnet|claude-haiku|claude-glm|glm-agent|gpt-[0-9]|deepseek|autonomous production|Catalog entry|CONCEPT_CATALOG|Citations marked\s+`?TODO_REF|item-A block|Section \d+ opener|first production unit)/;

function isProductionNote(text: string): boolean {
  const t = text.trim();
  if (!(/^\*(?!\*)/.test(t) || /^_(?!_)/.test(t))) return false;
  return PRODUCTION_NOTE_TOKENS.test(text);
}

const THEMATIC_BREAK = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

// Some units append a `Catalog entry` section that dumps the unit's own
// frontmatter (concept id, status, produced_by, word count, dates) — as a
// fenced block, bullet list, table, or inline after the heading. That's
// internal metadata, not reader content. Strip the heading through the next
// heading / rule / end-of-document, plus any rule that precedes it.
function stripCatalogEntry(markdown: string): string {
  // Catalog-entry sections are always terminal — strip the heading through
  // end-of-document. Using `(?=$)` instead of "next heading" avoids stopping
  // prematurely on `###` lines inside the section's fenced code block.
  return markdown.replace(
    /\n+(?:-{3,}[ \t]*\n+)?#{1,6}[ \t]*Catalog entry\b[\s\S]*$/i,
    "\n",
  );
}

// Replace internal field-name jargon ("the frontmatter's `lean_mathlib_gap`
// field", "no `lean_module`") with reader-friendly phrasing. Backticked
// forms only — bare YAML keys inside fenced code examples are left alone.
function cleanProseJargon(markdown: string): string {
  return markdown
    // Compound phrases first (longest match wins).
    .replace(/the\s+frontmatter'?s?\s+`?lean_mathlib_gap`?\s+(?:field|block)/gi, "the Mathlib gap analysis")
    .replace(/the\s+`?lean_mathlib_gap`?\s+(?:field|block)\s+(?:in|of)\s+(?:the\s+)?frontmatter/gi, "the Mathlib gap analysis")
    .replace(/`?lean_mathlib_gap`?\s+in\s+(?:the\s+)?frontmatter/gi, "Mathlib gap analysis")
    .replace(/the\s+`?lean_mathlib_gap`?\s+(?:field|block)/gi, "the Mathlib gap analysis")
    .replace(/`lean_mathlib_gap`/g, "Mathlib gap analysis")
    .replace(/`lean_module`/g, "Lean module")
    // Generic frontmatter references in prose.
    .replace(/\bnamed in the frontmatter\b/gi, "documented in the unit metadata")
    .replace(/\bin the frontmatter\b/gi, "in the unit metadata")
    .replace(/\bfrom the frontmatter\b/gi, "from the unit metadata")
    .replace(/\bthe frontmatter'?s\b/gi, "the unit metadata's")
    .replace(/\bthe frontmatter\b/gi, "the unit metadata");
}

// Image alt text frequently carries "A schematic placeholder diagram for X".
// Readers don't need the placeholder signal; strip the word from alt-text.
function cleanImageAltPlaceholder(markdown: string): string {
  return markdown.replace(/(!\[[^\]]*?)\s+placeholder\b/gi, "$1");
}

// Some units wrap every body paragraph in literal `<p>…</p>` HTML. Marked
// treats raw-HTML blocks as opaque, which blocks inline syntax inside —
// `[ref:]` markers and `$…$` math never get tokenized. Strip the redundant
// wrapper tags; markdown will paragraph the content normally. Tagged openers
// such as `<p class="exercise__label">…</p>` carry styling and are left intact
// (stripping only their `</p>` would leave a dangling opener and pull the
// following line into the same raw-HTML block).
function stripRedundantPTags(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      if (/^<p[^>]/.test(line)) return line;
      let out = line;
      if (/^<p>/.test(out)) out = out.replace(/^<p>/, "");
      if (/<\/p>$/.test(out)) out = out.replace(/<\/p>$/, "");
      return out;
    })
    .join("\n");
}

// HTML-block boundaries in exercise scaffolding (`<aside>`, `<p …>`, `<details>`,
// `<summary>`) make marked treat everything up to the next blank line as an
// opaque raw-HTML block, so the markdown content between them (math, emphasis,
// `[ref:]`) is never tokenised. Inject blank lines around these boundaries so
// marked re-enters markdown parsing for the inner content, per CommonMark
// HTML-block rules.
function openDetailsBlocks(markdown: string): string {
  return markdown
    .replace(/(<summary>[^<]*<\/summary>)\n(?!\n)/g, "$1\n\n")
    .replace(/(?<!\n)\n<\/details>/g, "\n\n</details>")
    .replace(/(<\/p>)\n(?!\n)/g, "$1\n\n")
    .replace(/(<aside[^>]*>)\n(?!\n)/g, "$1\n\n")
    .replace(/(?<!\n\n)(\n*)(<\/aside>)/g, "\n\n$2");
}

// Display-math blocks (`$$...$$`) must sit on their own paragraph for the
// marked-katex block tokenizer to recognise them. Two failure modes arise in
// the corpus:
//   (a) a `$$` opener glued to the preceding prose ("we get:\n$$..") — marked
//       folds the region into one paragraph, the inline tokenizer cannot span
//       the newlines, and the math interior leaks into emphasis;
//   (b) `$$` delimiters glued to the math content (`$$\begin{array}{c}\n..\n\end{array}$$`)
//       — marked-katex only fires its block tokenizer on a line that begins
//       with `$$`, so a glued opener is never recognised.
// Fix: phase 1 normalises every glued `$$` delimiter onto its own line (and
// splits single-line `$$...$$` into opener/content/closer); phase 2 ensures a
// blank line borders the now-standalone delimiters. Fenced code is skipped so
// `$$` shown as a code example is left alone.
function separateDisplayMath(markdown: string): string {
  const lines = markdown.split("\n");
  const norm: string[] = [];
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(?:`{3,}|~{3,})/.test(trimmed)) {
      inFence = !inFence;
      norm.push(line);
      continue;
    }
    if (inFence) {
      norm.push(line);
      continue;
    }
    if (trimmed === "$$" || !trimmed.includes("$$")) {
      norm.push(line);
      continue;
    }
    if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) {
      norm.push("$$", trimmed.slice(2, -2), "$$");
      continue;
    }
    if (trimmed.startsWith("$$")) {
      norm.push("$$", trimmed.slice(2));
      continue;
    }
    if (trimmed.endsWith("$$")) {
      norm.push(trimmed.slice(0, -2), "$$");
      continue;
    }
    norm.push(line);
  }
  const out: string[] = [];
  let inMath = false;
  for (let i = 0; i < norm.length; i++) {
    const line = norm[i];
    if (line.trim() !== "$$") {
      out.push(line);
      continue;
    }
    if (!inMath) {
      if (out.length && out[out.length - 1].trim() !== "") out.push("");
      out.push(line);
      inMath = true;
    } else {
      out.push(line);
      const next = norm[i + 1];
      if (next !== undefined && next.trim() !== "") out.push("");
      inMath = false;
    }
  }
  return out.join("\n");
}

// marked-katex's inline tokenizer cannot match `$…$` across a newline, so a
// math expression an author split over two source lines renders raw. Re-join
// such split spans by collapsing the line break inside a line whose `$` count
// (excluding `$$` display delimiters and escaped `\$`) is odd. Safe for this
// corpus because `$` is always math (no currency). Fenced code and paragraph
// breaks are respected.
function rejoinSplitInlineMath(markdown: string): string {
  const lines = markdown.split("\n");
  let inFence = false;
  let guard = 0;
  for (let i = 0; i < lines.length - 1 && guard < 200000; i++) {
    guard++;
    const line = lines[i];
    if (/^(?:`{3,}|~{3,})/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const next = lines[i + 1];
    if (next.trim() === "") continue;
    const cleaned = line.replace(/\$\$/g, "").replace(/\\\$/g, "");
    const dollars = (cleaned.match(/\$/g) || []).length;
    if (dollars % 2 === 1) {
      lines[i] = line + " " + next.trimStart();
      lines.splice(i + 1, 1);
      i--;
    }
  }
  return lines.join("\n");
}


// an italic/bold `*...*` region when the math itself contains `*` (Hodge star,
// superscript-star `^*`, convolution). The `*` inside the math is read as an
// emphasis closer, the `$...$` is broken open, and the interior leaks as raw
// TeX. KaTeX renders `*` and `\ast` identically in math mode, so we rewrite
// bare `*` to `\ast` inside math delimiters — a visual no-op that simply stops
// marked from seeing the asterisk as an emphasis delimiter. Fenced code and
// inline code spans are left untouched (verified: no real corpus code span
// contains both `$` and `*`). Runs after separateDisplayMath so multi-line
// `$$...$$` blocks already have their delimiters on isolated lines.
function protectMathAsterisk(markdown: string): string {
  const lines = markdown.split("\n");
  let inFence = false;
  let inDisplay = false;
  // Convert bare `*` to `\ast`, but only inside math delimiters and only when
  // the star is not a LaTeX starred-command suffix (`\tag*`, `\sqrt*`, …) —
  // those keep their `*`. `(?<![\\a-zA-Z])` prevents touching a star that
  // follows a backslash or a letter, so `\tag*` and `ab*c` are preserved while
  // `^*` (the Hodge-star / superscript case that trips marked's emphasis) is
  // rewritten.
  // Convert bare `*` to `\ast`, but only inside math delimiters. Three cases:
  //  (1) a starred LaTeX command suffix (`\operatorname*`, `\sum*`) — the star
  //      is a variant marker, not a symbol; drop it so it neither breaks KaTeX
  //      (`\operatorname\ast` is invalid) nor trips marked's emphasis;
  //  (2) a standalone math star (`^*` Hodge/superscript, ` * ` multiplication)
  //      that is not part of `**` and not letter/backslash-preceded — rewrite
  //      to `\ast` so marked's emphasis tokenizer cannot split the `$…$` span;
  //  (3) everything else (`**` bold markers, `xy*z` juxtaposition) — leave
  //      intact.
  const toAst = (s: string) =>
    s
      .replace(/\\([a-zA-Z]+)\*\{/g, "\\$1{")
      .replace(/\\([a-zA-Z]+)\*/g, "\\$1")
      .replace(/(?<![\\a-zA-Z*])\*(?!\*)/g, "\\ast");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^(?:`{3,}|~{3,})/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const isDelim = trimmed === "$$";
    if (inDisplay) {
      if (isDelim) {
        inDisplay = false;
        continue;
      }
      lines[i] = toAst(line);
      continue;
    }
    if (isDelim) {
      inDisplay = true;
      continue;
    }
    // Inline / single-line math: convert `*` only inside the math body, not in
    // the leading character captured before the opening `$` (that may be a
    // legitimate emphasis delimiter — e.g. `*$x$ text*`).
    lines[i] = line.replace(
      /(`[^`]*`)|(\$\$.*?\$\$)|(^|[^\\$])\$([^\n$]+?)(?<!\\)\$(?!\d)/g,
      (m, code: string, display: string, lead: string, body: string) => {
        if (code) return code;
        if (display) return toAst(display);
        return lead + "$" + toAst(body) + "$";
      },
    );
  }
  return lines.join("\n");
}


// Inline-content HTML tags (`<li>`, `<td>`, …) are opaque HTML blocks to
// marked, so `$…$` math nested inside them never reaches the katex tokenizer.
// Exercise multiple-choice options in particular wrap math-bearing text in
// `<li>…</li>`. Pre-render the inner content through the same inline pipeline
// used for unit titles so the math ships as KaTeX HTML.
function renderMathInHtmlItems(markdown: string): string {
  return markdown.replace(
    /(<(?:li|td|th|option|dt|dd|figcaption|caption)\b[^>]*>)([\s\S]*?)(<\/(?:li|td|th|option|dt|dd|figcaption|caption)>)/g,
    (_m, open: string, body: string, close: string) =>
      open + renderInlineLocal(body) + close,
  );
}

// The math-specific preprocessing transforms (delimiter normalisation, split
// inline-math rejoining, emphasis-asterisk protection), factored out so they
// can be reused by `renderBlock` in `inline-math.ts` for fields like
// `lean_mathlib_gap` that render through a separate Marked instance.
export function preprocessMath(markdown: string): string {
  return protectMathAsterisk(
    rejoinSplitInlineMath(separateDisplayMath(markdown)),
  );
}

// Self-contained bold spans; consume one leading space so removal doesn't
// leave a "word ," artifact. (We do not touch unbracketed prose such as
// "no citation needed".)
function stripEditorialMarkers(markdown: string): string {
  return markdown.replace(
    / ?\*{0,2}\[Need to source\b[^\]]*\]\*{0,2}/gi,
    "",
  );
}

// Remove production notes from raw markdown along with the `---` rule that
// precedes them, so no orphan horizontal rule is left at the foot of the page.
function stripProductionNotes(markdown: string): string {
  const blocks = markdown.split(/\n{2,}/);
  const keep: string[] = [];
  for (const b of blocks) {
    if (isProductionNote(b)) {
      if (keep.length && THEMATIC_BREAK.test(keep[keep.length - 1])) keep.pop();
      continue;
    }
    keep.push(b);
  }
  while (keep.length && (THEMATIC_BREAK.test(keep[keep.length - 1]) || keep[keep.length - 1].trim() === "")) {
    keep.pop();
  }
  return keep.join("\n\n");
}

// ---------------------------------------------------------------------------
// Public extension
// ---------------------------------------------------------------------------

// The unit Visual sections carry auto-generated placeholder SVG diagrams
// (`/img/<slug>-placeholder.svg`). They are not yet at a quality bar we trust to
// teach from, so we suppress every rendered image site-wide while keeping the
// source `![...]()` tags intact (validator/provenance untouched) and the prose
// description in each Visual section visible. Flip to `false` to bring images
// back once real diagrams replace the placeholders.
const HIDE_IMAGES = true;

export const codexMarkedExtensions = {
  extensions: [
    refTokenizer,
    refRenderer,
    unitRefTokenizer,
    unitRefRenderer,
  ],
  renderer: {
    // Raw HTML from unit markdown source is filtered through the shared
    // allowlist sanitizer before it reaches the page (C-01): scripts,
    // event handlers, and unsafe URLs are stripped/escaped, while the
    // structural exercise markup and pre-rendered KaTeX survive.
    html(tokenOrText: any) {
      return sanitizeHtmlToken(tokenOrText);
    },
    image(token: MarkedImageToken) {
      if (HIDE_IMAGES) return "";
      const { href, title, text } = token;
      const safeHref = escapeHtml(href);
      const safeAlt = escapeHtml(text);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${safeHref}" alt="${safeAlt}"${titleAttr} />`;
    },
    // Tier markers in section headings (`## Intuition [Beginner]`) render as
    // styled pills instead of raw bracketed text. The toggle no longer hides
    // tiers, so the marker is the reader's signal for which tier they're in.
    heading(this: any, token: any) {
      const depth = Math.min(Math.max(token?.depth || 2, 1), 6);
      const html = this.parser.parseInline(token.tokens);
      const m = html.match(/^([\s\S]*?)\s*\[(Beginner|Intermediate\+?|Master)\]\s*$/);
      if (!m) return `<h${depth}>${html}</h${depth}>`;
      const label = m[2];
      const cls = label.toLowerCase().replace("+", "-plus");
      return `<h${depth}>${m[1]} <span class="tier-pill tier-pill--${cls}">${label}</span></h${depth}>`;
    },
  },
  hooks: {
    preprocess(markdown: string) {
      return stripProductionNotes(
        stripEditorialMarkers(
          stripCatalogEntry(
            renderMathInHtmlItems(
              stripRedundantPTags(
                openDetailsBlocks(
                  protectMathAsterisk(
                    rejoinSplitInlineMath(
                      separateDisplayMath(
                        cleanImageAltPlaceholder(cleanProseJargon(markdown)),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    },
  },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
