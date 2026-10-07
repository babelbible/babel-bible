#!/usr/bin/env python3
"""Validate units in `content/` against the rubric in docs/specs/QUALITY_RUBRIC.md.

Walks the content tree, runs `validate_unit.py` in-process so repo-wide
indexes are reused, aggregates results, and exits non-zero if any unit fails.

Usage:
    python validate_all.py [--root <codex-root>]
    python validate_all.py --path content/14-genchem-pchem --path content/22-language
    python validate_all.py --content-only   # skip Lean elaboration (no lake needed)

Exit code:
    0 — every unit passes every automated check
    1 — at least one unit fails OR an exception was raised

A lake toolchain on PATH is REQUIRED in normal (shipping) mode: without it
the Lean elaboration gate cannot run and validation fails. Use
`--content-only` for content work on machines without a toolchain; that mode
never prints "Ready to ship."
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

LEAN_PLACEHOLDER_RE = re.compile(r"\b(sorry|admit|sorryAx)\b")

# The standard Lean foundational axioms are always admitted in
# `#print axioms` output. Anything else (notably `sorryAx` and project
# `axiom` declarations) fails the full gate unless explicitly listed in
# lean/AXIOM_ALLOWLIST.txt.
FOUNDATIONAL_AXIOMS = {"propext", "Classical.choice", "Quot.sound"}

AXIOM_DEP_RE = re.compile(r"^'([^']+)'\s+depends on axioms:\s*\[([^\]]*)\]",
                          re.MULTILINE)
AXIOM_NONE_RE = re.compile(r"^'([^']+)'\s+does not depend on any axioms",
                           re.MULTILINE)

_NAMESPACE_RE = re.compile(r"^namespace\s+([A-Za-z_][\w.]*)")
_END_RE = re.compile(r"^end(?:\s+([A-Za-z_][\w.]*))?")
# `section [Name]` (incl. `noncomputable section`) and `mutual` open
# anonymous scopes: a bare `end` closes them without touching the
# enclosing namespace.
_ANON_SCOPE_RE = re.compile(r"^(?:noncomputable\s+)?section"
                            r"(?:\s+[A-Za-z_][\w'!?]*)?$|^mutual$")
# Declaration modifiers may appear in any order/repetition before the
# keyword; attributes must close on the same line (otherwise the scan
# fails closed as unsupported syntax).
_DECL_MODIFIER = r"(?:@\[[^\]\n]*\]\s*|(?:private|protected|noncomputable|unsafe|partial)\s+)*"
_THEOREM_RE = re.compile(
    _DECL_MODIFIER + r"(?:theorem|lemma)\s+([A-Za-z_][\w'!?]*)")
_AXIOM_DECL_RE = re.compile(
    _DECL_MODIFIER + r"axiom\s+([A-Za-z_][\w'!?]*)")
_DECL_KEYWORD_RE = re.compile(r"\b(?:theorem|lemma|axiom)\b")


class LeanScanError(Exception):
    """The module source uses declaration syntax the scanner cannot
    classify. The full gate fails closed on this: an unrecognised
    theorem/lemma/axiom form must never be silently skipped."""


def _strip_lean_comments(text: str) -> str:
    """Remove `--` line comments and nesting-aware `/- ... -/` block
    comments. String literals are passed through untouched so comment
    markers inside them cannot swallow real code (and code inside them
    cannot hide declarations). Newlines inside block comments are kept
    so the result stays line-aligned with the original source."""
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        pair = text[i:i + 2]
        if pair == "--":
            j = text.find("\n", i)
            i = n if j == -1 else j  # keep the newline itself
        elif pair == "/-":
            start = i
            depth = 1
            i += 2
            while i < n and depth > 0:
                if text.startswith("/-", i):
                    depth += 1
                    i += 2
                elif text.startswith("-/", i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            # keep newlines so the result stays line-aligned with the
            # original source
            out.append("\n" * text[start:i].count("\n"))
        elif ch == '"':
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                elif text[j] == '"' or text[j] == "\n":
                    break
                else:
                    j += 1
            j = min(j, n - 1)
            out.append(text[i:j + 1])
            i = j + 1
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _blank_string_contents(text: str) -> str:
    """Replace string-literal contents with nothing, keeping the closing
    delimiter, so declaration keywords in prose strings (e.g. `"the
    theorem is named after Gauss"`) cannot trip the fail-closed
    "unsupported declaration syntax" path. Uses the same string model as
    `_strip_lean_comments` (no newline inside a literal; backslash
    escapes), which was verified not to desync on legal Lean. Line
    structure is preserved, so this is safe to run on comment-stripped
    or raw source alike."""
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == '"':
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                elif text[j] == '"' or text[j] == "\n":
                    break
                else:
                    j += 1
            j = min(j, n - 1)
            out.append(text[j])
            i = j + 1
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def load_axiom_allowlist(repo_root: Path) -> set[str]:
    """Foundational Lean axioms plus any names listed in
    lean/AXIOM_ALLOWLIST.txt (one per line, `#` comments)."""
    allowed = set(FOUNDATIONAL_AXIOMS)
    path = repo_root / "lean" / "AXIOM_ALLOWLIST.txt"
    if path.exists():
        for ln in path.read_text(encoding="utf-8").splitlines():
            name = ln.split("#", 1)[0].strip()
            if name:
                allowed.add(name)
    return allowed


def _scan_decls(source: str) -> tuple[list[str], list[str]]:
    """Single-pass namespace-aware classification of a (comment-stripped)
    module source. Returns (fully-qualified theorem/lemma names, axiom
    declaration names). Raises LeanScanError on declaration syntax it
    cannot classify — the caller fails closed rather than silently
    skipping a potentially tainted declaration.

    Tracks `namespace X.Y` / `end` nesting so probed names resolve.
    Each `namespace`, `section`, and `mutual` command opens exactly one
    scope; each `end` line (bare or named) closes exactly one scope —
    the segment count of `end A.B` is deliberately ignored, because one
    `namespace A.B` command pushed one frame. Sections/mutuals are
    anonymous markers that never qualify a declaration name.
    Private theorem/lemma declarations are skipped deliberately: they
    are invisible to an importing `#print axioms` probe (their own
    `sorry` usage is caught by the placeholder scan, and transitive
    taint surfaces through public callers). Axioms are recorded even
    when private.
    """
    theorems: list[str] = []
    axioms: list[str] = []
    stack: list[str | None] = []
    source = _blank_string_contents(source)
    for raw in source.splitlines():
        line = raw.strip()
        m = _NAMESPACE_RE.match(line)
        if m and line == m.group(0):
            stack.append(m.group(1))
            continue
        if _ANON_SCOPE_RE.match(line):
            stack.append(None)
            continue
        m = _END_RE.match(line)
        if m and line == m.group(0):
            if stack:
                stack.pop()
            continue
        if line.startswith("@[") and "]" not in line:
            raise LeanScanError(
                f"multiline attribute block not supported: {raw!r}")
        m = _THEOREM_RE.match(line)
        if m:
            mods = line[:m.start(1)]
            if not re.search(r"\bprivate\s", mods):
                prefix = ".".join(s for s in stack if s)
                theorems.append(
                    f"{prefix}.{m.group(1)}" if prefix else m.group(1))
            continue
        m = _AXIOM_DECL_RE.match(line)
        if m:
            prefix = ".".join(s for s in stack if s)
            axioms.append(f"{prefix}.{m.group(1)}" if prefix
                          else m.group(1))
            continue
        if _DECL_KEYWORD_RE.search(line):
            raise LeanScanError(
                f"unsupported declaration syntax: {raw!r}")
    return theorems, axioms


def scan_full_module_decls(source: str) -> tuple[list[str], list[str]]:
    return _scan_decls(source)


def parse_axioms_output(text: str) -> dict[str, list[str]]:
    """Parse `#print axioms` output into {name: [axioms]}."""
    out: dict[str, list[str]] = {}
    for m in AXIOM_NONE_RE.finditer(text):
        out[m.group(1)] = []
    for m in AXIOM_DEP_RE.finditer(text):
        out[m.group(1)] = [a.strip() for a in m.group(2).split(",")
                           if a.strip()]
    return out


def run_axiom_probe(repo_root: Path, module: str,
                    names: list[str]) -> dict[str, list[str]] | str:
    """Elaborate a `#print axioms` probe for `names` against `module`.

    Returns the parsed {name: [axioms]} map, or an error string.
    """
    with tempfile.TemporaryDirectory(prefix="axiom-probe-") as td:
        probe = Path(td) / "Probe.lean"
        probe.write_text(
            f"import {module}\n"
            + "".join(f"#print axioms {n}\n" for n in names),
            encoding="utf-8")
        proc = subprocess.run(["lake", "env", "lean", str(probe)],
                              cwd=repo_root / "lean",
                              capture_output=True, text=True)
    output = proc.stdout + "\n" + proc.stderr
    if proc.returncode != 0:
        err = next((ln.strip() for ln in output.splitlines()
                    if ln.strip().startswith("error")), "")
        return (f"axiom probe failed for module {module} "
                f"(exit {proc.returncode}): {err}")
    return parse_axioms_output(output)


def check_lean_contract(repo_root: Path,
                        lean_units: list[tuple[str, dict]]) -> list[str]:
    """Enforce the real `lean_status` contract at the aggregate level.

    Per-unit `validate_unit.py` checks are existence-only by design; this
    stage, scoped to the units selected for this run:

    - runs one `lake build` over `lean/` — `Codex.lean` imports every
      module (enforced by `check_codex_imports`), so a successful build
      puts every `full`/`partial` module in the aggregate build closure;
    - for `lean_status: full` units, additionally scans the module source
      for proof placeholders (`sorry` / `admit` / `sorryAx`) and custom
      `axiom` declarations, and probes every public theorem/lemma in the
      module (plus the frontmatter-designated `lean_theorem` headline)
      with `#print axioms`: `sorryAx` and any axiom outside the
      foundational allowlist (propext, Classical.choice, Quot.sound, plus
      lean/AXIOM_ALLOWLIST.txt) fails. The headline is never a whitelist:
      a clean designated theorem cannot shield a tainted sibling. This
      catches sorry and custom axioms entering transitively through
      imported theorems; `partial` units need only be in the closure.

    When no lake toolchain is on PATH this is FATAL in normal (shipping)
    mode: "Ready to ship." must never be printed without the Lean gate
    having actually run. `--content-only` skips this stage entirely.
    """
    problems: list[str] = []
    if shutil.which("lake") is None:
        problems.append(
            "no lake toolchain on PATH — Lean elaboration NOT checked "
            "(fatal: shipping validation requires a lake toolchain; "
            "re-run with --content-only to skip Lean deliberately)"
        )
        return problems

    print("Running `lake build` in lean/ (aggregate Lean gate) …")
    proc = subprocess.run(["lake", "build"], cwd=repo_root / "lean",
                          capture_output=True, text=True)
    if proc.returncode != 0:
        problems.append(f"lake build failed (exit {proc.returncode}); first errors:")
        lines = (proc.stdout + "\n" + proc.stderr).splitlines()
        err_lines = [ln for ln in lines if ln.strip().startswith("error")][:10]
        for ln in (err_lines or [ln for ln in lines if ln.strip()][-5:]):
            problems.append(f"  {ln.strip()}")
        return problems

    full_scanned = 0
    allowlist = load_axiom_allowlist(repo_root)
    for rel, fm in lean_units:
        if fm.get("lean_status") != "full":
            continue
        module = str(fm.get("lean_module", "")).strip()
        if not module:
            continue  # already a per-unit failure
        path = repo_root / "lean" / (module.replace(".", "/") + ".lean")
        if not path.exists():
            continue  # already a per-unit failure
        full_scanned += 1
        stripped = _strip_lean_comments(path.read_text(encoding="utf-8"))

        # 1. Direct proof placeholders in the module source.
        hits = sorted(set(LEAN_PLACEHOLDER_RE.findall(stripped)))
        if hits:
            problems.append(
                f"{rel}: lean_status: full but module {module} contains "
                f"proof placeholder(s): {', '.join(hits)}")

        # 2. Scan declarations. Fail closed on unsupported syntax.
        try:
            named, axiom_decls = _scan_decls(stripped)
        except LeanScanError as exc:
            problems.append(
                f"{rel}: lean_status: full but module {module} uses "
                f"{exc}")
            continue

        # 3. Custom `axiom` declarations in the module itself (unless
        #    explicitly allowlisted).
        bad_decls = [a for a in axiom_decls if a not in allowlist]
        if bad_decls:
            problems.append(
                f"{rel}: lean_status: full but module {module} declares "
                f"axiom(s): {', '.join(bad_decls)}")

        # 4. Axiom-dependency probe: catches `sorryAx` and custom/
        #    non-allowlisted axioms entering transitively through
        #    imported theorems. Every public theorem/lemma in the module
        #    is probed; the frontmatter `lean_theorem` is a designated
        #    headline added to the probe set, never a whitelist — a
        #    clean headline must not be able to shield a tainted sibling
        #    declaration.
        explicit = str(fm.get("lean_theorem", "")).strip()
        probe_names = sorted(set(named) | ({explicit} if explicit else set()))
        if not probe_names:
            problems.append(
                f"{rel}: lean_status: full but module {module} declares no "
                f"named theorem/lemma and no lean_theorem is recorded — "
                f"axiom dependencies cannot be verified")
            continue
        probed = run_axiom_probe(repo_root, module, probe_names)
        if isinstance(probed, str):
            problems.append(f"{rel}: {probed}")
            continue
        for name in probe_names:
            if name not in probed:
                problems.append(
                    f"{rel}: could not resolve #print axioms for {name} "
                    f"in module {module} (unknown identifier?)")
                continue
            bad = sorted(set(probed[name]) - allowlist)
            if bad:
                flavor = (" (sorryAx — proof placeholder)"
                          if "sorryAx" in bad else "")
                problems.append(
                    f"{rel}: {module}: {name} depends on non-allowlisted "
                    f"axiom(s): {', '.join(bad)}{flavor}")
    print(f"lake build OK; {full_scanned} full module(s) scanned for "
          f"placeholders and axiom dependencies.")
    return problems


def check_duplicate_unit_ids(repo_root: Path) -> list[str]:
    """Unit ids must be globally unique across all content roots: the site
    generates /u/:id routes from every id, so a duplicate is a routing
    collision. `_scan_statuses` in validate_unit.py deliberately folds to
    id -> status-set, so multiplicity is only visible here."""
    from validate_unit import parse_unit
    ids: dict[str, list[str]] = {}
    for root in [repo_root / "content", repo_root / "site" / "src" / "content"]:
        if not root.exists():
            continue
        for p in sorted(root.rglob("*.md")):
            try:
                fm, _ = parse_unit(p)
            except Exception:
                continue
            uid = str(fm.get("id", "")).strip()
            if uid:
                ids.setdefault(uid, []).append(str(p.relative_to(repo_root)))
    return [
        f"unit id {uid} used by multiple files: {', '.join(paths)}"
        for uid, paths in sorted(ids.items()) if len(paths) > 1
    ]


def check_deps_partition(repo_root: Path) -> list[str]:
    """manifests/deps.json invariant: shipped and pending are a partition of
    the graph's unit lifecycle — a unit that has shipped must not still be
    listed as pending (and vice versa). Regenerate with
    `python3 scripts/integrate_unit.py --regenerate` to repair."""
    deps_path = repo_root / "manifests" / "deps.json"
    if not deps_path.exists():
        return []
    try:
        deps = json.loads(deps_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        return [f"deps.json unreadable: {exc}"]
    both = sorted(set(deps.get("shipped", [])) & set(deps.get("pending", [])))
    if not both:
        return []
    return [
        f"deps.json: {len(both)} id(s) listed in both shipped and pending: "
        f"{', '.join(both)}"
    ]


def find_repo_root(start: Path) -> Path:
    cur = start.resolve()
    for ancestor in [cur, *cur.parents]:
        if (ancestor / "OVERVIEW.md").exists():
            return ancestor
    raise SystemExit(f"Could not locate codex/ root from {start}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=Path.cwd(),
                    help="codex repo root (auto-detected if omitted)")
    ap.add_argument("--path", action="append", type=Path,
                    help="content subtree or unit file to validate; repeatable")
    ap.add_argument("--content-only", action="store_true",
                    help="skip Lean elaboration entirely (no lake needed); "
                         "success never prints 'Ready to ship.'")
    args = ap.parse_args()

    repo_root = find_repo_root(args.root)
    sys.path.insert(0, str(repo_root / "scripts"))
    from validate_unit import parse_unit, validate
    from check_codex_imports import find_divergence

    if args.path:
        units: list[Path] = []
        for requested in args.path:
            path = requested if requested.is_absolute() else repo_root / requested
            if path.is_file():
                units.append(path)
            elif path.is_dir():
                units.extend(sorted(path.rglob("*.md")))
            else:
                raise SystemExit(f"Path not found: {requested}")
        units = sorted(set(units))
    else:
        content_root = repo_root / "content"
        if not content_root.exists():
            print(f"No content/ directory at {content_root}; nothing to validate.")
            sys.exit(0)
        units = sorted(content_root.rglob("*.md"))
    if not units:
        print("No units found.")
        sys.exit(0)

    print(f"Validating {len(units)} units against docs/specs/QUALITY_RUBRIC.md …")
    print()

    failures: list[tuple[Path, str]] = []
    lean_units: list[tuple[str, dict]] = []
    grand_total_passed = 0
    grand_total_checks = 0

    for unit_path in units:
        rel = unit_path.relative_to(repo_root)
        try:
            report = validate(unit_path)
            if report.frontmatter.get("lean_status") in ("full", "partial"):
                lean_units.append((str(rel), report.frontmatter))
            passed = sum(1 for check in report.checks if check.passed)
            total = len(report.checks)
            grand_total_passed += passed
            grand_total_checks += total
        except Exception as exc:
            passed = 0
            total = 0
            print(f"  ✗ {rel}  ({passed}/{total})")
            print(f"        exception: {exc}")
            failures.append((unit_path, str(exc)))
            continue

        if report.all_passed:
            print(f"  ✓ {rel}  ({passed}/{total})")
        else:
            print(f"  ✗ {rel}  ({passed}/{total})")
            for check in [c for c in report.checks if not c.passed][:6]:
                print(f"        [✗] {check.name}")
                if check.detail:
                    print(f"            {check.detail.splitlines()[0]}")
            failures.append((unit_path, ""))

    # ------------------------------------------------------------------
    # Repo-level gates (beyond per-unit checks)
    # ------------------------------------------------------------------
    aggregate_failures: list[str] = []

    # Gate: Codex.lean must import every module under lean/Codex/, so a
    # module can never silently escape the aggregate `lake build`.
    codex_problems = find_divergence(repo_root)
    if codex_problems:
        print()
        print(f"Codex.lean import check FAILED ({len(codex_problems)} problem(s)):")
        for p in codex_problems:
            print(f"  - {p}")
        aggregate_failures.extend(codex_problems)

    # Gate: the real lean_status contract (aggregate `lake build` +
    # placeholder scan for `full` modules; see check_lean_contract).
    # Skipped entirely in --content-only mode.
    if lean_units and not args.content_only:
        lean_problems = check_lean_contract(repo_root, lean_units)
        if lean_problems:
            print()
            print(f"Lean elaboration check FAILED ({len(lean_problems)} problem(s)):")
            for p in lean_problems:
                print(f"  - {p}")
            aggregate_failures.extend(lean_problems)

    # Gate: unit ids must be globally unique (the site routes /u/:id).
    dup_problems = check_duplicate_unit_ids(repo_root)
    if dup_problems:
        print()
        print(f"Duplicate unit-id check FAILED ({len(dup_problems)} id(s)):")
        for p in dup_problems:
            print(f"  - {p}")
        aggregate_failures.extend(dup_problems)

    # Gate: deps.json shipped/pending lists must be disjoint.
    partition_problems = check_deps_partition(repo_root)
    if partition_problems:
        print()
        print("deps.json shipped/pending partition check FAILED:")
        for p in partition_problems:
            print(f"  - {p}")
        aggregate_failures.extend(partition_problems)

    print()
    print(f"Overall: {grand_total_passed}/{grand_total_checks} checks passed across {len(units)} units")
    if failures or aggregate_failures:
        if failures:
            print(f"  {len(failures)} unit(s) failed:")
            for path, _ in failures:
                print(f"    - {path.relative_to(repo_root)}")
        if aggregate_failures:
            print(f"  {len(aggregate_failures)} repo-level check(s) failed (details above).")
        print()
        print("Re-run `validate_unit.py <path>` against any failing unit for full detail.")
        sys.exit(1)

    if args.content_only:
        print("Content validation passed (content-only; Lean NOT checked).")
        sys.exit(0)

    print("All units pass automated rubric. Ready to ship.")
    sys.exit(0)


if __name__ == "__main__":
    main()
