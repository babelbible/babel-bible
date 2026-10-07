"""Site HTML-sanitizer guards (audit pass C, finding C-01 and friends).

Two layers:

1. Behavioral — imports the REAL site/src/lib/sanitize.ts through Node's
   type stripping and runs the adversarial fixture battery from the audit
   (script injection, handler injection, javascript: URLs, KaTeX markup
   round-trip, trust-callback behavior, idempotency). Skips with a message
   when no Node >= 22.6 is available.
2. Wiring — asserts every markdown surface (unit pipeline, docs, inline
   field renderers, concept catalog) routes raw HTML through the shared
   sanitizer, that rehypeKatex no longer runs `trust: true`, that Caddy
   sends a CSP, and that shipped-id discovery is CWD-independent and
   fail-loud.

Run: python3 -m unittest discover -s scripts/tests
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent.parent / "site"
SANITIZE_TS = SITE / "src" / "lib" / "sanitize.ts"

DRIVER = r"""
import assert from "node:assert/strict";
import { sanitizeRawHtml, sanitizeHtmlToken, trustedKatexUrl }
  from {SANITIZE_TS_JSON};

// (a) script injection in a body paragraph -> escaped, never executed
assert.equal(
  sanitizeRawHtml("<script>alert(1)</script>"),
  "&lt;script&gt;alert(1)&lt;/script&gt;");

// (b) event-handler injection via img (tag not allowed) -> escaped
assert.equal(
  sanitizeRawHtml('<img src=x onerror=alert(1)>'),
  "&lt;img src=x onerror=alert(1)&gt;");

// handler stripping on an ALLOWED tag
assert.equal(
  sanitizeRawHtml('<aside class="exercise" onclick="evil()">x</aside>'),
  '<aside class="exercise">x</aside>');

// (c) javascript: URLs dropped from href; safe URLs kept
assert.equal(
  sanitizeRawHtml('<a href="javascript:alert(1)">click</a>'),
  "<a>click</a>");
assert.equal(
  sanitizeRawHtml('<a href="https://example.com/p">ok</a>'),
  '<a href="https://example.com/p">ok</a>');
assert.equal(
  sanitizeRawHtml("<a href='/u/01.01.01'>rel</a>"),
  '<a href="/u/01.01.01">rel</a>');

// (d) legitimate exercise scaffolding survives with data-* attributes
assert.equal(
  sanitizeRawHtml('<aside class="exercise" data-type="numeric">'
                   + "<p>Solve it.</p></aside>"),
  '<aside class="exercise" data-type="numeric"><p>Solve it.</p></aside>');

// (e) KaTeX-emitted markup round-trips unchanged (it re-enters the
// sanitizer through pre-rendered math inside raw-HTML item blocks)
const katexChunk = '<span class="katex" aria-hidden="true" '
  + 'style="height:0.8em;"><svg viewBox="0 0 10 10" width="10" height="10" '
  + 'xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10z"/></svg></span>';
assert.equal(sanitizeRawHtml(katexChunk),
  '<span class="katex" aria-hidden="true" style="height:0.8em;">'
  + '<svg viewbox="0 0 10 10" width="10" height="10" '
  + 'xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10z" /></svg></span>');

// self-closing preserved (sibling SVG paths must not nest)
assert.equal(sanitizeRawHtml('<path d="M0 0"/><path d="M1 1"/>'),
  '<path d="M0 0" /><path d="M1 1" />');

// uppercase tags normalized against the allowlist
assert.equal(sanitizeRawHtml("<SCRIPT>x</SCRIPT>"),
  "&lt;SCRIPT&gt;x&lt;/SCRIPT&gt;");

// marked token shape (v15+ passes { text })
assert.equal(sanitizeHtmlToken({ text: "<script>y</script>" }),
  "&lt;script&gt;y&lt;/script&gt;");
assert.equal(sanitizeHtmlToken("<b>z</b>"), "<b>z</b>");

// (f) trust callback: only absolute http(s)/mailto URLs are trusted
assert.equal(trustedKatexUrl({ command: "\\href", url: "javascript:alert(1)" }), false);
assert.equal(trustedKatexUrl({ command: "\\href", url: "https://example.com" }), true);
assert.equal(trustedKatexUrl({ command: "\\url", url: "http://example.com/a" }), true);
assert.equal(trustedKatexUrl({ command: "\\htmlClass", url: undefined }), false);
assert.equal(trustedKatexUrl(undefined), false);

// (g) idempotency: pre-sanitized output is stable under re-sanitization
const once = sanitizeRawHtml(katexChunk + '<details open class="h">'
  + "<summary>Hint</summary></details>");
