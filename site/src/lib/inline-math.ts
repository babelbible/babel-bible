// Inline-math renderer for short fields (titles, single-paragraph notes).
// Unit titles like "Singular cohomology and de Rham theorem (with $\mathbb{Z}$
// coefficients)" must be run through KaTeX before display so the math shows
// as glyphs instead of literal TeX source.
//
// Safe on plain text — markedKatex is a no-op when no $...$ delimiter pair
// is present. Returns an HTML string suitable for `dangerouslySetInnerHTML`.

import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import { preprocessMath } from "./marked-codex";
import { sanitizeHtmlToken } from "./sanitize.js";

const _md = new Marked({ gfm: true });
_md.use(
  markedKatex({
    throwOnError: false,
    output: "html",
    strict: "ignore",
    nonStandard: true,
  }) as any,
);
// These fields land in `dangerouslySetInnerHTML` (titles, tier anchors,
// citations, Mathlib-gap blocks) — sanitize raw HTML with the shared
// allowlist so a tainted frontmatter value cannot inject markup.
_md.use({
  renderer: {
    html(tokenOrText: any) {
      return sanitizeHtmlToken(tokenOrText);
    },
  },
});

export function renderInline(s: string | undefined | null): string {
  if (!s) return "";
  return (_md.parseInline(preprocessMath(String(s))) as string).trim();
}

// Full markdown pass (paragraphs + display math) for multi-line fields like
// `lean_mathlib_gap` that mix prose with `$$...$$` blocks.
export function renderBlock(s: string | undefined | null): string {
  if (!s) return "";
  return (_md.parse(preprocessMath(String(s))) as string).trim();
}

// Plain-text rendering for contexts that cannot hold HTML — `<title>`, meta
// description, `title=""` attributes. Strips `$...$` delimiters and converts
// the common LaTeX commands to readable unicode so a title such as
// "$\mathbb{Z}_p$-extensions" becomes "Z_p-extensions" rather than leaking
// raw TeX into a browser tab or search snippet.
export function mathToText(s: string | undefined | null): string {
  if (!s) return "";
  let out = String(s);
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_m, body) => texToText(body));
  out = out.replace(/\$([^$\n]+?)\$/g, (_m, body) => texToText(body));
  return out.replace(/\s+/g, " ").trim();
}

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ",
  varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "φ",
  varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const SYMBOLS: [RegExp, string][] = [
  [/\\rightarrow\b/g, "→"], [/\\leftarrow\b/g, "←"], [/\\Rightarrow\b/g, "⇒"],
  [/\\Leftarrow\b/g, "⇐"], [/\\leftrightarrow\b/g, "↔"], [/\\Leftrightarrow\b/g, "⇔"],
  [/\\mapsto\b/g, "↦"], [/\\to\b/g, "→"], [/\\gets\b/g, "←"],
  [/\\in\b/g, "∈"], [/\\notin\b/g, "∉"], [/\\ni\b/g, "∋"],
  [/\\leqslant\b/g, "≤"], [/\\geqslant\b/g, "≥"], [/\\leq?\b/g, "≤"], [/\\geq?\b/g, "≥"],
  [/\\neq\b/g, "≠"], [/\\equiv\b/g, "≡"], [/\\approx\b/g, "≈"], [/\\sim\b/g, "∼"],
  [/\\simeq\b/g, "≃"], [/\\cong\b/g, "≅"], [/\\propto\b/g, "∝"], [/\\ll\b/g, "≪"],
  [/\\gg\b/g, "≫"], [/\\subset\b/g, "⊂"], [/\\subseteq\b/g, "⊆"], [/\\supset\b/g, "⊃"],
  [/\\supseteq\b/g, "⊇"], [/\\cap\b/g, "∩"], [/\\cup\b/g, "∪"], [/\\sqcap\b/g, "⊓"],
  [/\\sqcup\b/g, "⊔"], [/\\emptyset\b/g, "∅"], [/\\varnothing\b/g, "∅"], [/\\infty\b/g, "∞"],
  [/\\partial\b/g, "∂"], [/\\nabla\b/g, "∇"], [/\\sum\b/g, "Σ"], [/\\prod\b/g, "∏"],
  [/\\int\b/g, "∫"], [/\\oint\b/g, "∮"], [/\\iint\b/g, "∬"], [/\\iiint\b/g, "∭"],
  [/\\forall\b/g, "∀"], [/\\exists\b/g, "∃"], [/\\nexists\b/g, "∄"], [/\\neg\b|\\lnot\b/g, "¬"],
  [/\\land\b/g, "∧"], [/\\lor\b/g, "∨"], [/\\implies\b/g, "⇒"], [/\\impliedby\b/g, "⇐"],
  [/\\iff\b/g, "⇔"], [/\\therefore\b/g, "∴"], [/\\because\b/g, "∵"],
  [/\\times\b/g, "×"], [/\\div\b/g, "÷"], [/\\cdot\b/g, "·"], [/\\cdots\b/g, "⋯"],
  [/\\ldots\b|\\dots\b/g, "…"], [/\\vdots\b/g, "⋮"], [/\\ddots\b/g, "⋱"],
  [/\\pm\b/g, "±"], [/\\mp\b/g, "∓"], [/\\angle\b/g, "∠"], [/\\perp\b/g, "⊥"],
  [/\\parallel\b/g, "∥"], [/\\circ\b/g, "∘"], [/\\bullet\b/g, "•"], [/\\star\b/g, "⋆"],
  [/\\dagger\b|\\dag\b/g, "†"], [/\\ddagger\b|\\ddag\b/g, "‡"],
  [/\\langle\b/g, "⟨"], [/\\rangle\b/g, "⟩"], [/\\lvert\b|\\rvert\b|\\vert\b/g, "|"],
  [/\\lVert\b|\\rVert\b|\\Vert\b/g, "‖"], [/\\aleph\b/g, "ℵ"], [/\\hbar\b/g, "ℏ"],
  [/\\ell\b/g, "ℓ"], [/\\Re\b/g, "ℜ"], [/\\Im\b/g, "ℑ"], [/\\wp\b/g, "℘"],
  [/\\angle\b/g, "∠"], [/\\measuredangle\b/g, "∡"], [/\\square\b|\\Box\b/g, "□"],
  [/\\blacksquare\b|\\qquad|\\QED\b/g, "■"],
  [/\\quad\b|\\qquad\b/g, " "], [/\\[,:;!]/g, " "],
  [/\\(s|i|d|t|nt|thinspace|medspace|thickspace|negthinspace|negmedspace|negthickspace)\b/g, " "],
];

