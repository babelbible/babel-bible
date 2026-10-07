"""L5/L6: fatal missing lake + --content-only; axiom-aware full gate.

Run: python3 scripts/tests/test_validate_all.py
"""

from __future__ import annotations

import os
import shutil
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import fixtures  # noqa: E402
import validate_all  # noqa: E402

CONTENT_ONLY_MSG = "Content validation passed (content-only; Lean NOT checked)."

FULL_FM = {"lean_status": "full", "lean_module": "Codex.Test.TestMod"}


class LakeAbsentIsFatalTest(unittest.TestCase):
    def test_check_lean_contract_fatal_without_lake(self):
        root = fixtures.build_mini_repo()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        with mock.patch("shutil.which", return_value=None):
            problems = validate_all.check_lean_contract(
                root, [("content/00-test/01-ch/00.01.01-test-concept.md",
                        {"lean_status": "partial",
                         "lean_module": "Codex.Test.TestMod"})])
        self.assertEqual(len(problems), 1)
        self.assertIn("no lake toolchain on PATH", problems[0])
        self.assertIn("fatal", problems[0])


class EndToEndExitCodesTest(unittest.TestCase):
    def setUp(self):
        self.root = fixtures.build_mini_repo()
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

    def test_normal_mode_fails_without_lake(self):
        proc = fixtures.run_validate_all(self.root, path="/usr/bin:/bin")
        self.assertNotEqual(proc.returncode, 0)
        if shutil.which("lake") is None:
            self.assertIn("no lake toolchain on PATH",
                          proc.stdout + proc.stderr)
            self.assertNotIn("Ready to ship.", proc.stdout)

    def test_content_only_passes_with_distinct_message(self):
        proc = fixtures.run_validate_all(self.root, "--content-only",
                                         path="/usr/bin:/bin")
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn(CONTENT_ONLY_MSG, proc.stdout)
        self.assertNotIn("Ready to ship.", proc.stdout)


class ParseAxiomsOutputTest(unittest.TestCase):
    def test_recorded_samples(self):
        # Real `#print axioms` output formats.
        text = (
            "'Codex.Foo.bar' depends on axioms: [propext, Classical.choice, Quot.sound]\n"
            "'Codex.Foo.baz' does not depend on any axioms\n"
            "'Codex.Foo.qux' depends on axioms: [propext, Classical.choice, Quot.sound, sorryAx]\n"
        )
        self.assertEqual(
            validate_all.parse_axioms_output(text),
            {
                "Codex.Foo.bar": ["propext", "Classical.choice", "Quot.sound"],
                "Codex.Foo.baz": [],
                "Codex.Foo.qux": ["propext", "Classical.choice",
                                   "Quot.sound", "sorryAx"],
            },
        )


