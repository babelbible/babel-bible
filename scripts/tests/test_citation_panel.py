"""Citation-panel source registry guard.

site/public/js/citation-panel.js is the single canonical implementation
(the TypeScript copy was removed as dead, drifted code; the layout loads
only the public JS). These checks keep it honest:

- every slug registered in SOURCE_META has non-empty metadata (a malformed
  entry would render "undefined" in the panel);
- the layout still loads the panel (a fix applied to a nonexistent copy
  would otherwise pass silently).

Run: python3 -m unittest discover -s scripts/tests
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent.parent / "site"
PANEL = SITE / "public" / "js" / "citation-panel.js"
LAYOUT = SITE / "src" / "routes" / "_layout.tsx"


def _extract_source_meta(text: str) -> dict[str, str]:
    start = text.index("SOURCE_META")
    start = text.index("{", start)
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                body = text[start:i + 1]
                break
    else:
        raise AssertionError("SOURCE_META object not terminated")
    entries: dict[str, str] = {}
    for m in re.finditer(r'"?([A-Za-z][\w-]*)"?\s*:\s*\{([^{}]*)\}', body):
        entries[m.group(1)] = m.group(2)
    return entries


class CitationPanelTest(unittest.TestCase):
    def test_registered_slugs_have_metadata(self):
        entries = _extract_source_meta(PANEL.read_text(encoding="utf-8"))
        self.assertTrue(entries, "no SOURCE_META entries found")
        for slug, body in sorted(entries.items()):
            m = re.search(r"name:\s*\"((?:[^\"\\]|\\.)*)\"", body)
            self.assertTrue(
                m and m.group(1).strip(),
                f"SOURCE_META[{slug!r}] lacks a non-empty name",
            )

    def test_panel_is_single_canonical_copy(self):
        self.assertFalse(
            (SITE / "src" / "lib" / "citation-panel.ts").exists(),
            "drifted TS duplicate exists; public JS is canonical",
        )

    def test_layout_loads_panel(self):
        layout = LAYOUT.read_text(encoding="utf-8")
        self.assertIn("/js/citation-panel.js", layout)


if __name__ == "__main__":
    unittest.main()