function texToText(tex: string): string {
  let t = tex;
  // Font wrappers / text — unwrap to inner content (loop for light nesting).
  for (let i = 0; i < 6; i++) {
    const next = t.replace(
      /\\(mathbb|mathcal|mathrm|mathscr|mathfrak|mathbf|mathsf|mathit|bm|boldsymbol|text|textrm|textit|textbf|operatorname|operatorname\*|mathrm|Bbb|bb)\{([^{}]*)\}/g,
      "$2",
    );
    if (next === t) break;
    t = next;
  }
  // Compound constructs with two braced args.
  t = t.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
  t = t.replace(/\\dfrac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
  t = t.replace(/\\tfrac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
  t = t.replace(/\\binom\{([^{}]*)\}\{([^{}]*)\}/g, "C($1,$2)");
  // Roots and accents with a single brace group.
  t = t.replace(/\\sqrt\{([^{}]*)\}/g, "√($1)");
  t = t.replace(/\\overline\{([^{}]*)\}/g, "$1\u0304");
  t = t.replace(/\\underline\{([^{}]*)\}/g, "$1\u0332");
  t = t.replace(/\\bar\{([^{}]*)\}/g, "$1\u0304");
  t = t.replace(/\\tilde\{([^{}]*)\}/g, "$1\u0303");
  t = t.replace(/\\hat\{([^{}]*)\}/g, "$1\u0302");
  t = t.replace(/\\vec\{([^{}]*)\}/g, "$1\u20D7");
  t = t.replace(/\\dot\{([^{}]*)\}/g, "$1\u0307");
  t = t.replace(/\\ddot\{([^{}]*)\}/g, "$1\u0308");
  t = t.replace(/\\widehat\{([^{}]*)\}/g, "$1\u0302");
  t = t.replace(/\\widetilde\{([^{}]*)\}/g, "$1\u0303");
  // \sqrt with a following single token.
  t = t.replace(/\\sqrt\s+([A-Za-z0-9])/g, "√$1");
  // Greek letters.
  t = t.replace(/\\(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|omicron|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Omicron|Pi|Sigma|Upsilon|Phi|Psi|Omega)\b/g,
    (_m, name) => GREEK[name] ?? name);
  // Named symbols / relations.
  for (const [re, rep] of SYMBOLS) t = t.replace(re, rep);
  // Accents on a following single non-brace token (e.g. \bar\psi after greek pass).
  t = t.replace(/\\bar\s*([^\s\\{}])/g, "$1\u0304");
  t = t.replace(/\\vec\s*([^\s\\{}])/g, "$1\u20D7");
  t = t.replace(/\\tilde\s*([^\s\\{}])/g, "$1\u0303");
  t = t.replace(/\\hat\s*([^\s\\{}])/g, "$1\u0302");
  t = t.replace(/\\dot\s*([^\s\\{}])/g, "$1\u0307");
  // Escaped literal characters.
  t = t.replace(/\\([{}])/g, "$1");
  t = t.replace(/\\([%$#&_])/g, "$1");
  t = t.replace(/\\,/g, " ").replace(/\\;/g, " ").replace(/\\:/g, " ");
  // Prime / degree.
  t = t.replace(/\\prime\b/g, "′").replace(/\\degree\b/g, "°");
  // Any remaining \word command — drop the backslash, keep the name.
  t = t.replace(/\\([A-Za-z]+)\*?/g, "$1");
  // Strip stray backslashes and leftover braces.
  t = t.replace(/\\/g, "").replace(/[{}]/g, "");
  return t.replace(/\s+/g, " ").trim();
}
