// Citation footnote panel — runs on every page that loads the layout.
// Vanilla JS, zero deps, no Neutron-island fragility.
//
// CANONICAL IMPLEMENTATION: this file is the single source of truth for
// citation-panel behavior and the SOURCE_META registry (there is no
// TypeScript twin). scripts/tests/test_citation_panel.py guards its
// metadata and the layout wiring.

(function () {
  const SOURCE_META = {
    tong: {
      name: "David Tong — DAMTP Lecture Notes (Cambridge)",
      archive_path: "reference/tong/",
      license: "Author-hosted, educational use; attribution required.",
      attribution: "Tong, D. — DAMTP Cambridge lecture notes (damtp.cam.ac.uk/user/tong/)",
    },
    "quantum-well": {
      name: "The Quantum Well (Boris)",
      archive_path: "reference/quantum-well/md/",
      license: "Creative Commons BY 4.0",
      attribution: 'Boris — "The Quantum Well", CC BY 4.0',
    },
    milekic: {
      name: "Nikola Milekic — Digital Garden",
      archive_path: "reference/milekic/md/",
      license: "Personal site; reference use only.",
    },
    "fast-track": {
      name: "The Fast Track (sheafification.com)",
      archive_path: "reference/fast-track/",
      license: "Personal site; reference use only.",
    },
    goodtheorist: {
      name: "Gerard 't Hooft — How to Become a Good Theoretical Physicist",
      archive_path: "reference/goodtheorist/",
    },
    rigetti: {
      name: "Susan Rigetti — Physics Self-Study Guide",
      archive_path: "reference/rigetti/",
    },
    "quantum-country": {
      name: "Quantum Country (Matuschak & Nielsen)",
      archive_path: "reference/quantum-country/",
    },
    diegovera: {
      name: "Diego Vera — Self-Study Essays",
      archive_path: "reference/diegovera/",
    },
    jimmyqin: {
      name: "Jimmy Qin — Study Notes",
      archive_path: "reference/jimmyqin/",
    },
    TODO_REF: {
      name: "Citation pending",
      license:
        "This citation refers to a primary source that will be wired in as the source is acquired and added to the archive. The locator is preserved so the reference is intelligible to readers familiar with the field.",
    },
    apostol: {
      name: "Tom M. Apostol — Calculus (Vol 1, single-variable; Vol 2, multi-variable + linear algebra)",
      attribution: "Apostol, T. — Calculus, Wiley, 1967, 1969.",
    },
    hartshorne: {
      name: "Robin Hartshorne — Algebraic Geometry",
      attribution: "Hartshorne, R. — Algebraic Geometry, Springer GTM 52, 1977.",
    },
    hatcher: {
      name: "Allen Hatcher — Algebraic Topology",
      attribution: "Hatcher, A. — Algebraic Topology, Cambridge University Press, 2002.",
      archive_path: "reference/textbooks/hatcher-algebraic-topology/",
    },
    "lawson-michelsohn": {
      name: "H. Blaine Lawson Jr. & Marie-Louise Michelsohn — Spin Geometry",
      attribution: "Lawson & Michelsohn — Spin Geometry, Princeton, 1989.",
    },
    "bott-tu": {
      name: "Raoul Bott & Loring Tu — Differential Forms in Algebraic Topology",
      attribution: "Bott, R. & Tu, L. — Differential Forms in Algebraic Topology, Springer GTM 82, 1982.",
    },
    cannas: {
      name: "Ana Cannas da Silva — Lectures on Symplectic Geometry",
      attribution: "Cannas da Silva, A. — Lectures on Symplectic Geometry, Springer LNM 1764, 2008.",
    },
    donaldson: {
      name: "Simon Donaldson — Riemann Surfaces",
      attribution: "Donaldson, S. — Riemann Surfaces, Oxford GTM 22, 2011.",
    },
    forster: {
      name: "Otto Forster — Lectures on Riemann Surfaces",
      attribution: "Forster, O. — Lectures on Riemann Surfaces, Springer GTM 81, 1981.",
    },
    ahlfors: {
      name: "Lars V. Ahlfors — Complex Analysis",
      attribution: "Ahlfors, L. — Complex Analysis, McGraw-Hill, 3rd edition 1979.",
    },
    lang: {
      name: "Serge Lang — Basic Mathematics / Algebra / Complex Analysis (multi-volume)",
      attribution: "Lang, S. — Basic Mathematics (1971), Algebra (1965/2002), etc.",
    },
    arnold: {
      name: "Vladimir Arnold — Mathematical Methods of Classical Mechanics / Ordinary Differential Equations",
      attribution: "Arnold, V. — Mathematical Methods of Classical Mechanics, Springer GTM 60, 1989 (2nd ed.).",
    },
    brown: {
      name: "Ronald Brown — Topology and Groupoids",
      attribution: "Brown, R. — Topology and Groupoids, BookSurge, 2006.",
    },
    "griffiths-harris": {
      name: "Phillip Griffiths & Joseph Harris — Principles of Algebraic Geometry",
      attribution: "Griffiths, P. & Harris, J. — Principles of Algebraic Geometry, Wiley, 1978.",
    },
    weinberg: {
      name: "Steven Weinberg — The Quantum Theory of Fields (Vols 1-3)",
      attribution: "Weinberg, S. — The Quantum Theory of Fields, Cambridge, 1995-2000.",
    },
    "landau-lifshitz": {
      name: "L. D. Landau & E. M. Lifshitz — Course of Theoretical Physics (Vols 1-10)",
      attribution: "Landau, L. & Lifshitz, E. — Course of Theoretical Physics, Pergamon, 1960s-80s.",
    },
    milnor: {
      name: "John Milnor — various (Topology, Morse Theory, Characteristic Classes)",
      attribution: "Milnor, J. — primary references including Morse Theory (Princeton, 1963), Topology from the Differentiable Viewpoint (Virginia, 1965), Characteristic Classes (with Stasheff, Princeton, 1974).",
    },
    spivak: {
      name: "Michael Spivak — Calculus on Manifolds / Comprehensive Introduction to Differential Geometry",
      attribution: "Spivak, M. — Calculus on Manifolds (1965), A Comprehensive Introduction to Differential Geometry (5 vols, 3rd ed., 1999).",
    },
    rudin: {
      name: "Walter Rudin — Principles of Mathematical Analysis / Real and Complex Analysis / Functional Analysis",
      attribution: "Rudin, W. — three classic texts published by McGraw-Hill, 1953-1991.",
    },
    axler: {
      name: "Sheldon Axler — Linear Algebra Done Right",
      attribution: "Axler, S. — Linear Algebra Done Right, Springer UTM, 3rd ed. 2015.",
    },
    riemann: {
      name: "Bernhard Riemann — Collected Works (Theorie der Abelschen Functionen 1857, etc.)",
      attribution: "Riemann, B. — Theorie der Abelschen Functionen, J. reine angew. Math. 54, 1857; Collected Mathematical Works, Springer 1990.",
    },
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Resolved source: `data-ref-source` is a registered key in SOURCE_META.
  function renderRefBody(source, locator) {
    const meta = SOURCE_META[source];
    if (!meta) {
      // Unregistered key — show what we have as a plain citation.
      return (
        '<p class="cite-panel__source-name">' + escapeHtml(source) + "</p>" +
        (locator ? '<p class="cite-panel__locator">' + escapeHtml(locator) + "</p>" : "")
      );
    }
    const out = [];
    out.push('<p class="cite-panel__source-name">' + escapeHtml(meta.name) + "</p>");
    if (locator)
      out.push('<p class="cite-panel__locator"><strong>Locator:</strong> ' + escapeHtml(locator) + "</p>");
    if (meta.license)
      out.push('<p class="cite-panel__license"><strong>License:</strong> ' + escapeHtml(meta.license) + "</p>");
    if (meta.attribution)
      out.push('<p class="cite-panel__attribution"><strong>Cite as:</strong> ' + escapeHtml(meta.attribution) + "</p>");
    return out.join("\n");
  }

  // Free-form / pending citation: `data-ref-cite` is the reader-facing text.
  function renderCiteBody(cite, isPending) {
    const out = ['<p class="cite-panel__source-name">' + escapeHtml(cite) + "</p>"];
    if (isPending)
      out.push('<p class="cite-panel__pending">Primary source — the full bibliographic reference is being verified.</p>');
    return out.join("\n");
  }

  function renderUnitBody(unitId, isPending) {
    if (isPending) {
      return (
        '<p class="cite-panel__source-name">Cross-reference: <code>' + escapeHtml(unitId) + "</code></p>" +
        '<p class="cite-panel__pending">This unit is not yet published. The id is reserved and will link once it ships.</p>'
      );
    }
    return (
      '<p class="cite-panel__source-name">Cross-reference: <code>' + escapeHtml(unitId) + "</code></p>" +
      '<p><a class="btn btn--primary" href="/u/' + escapeHtml(unitId) + '">Open unit →</a></p>'
    );
  }

  function init() {
    if (document.getElementById("cite-panel")) return; // idempotent
    const wrapper = document.createElement("div");
    wrapper.innerHTML =
      '<div class="cite-panel" id="cite-panel" role="dialog" aria-modal="false" aria-hidden="true">' +
        '<div class="cite-panel__inner">' +
          '<header class="cite-panel__header">' +
            '<h2 class="cite-panel__title">Citation</h2>' +
            '<button class="cite-panel__close" type="button" aria-label="Close citation">×</button>' +
          '</header>' +
          '<div class="cite-panel__body" id="cite-panel-body"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrapper.firstElementChild);

    const panel = document.getElementById("cite-panel");
    const body = document.getElementById("cite-panel-body");
    const titleEl = panel.querySelector(".cite-panel__title");
    const closeBtn = panel.querySelector(".cite-panel__close");

    function open(titleText, html) {
      titleEl.textContent = titleText;
      body.innerHTML = html;
      panel.setAttribute("aria-hidden", "false");
      document.body.classList.add("cite-panel--open");
    }
    function close() {
      panel.setAttribute("aria-hidden", "true");
      document.body.classList.remove("cite-panel--open");
    }

    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
    panel.addEventListener("click", function (e) {
      if (e.target === panel) close();
    });

    document.addEventListener("click", function (e) {
      const target = e.target;
      if (!target || !target.closest) return;
      const refEl = target.closest(".ref");
      if (refEl) {
        e.preventDefault();
        const d = refEl.dataset;
        if (d.refSource) {
          open("Source", renderRefBody(d.refSource, d.refLocator || ""));
        } else {
          open("Source", renderCiteBody(d.refCite || "", !!d.refPending));
        }
        return;
      }
      const unitEl = target.closest(".unit-ref");
      if (unitEl) {
        const isPending = unitEl.classList.contains("unit-ref--pending");
        if (!isPending) return; // let the real link work
        e.preventDefault();
        const code = unitEl.querySelector("code");
        const unitId = (code && code.textContent ? code.textContent : "?").trim();
        open("Cross-reference", renderUnitBody(unitId, true));
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