class ScanFullModuleDeclsTest(unittest.TestCase):
    def test_namespace_tracking(self):
        src = "\n".join([
            "namespace Codex.Test",
            "private theorem hidden : True := trivial",
            "theorem key_result : True := trivial",
            "lemma aux' : True := trivial",
            "end Codex.Test",
            "example : True := trivial",
        ])
        theorems, axioms = validate_all.scan_full_module_decls(src)
        # private declarations are invisible to an importing probe
        self.assertEqual(theorems, ["Codex.Test.key_result",
                                    "Codex.Test.aux'"])
        self.assertEqual(axioms, [])

    def test_axiom_decls_detected(self):
        src = "\n".join([
            "namespace Codex.Test",
            "axiom bogus : False",
            "theorem primary : False := bogus",
            "end Codex.Test",
        ])
        theorems, axioms = validate_all.scan_full_module_decls(src)
        self.assertEqual(theorems, ["Codex.Test.primary"])
        self.assertEqual(axioms, ["Codex.Test.bogus"])

    def test_example_only_module_has_no_named_theorems(self):
        src = "example : True := trivial\n"
        theorems, axioms = validate_all.scan_full_module_decls(src)
        self.assertEqual((theorems, axioms), ([], []))

    def test_modifier_permutations(self):
        src = "\n".join([
            "namespace Codex.Test",
            "@[simp] theorem tagged : True := trivial",
            "protected noncomputable theorem mixed : True := trivial",
            "private axiom hidden_axiom : False",
            "end Codex.Test",
        ])
        theorems, axioms = validate_all.scan_full_module_decls(src)
        self.assertEqual(theorems, ["Codex.Test.tagged",
                                    "Codex.Test.mixed"])
        self.assertEqual(axioms, ["Codex.Test.hidden_axiom"])

    def test_nested_namespace_end_pops_one_frame(self):
        # C-02: `end Codex.Outer.Inner` closes ONE scope (the one the
        # single `namespace Codex.Outer.Inner` command opened), not one
        # per dotted segment — otherwise t2 loses its qualifier.
        src = "\n".join([
            "namespace Codex.Outer",
            "namespace Codex.Outer.Inner",
            "theorem t1 : True := trivial",
            "end Codex.Outer.Inner",
            "theorem t2 : True := trivial",
            "end Codex.Outer",
        ])
        theorems, _ = validate_all.scan_full_module_decls(src)
        self.assertEqual(theorems,
                         ["Codex.Outer.Codex.Outer.Inner.t1",
                          "Codex.Outer.t2"])

    def test_section_end_does_not_pop_namespace(self):
        # C-02: a bare `end` closing a `section` must not pop the
        # enclosing namespace frame.
        src = "\n".join([
            "namespace Codex.N",
            "section",
            "theorem s1 : True := trivial",
            "end",
            "theorem s2 : True := trivial",
            "end Codex.N",
        ])
        theorems, _ = validate_all.scan_full_module_decls(src)
        self.assertEqual(theorems, ["Codex.N.s1", "Codex.N.s2"])

    def test_mutual_end_does_not_pop_namespace(self):
        # C-02: same guard for `mutual … end`.
        src = "\n".join([
            "namespace Codex.M",
            "mutual",
            "theorem s1 : True := trivial",
            "end",
            "theorem s2 : True := trivial",
            "end Codex.M",
        ])
        theorems, _ = validate_all.scan_full_module_decls(src)
        self.assertEqual(theorems, ["Codex.M.s1", "Codex.M.s2"])

    def test_dotted_end_single_namespace_empties_stack(self):
        # Sequential `namespace X.Y … end X.Y` (the only real-corpus
        # shape) still empties the stack: decls after it are bare.
        src = ("namespace A.B\n"
               "theorem t : True := trivial\n"
               "end A.B\n"
               "theorem u : True := trivial\n")
        theorems, _ = validate_all.scan_full_module_decls(src)
        self.assertEqual(theorems, ["A.B.t", "u"])

    def test_named_section(self):
        src = "\n".join([
            "namespace Codex.S",
            "section Named",
            "theorem s1 : True := trivial",
            "end Named",
            "theorem s2 : True := trivial",
            "end Codex.S",
        ])
        theorems, _ = validate_all.scan_full_module_decls(src)
        self.assertEqual(theorems, ["Codex.S.s1", "Codex.S.s2"])