assert.equal(sanitizeRawHtml(once), once);

console.log(JSON.stringify({ ok: true }));
"""


def _node_with_strip_types() -> str | None:
    node = shutil.which("node")
    if not node:
        return None
    for flags in (["--experimental-strip-types"], []):
        try:
            probe = subprocess.run(
                [node, *flags, "--eval", "0"],
                capture_output=True, text=True, timeout=30)
            if probe.returncode == 0:
                return json.dumps([node, *flags])
        except OSError:
            return None
    return None


class SanitizerBehaviorTest(unittest.TestCase):
    """Runs the real sanitize.ts against the audit's fixture battery."""

    def test_adversarial_fixtures(self):
        runner = _node_with_strip_types()
        if runner is None:
            self.skipTest("node with type stripping unavailable")
        with tempfile.TemporaryDirectory() as td:
            driver = Path(td) / "driver.mjs"
            driver.write_text(
                DRIVER.replace("{SANITIZE_TS_JSON}",
                               json.dumps(str(SANITIZE_TS))),
                encoding="utf-8")
            proc = subprocess.run(
                json.loads(runner) + [str(driver)],
                capture_output=True, text=True, timeout=120)
        self.assertEqual(
            proc.returncode, 0,
            f"sanitizer behavior failed:\n{proc.stdout}\n{proc.stderr}")
        self.assertIn('"ok":true', proc.stdout)


class SanitizerWiringTest(unittest.TestCase):
    """Every raw-HTML surface routes through the shared sanitizer."""

    def test_shared_module_exists(self):
        src = SANITIZE_TS.read_text(encoding="utf-8")
        for name in ("sanitizeRawHtml", "sanitizeHtmlToken",
                     "trustedKatexUrl"):
            self.assertIn(f"export function {name}", src)

    def test_md_docs_uses_shared_sanitizer(self):
        src = (SITE / "src" / "lib" / "md-docs.ts").read_text(encoding="utf-8")
        self.assertIn('from "./sanitize.js"', src)
        self.assertNotIn("ALLOWED_TAGS = new Set", src)

    def test_unit_pipeline_sanitizes_raw_html(self):
        src = (SITE / "src" / "lib" / "marked-codex.ts").read_text(encoding="utf-8")
        self.assertIn('from "./sanitize.js"', src)
        self.assertIn("sanitizeHtmlToken(tokenOrText)", src)
        # Both the shared inline renderer and the main extension object
        # (used by the CLI config AND the SSR layout instance) carry the
        # html override — count must cover both.
        self.assertGreaterEqual(src.count("sanitizeHtmlToken(tokenOrText)"), 2)

    def test_inline_field_renderer_sanitizes(self):
        src = (SITE / "src" / "lib" / "inline-math.ts").read_text(encoding="utf-8")
        self.assertIn('from "./sanitize.js"', src)
        self.assertIn("sanitizeHtmlToken(tokenOrText)", src)

    def test_concepts_catalog_sanitizes(self):
        src = (SITE / "src" / "routes" / "concepts" / "index.tsx").read_text(encoding="utf-8")
        self.assertIn("sanitizeHtmlToken", src)

    def test_rehype_katex_trust_is_not_true(self):
        src = (SITE / "src" / "lib" / "markdown-config.ts").read_text(encoding="utf-8")
        self.assertNotIn("trust: true", src)
        self.assertIn("trustedKatexUrl", src)

    def test_caddyfile_sends_csp(self):
        src = (SITE / "Caddyfile").read_text(encoding="utf-8")
        self.assertIn("Content-Security-Policy", src)
        self.assertIn("default-src 'self'", src)
        self.assertIn("object-src 'none'", src)

    def test_branded_404_page_exists(self):
        page = (SITE / "public" / "404.html").read_text(encoding="utf-8")
        self.assertIn("404", page)
        caddy = (SITE / "Caddyfile").read_text(encoding="utf-8")
        self.assertIn("handle_errors", caddy)

    def test_shipped_ids_fail_loud_and_cwd_independent(self):
        src = (SITE / "src" / "lib" / "shipped-ids.ts").read_text(encoding="utf-8")
        self.assertIn("import.meta.dirname", src)
        self.assertIn("throw new Error", src)
        self.assertNotIn("catch { return; }", src)
        # Callers no longer pass a CWD-relative path
        for caller in ("neutron.config.ts",):
            cfg = (SITE / caller).read_text(encoding="utf-8")
            self.assertIn("collectShippedIds()", cfg)
        layout = (SITE / "src" / "routes" / "_layout.tsx").read_text(encoding="utf-8")
        self.assertIn("collectShippedIds()", layout)


if __name__ == "__main__":
    unittest.main()
