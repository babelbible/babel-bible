// Layout shell. Static-site config; tier toggle and theme toggle are plain
// HTML + inline scripts so we don't fight SSR over tiny pieces of state.

import "../styles/global.css";
import { setActiveMarkdownConfig } from "@neutron-build/core";
import { codexMarkdownConfig, setShippedUnitIds } from "../lib/markdown-config.js";
import { collectShippedIds } from "../lib/shipped-ids.js";

// Set the markdown config at SSR module-load time. Required because the SSR
// worker runs in a separate process from the CLI's `neutron.config.ts`
// evaluation; the module-level `activeMarkdownConfig` in @neutron-build/core
// isn't shared across processes. Idempotent.
setActiveMarkdownConfig(codexMarkdownConfig);

// Same data as neutron.config.ts (shared helper) — re-run here so the SSR
// worker has the shipped-unit-id set used by the [NN.NN.NN] cross-ref
// renderer. The root is resolved from the module location, so this works
// regardless of the worker's CWD, and fails loudly if content/ is missing.
setShippedUnitIds(collectShippedIds());

export const config = { hydrate: false };

export function head() {
  return {
    openGraph: {
      type: "website",
      title: "Babel Bible — a self-study curriculum across the sciences and humanities",
      description: "A multi-domain curriculum across the sciences and humanities — mathematics, physics, chemistry, biology, computing, philosophy, language, history, and more. Every concept at three depths in one source.",
    },
    twitter: {
      card: "summary_large_image" as const,
      title: "Babel Bible — a self-study curriculum across the sciences and humanities",
      description: "Three-tier curriculum from foundations to graduate-level mastery, across the sciences and humanities.",
    },
    headScripts: [
      {
        // Inject favicon, theme-color, and KaTeX CSS link/meta tags.
        // SeoMetaInput doesn't surface arbitrary <link> nodes so we add
        // them via a tiny inline script that runs synchronously in <head>.
        // KaTeX CSS is loaded as a direct <link> rather than only through
        // the @import in global.css to avoid bundler/CSP brittleness.
        content: `(function(){
          var d=document;var h=d.head||d.getElementsByTagName('head')[0];
          function add(t,a){var n=d.createElement(t);for(var k in a)n.setAttribute(k,a[k]);h.appendChild(n);}
          add('link',{rel:'stylesheet',href:'/katex/katex.min.css'});
          add('link',{rel:'icon',type:'image/svg+xml',href:'/favicon.svg'});
          add('link',{rel:'apple-touch-icon',href:'/favicon.svg'});
          add('meta',{name:'theme-color',content:'#0c0d10'});
        })();`,
      },
      {
        // Pre-paint: read tier + theme from localStorage and apply to <html>
        // so users don't see a flash of wrong theme/tier.
        content: `(function(){
          try {
            var th = localStorage.getItem('codex_theme');
            document.documentElement.dataset.theme =
              (th==='dark'||th==='calm'||th==='light') ? th : 'dark';
          } catch (e) {
            document.documentElement.dataset.theme = 'dark';
          }
        })();`,
      },
    ],
  } as any;
}

const TOGGLE_INIT = `
(function () {
  function syncActive(group, value) {
    document.querySelectorAll('[data-' + group + '-set]').forEach(function (b) {
      b.classList.toggle(group + '-toggle__btn--active',
        b.getAttribute('data-' + group + '-set') === value);
    });
  }
  function setTheme(v) {
    document.documentElement.dataset.theme = v;
    try { localStorage.setItem('codex_theme', v); } catch (e) {}
    syncActive('theme', v);
  }
  document.addEventListener('click', function (e) {
    var th = e.target && e.target.closest && e.target.closest('[data-theme-set]');
    if (th) { setTheme(th.getAttribute('data-theme-set')); return; }
  });
  // Sync initial active classes from doc-element flags set pre-paint.
  syncActive('theme', document.documentElement.dataset.theme || 'dark');
})();
`;

export default function RootLayout({ children }: { children: any }) {
  return (
    <>
      <header class="site-header">
        <div class="container">
          <a href="/" class="brand">Babel Bible</a>
          <nav>
            <a href="/math">Math</a>
            <a href="/physics">Physics</a>
            <a href="/chemistry">Chemistry</a>
            <a href="/biology">Biology</a>
            <a href="/philosophy">Philosophy</a>
            <a href="/language">Language</a>
            <a href="/world">World</a>
          </nav>
          <div class="header-controls">
            <div class="theme-toggle" role="group" aria-label="Theme">
              <button type="button" class="theme-toggle__btn" data-theme-set="dark" title="Dark">D</button>
              <button type="button" class="theme-toggle__btn" data-theme-set="calm" title="Calm (sepia)">C</button>
              <button type="button" class="theme-toggle__btn" data-theme-set="light" title="Light">L</button>
            </div>
          </div>
        </div>
      </header>
      <main id="main-content" class="container">
        {children}
      </main>
      <footer class="site-footer">
        <div class="container">
          <div class="footer-grid">
            <div>
              <p class="footer-brand">Babel Bible</p>
              <p class="muted">A self-study curriculum across the sciences and humanities. Three tiers, one source.</p>
              <div class="footer-credits">
                <div class="footer-credit">
                  <span class="footer-credit__label">Built with</span>
                  <a class="footer-credit__name" href="https://neutron.build" target="_blank" rel="noopener noreferrer">Neutron</a>
                </div>
                <div class="footer-credit">
                  <span class="footer-credit__label">Deployed on</span>
                  <a class="footer-credit__name" href="https://teploy.com" target="_blank" rel="noopener noreferrer">Teploy</a>
                </div>
              </div>
            </div>
            <div>
              <p class="footer-heading">Browse</p>
              <a href="/units">Units</a>
              <a href="/concepts">Concepts</a>
              <a href="/dag">Dependency map</a>
            </div>
            <div>
              <p class="footer-heading">Reference</p>
              <a href="/connections">Connections</a>
              <a href="/lean">Lean status</a>
            </div>
            <div>
              <p class="footer-heading">Site</p>
              <a href="/about">About</a>
            </div>
          </div>
        </div>
      </footer>
      <script dangerouslySetInnerHTML={{ __html: TOGGLE_INIT }} />
      {/* Citation footnote panel — initialises on DOMContentLoaded. */}
      <script src="/js/citation-panel.js" defer></script>
      <script dangerouslySetInnerHTML={{ __html: `document.addEventListener('error',function(e){if(e.target.tagName==='IMG')e.target.style.display='none'},true)` }} />
      {/* Math is now server-rendered by marked-katex-extension; no client KaTeX needed.
          KaTeX CSS is loaded via @import in src/styles/global.css. */}
    </>
  );
}