class StripLeanCommentsTest(unittest.TestCase):
    def test_nested_block_comments(self):
        # `theorem hidden` lives only inside a NESTED comment; a
        # non-nested approximation ends the outer comment at the first
        # `-/` and would then see the rest as real code (or vice versa).
        src = ("/- outer /- nested theorem hidden : False := by sorry -/ -/\n"
               "theorem real : True := trivial\n")
        stripped = validate_all._strip_lean_comments(src)
        theorems, axioms = validate_all.scan_full_module_decls(stripped)
        self.assertEqual(theorems, ["real"])
        self.assertNotIn("sorry", stripped)

    def test_comment_markers_inside_strings_are_not_comments(self):
        src = ('theorem s : True := trivial\n'
               'theorem str : String := "a/-b--c"\n'
               'theorem after : True := trivial\n')
        stripped = validate_all._strip_lean_comments(src)
        theorems, _ = validate_all.scan_full_module_decls(stripped)
        self.assertEqual(theorems, ["s", "str", "after"])

    def test_line_comments_stripped(self):
        src = ("theorem real : True := trivial\n"
               "-- theorem fake : False := by sorry\n")
        stripped = validate_all._strip_lean_comments(src)
        theorems, _ = validate_all.scan_full_module_decls(stripped)
        self.assertEqual(theorems, ["real"])
        self.assertNotIn("sorry", stripped)

    def test_line_alignment_preserved(self):
        src = ("/- multi\nline\ncomment -/\ntheorem real : True := trivial\n")
        stripped = validate_all._strip_lean_comments(src)
        self.assertEqual(stripped.splitlines()[3].strip(),
                         "theorem real : True := trivial")


class FailClosedScanTest(unittest.TestCase):
    """Unsupported declaration syntax must raise, never silently skip."""

    def test_unclassified_theorem_line_raises(self):
        # `set_option ... in theorem foo` on one line: the declaration
        # does not start the line, so the scanner cannot classify it.
        with self.assertRaises(validate_all.LeanScanError):
            validate_all.scan_full_module_decls(
                "set_option maxHeartbeats 1000000 in "
                "theorem hard : True := trivial\n")

    def test_set_option_in_on_own_line_still_captures(self):
        theorems, _ = validate_all.scan_full_module_decls(
            "set_option maxHeartbeats 1000000 in\n"
            "theorem hard : True := trivial\n")
        self.assertEqual(theorems, ["hard"])

    def test_unterminated_attribute_block_raises(self):
        with self.assertRaises(validate_all.LeanScanError):
            validate_all.scan_full_module_decls(
                "@[simp\ntheorem tagged : True := trivial\n")

    def test_string_literal_prose_does_not_raise(self):
        # C-03: decl keywords inside string literals are prose, not
        # declarations — the scan must not fail closed on them.
        theorems, axioms = validate_all.scan_full_module_decls(
            'def desc : String := "the theorem is named after Gauss"\n'
            'theorem real_one : True := trivial\n')
        self.assertEqual((theorems, axioms), (["real_one"], []))

    def test_string_with_comment_marker_then_real_comment(self):
        # C-03 regression guard: blanking string contents must not
        # disturb the comment-stripping order — a `/-` inside a string
        # stays inert, and a real `--` comment afterwards is stripped.
        src = ('def s : String := "pre /- post"\n'
               '-- theorem commented_out : False := by sorry\n'
               'theorem after : True := trivial\n')
        stripped = validate_all._strip_lean_comments(src)
        theorems, _ = validate_all.scan_full_module_decls(stripped)
        self.assertEqual(theorems, ["after"])

    def test_string_blanking_keeps_same_line_decls(self):
        # A string on a line with real code: the trailing declaration on
        # a LATER line is unaffected (strings cannot span newlines).
        src = ('def a : String := "lemma inside"\n'
               'lemma real : True := trivial\n')
        theorems, _ = validate_all.scan_full_module_decls(src)
        self.assertEqual(theorems, ["real"])

    def test_plain_modules_still_scan(self):
        theorems, axioms = validate_all.scan_full_module_decls(
            "namespace N\ntheorem a : True := trivial\nlemma b : True := "
            "trivial\nend N\n")
        self.assertEqual(theorems, ["N.a", "N.b"])
        self.assertEqual(axioms, [])

    def test_full_gate_reports_unsupported_syntax(self):
        root = fixtures.build_mini_repo()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        (root / "lean" / "Codex" / "Test" / "TestMod.lean").write_text(
            "set_option maxHeartbeats 1000000 in theorem key_result : "
            "True := trivial\n", encoding="utf-8")
        bin_dir = root / "stubbin"
        fixtures.write_stub_toolchain(bin_dir, {})
        env = {**os.environ,
               "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}"}
        with mock.patch.dict(os.environ, env):
            problems = validate_all.check_lean_contract(
                root, [("content/00-test/01-ch/00.01.01-test-concept.md",
                        dict(FULL_FM))])
        self.assertTrue(any("unsupported declaration syntax" in p
                            for p in problems), problems)


class AxiomGateTest(unittest.TestCase):
    """End-to-end gate tests against the stub lake/lean toolchain."""

    def setUp(self):
        self.root = fixtures.build_mini_repo()
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.module_path = self.root / "lean" / "Codex" / "Test" / "TestMod.lean"

    def _run(self, axioms_by_name, fm=None):
        bin_dir = self.root / "stubbin"
        fixtures.write_stub_toolchain(bin_dir, axioms_by_name)
        env = {**os.environ,
               "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}"}
        with mock.patch.dict(os.environ, env):
            return validate_all.check_lean_contract(
                self.root, [("content/00-test/01-ch/00.01.01-test-concept.md",
                             fm or dict(FULL_FM))])

    def test_foundational_axioms_pass(self):
        problems = self._run({})
        self.assertEqual(problems, [])

    def test_custom_axiom_in_module_fails(self):
        self.module_path.write_text(
            "namespace Codex.Test\n"
            "axiom bogus : False\n"
            "theorem key_result : False := bogus\n"
            "end Codex.Test\n", encoding="utf-8")
        problems = self._run({"Codex.Test.key_result": ["bogus"]})
        self.assertTrue(any("declares axiom(s): Codex.Test.bogus" in p
                            for p in problems), problems)
        self.assertTrue(any("non-allowlisted" in p and "bogus" in p
                            for p in problems), problems)

    def test_project_allowlist_admits_custom_axiom(self):
        self.module_path.write_text(
            "namespace Codex.Test\n"
            "axiom bogus : False\n"
            "theorem key_result : False := bogus\n"
            "end Codex.Test\n", encoding="utf-8")
        (self.root / "lean" / "AXIOM_ALLOWLIST.txt").write_text(
            "Codex.Test.bogus  # admitted for the test\n", encoding="utf-8")
        problems = self._run({"Codex.Test.key_result": ["Codex.Test.bogus"]})
        self.assertEqual(problems, [])

    def test_transitive_sorry_fails(self):
        # key_result invokes an imported (partial-unit) theorem proved
        # with sorry: the probe reports sorryAx in its axiom dependencies.
        problems = self._run({"Codex.Test.key_result":
                              ["propext", "sorryAx"]})
        self.assertTrue(any("sorryAx" in p for p in problems), problems)

    def test_no_named_theorem_fails_closed(self):
        self.module_path.write_text(
            "namespace Codex.Test\n"
            "example : True := trivial\n"
            "end Codex.Test\n", encoding="utf-8")
        problems = self._run({})
        self.assertTrue(any("no named theorem/lemma" in p and
                            "lean_theorem" in p for p in problems), problems)

    def test_lean_theorem_does_not_shield_tainted_sibling(self):
        # The designated headline is clean; a sibling theorem in the same
        # module transitively depends on sorryAx. The probe set must be
        # ALL public declarations plus the headline — never the headline
        # alone — or a clean headline could hide a tainted sibling.
        self.module_path.write_text(
            "namespace Codex.Test\n"
            "theorem key_result : True := trivial\n"
            "theorem other : True := trivial\n"
            "end Codex.Test\n", encoding="utf-8")
        fm = dict(FULL_FM, lean_theorem="Codex.Test.other")
        problems = self._run({"Codex.Test.key_result":
                              ["propext", "sorryAx"]}, fm=fm)
        self.assertTrue(any("sorryAx" in p for p in problems), problems)


if __name__ == "__main__":
    unittest.main()
