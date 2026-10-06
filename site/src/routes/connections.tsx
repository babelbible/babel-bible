import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateConnections, validateDeps } from "../lib/manifest-schema";

export function head() {
  return {
    title: "Connections | Babel Bible",
    description: "Cross-unit synthesis registry. Every load-bearing or synthesis cross-reference between units, typed and tagged.",
  };
}

interface Connection {
  id: string;
  from: string;
  to: string;
  type: string;
  strength: string;
  anchor_phrase: string;
  synthesis_note?: string;
  appears_in_units?: string[];
}

const PATH = resolve(import.meta.dirname, "../../../manifests/connections.json");

export async function loader() {
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(PATH, "utf-8"));
  } catch (e) {
    // Build-fatal: a missing or malformed manifest must never silently
    // render an empty connections page. An explicitly-valid empty
    // manifest still renders zero entries fine.
    throw new Error(
      `connections: cannot read manifest at ${PATH}: ${(e as Error).message}`,
    );
  }
  const depsPath = resolve(import.meta.dirname, "../../../manifests/deps.json");
  let deps: any;
  try {
    deps = JSON.parse(readFileSync(depsPath, "utf-8"));
  } catch (e) {
    throw new Error(
      `connections: cannot read dependency manifest at ${depsPath}: ${(e as Error).message}`,
    );
  }
  validateDeps(deps);
  validateConnections(raw, deps);
  const connections: Connection[] = raw.connections || [];
  const types: string[] = raw.connection_types || [];
  const strengths: string[] = raw.strength_levels || [];
  const typeCounts: Record<string, number> = {};
  const strengthCounts: Record<string, number> = {};
  for (const c of connections) {
    typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
    strengthCounts[c.strength] = (strengthCounts[c.strength] || 0) + 1;
  }
  return { connections, typeCounts, strengthCounts, types, strengths };
}

const FILTER_INIT = `
(function () {
  function getFilters() {
    const p = new URLSearchParams(location.search);
    return { type: p.get('type') || '', strength: p.get('strength') || '', q: (p.get('q') || '').toLowerCase() };
  }
  function setFilter(k, v) {
    const p = new URLSearchParams(location.search);
    if (v) p.set(k, v); else p.delete(k);
    history.replaceState(null, '', '?' + p.toString());
    apply();
  }
  function apply() {
    var f = getFilters();
    document.querySelectorAll('[data-conn-filter]').forEach(function (sel) {
      sel.value = f[sel.getAttribute('data-conn-filter')] || '';
    });
    var visible = 0;
    document.querySelectorAll('[data-conn-row]').forEach(function (row) {
      var t = row.dataset.type || '';
      var s = row.dataset.strength || '';
      var search = (row.dataset.search || '').toLowerCase();
      var ok = (!f.type || t === f.type)
        && (!f.strength || s === f.strength)
        && (!f.q || search.indexOf(f.q) !== -1);
      row.style.display = ok ? '' : 'none';
      if (ok) visible++;
    });
    var counter = document.getElementById('conn-count');
    if (counter) counter.textContent = visible + ' shown';
  }
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var k = t.getAttribute('data-conn-filter');
    if (k) setFilter(k, t.value);
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-conn-filter') === 'q') setFilter('q', t.value);
  });
  apply();
})();
`;

export default function ConnectionsPage({ data }: { data: any }) {
  return (
    <article>
      <section class="page-narrow" style="padding-top: 0;">
        <h1>Connections</h1>
        <p class="lede">
          Every cross-unit synthesis claim is registered here with a stable ID. Connections type a
          relationship (dual / equivalence / foundation-of / bridging-theorem / generalisation /
          specialisation / analogy / limit / recurrence) and rate its strength (load-bearing or
          synthesis).
        </p>
        <div class="stats-row" style="margin-top: 1rem;">
          <div class="stat-card">
            <div class="stat-number">{data.connections.length}</div>
            <div class="stat-label">total</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">{data.strengthCounts["load-bearing"] || 0}</div>
            <div class="stat-label">load-bearing</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">{data.strengthCounts.synthesis || 0}</div>
            <div class="stat-label">synthesis</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">{data.types.length}</div>
            <div class="stat-label">types</div>
          </div>
        </div>
      </section>

      <section class="page-narrow">
        <div class="filter-row">
          <label>
            type{" "}
            <select data-conn-filter="type">
              <option value="">all</option>
              {data.types.map((t: string) => (
                <option value={t}>{t} ({data.typeCounts[t] || 0})</option>
              ))}
            </select>
          </label>
          <label>
            strength{" "}
            <select data-conn-filter="strength">
              <option value="">all</option>
              {data.strengths.map((s: string) => (
                <option value={s}>{s} ({data.strengthCounts[s] || 0})</option>
              ))}
            </select>
          </label>
          <label class="filter-search">
            search{" "}
            <input type="search" data-conn-filter="q" placeholder="anchor phrase, concept id…" />
          </label>
          <span class="muted" id="conn-count">{data.connections.length} shown</span>
        </div>
      </section>

      <section class="page-narrow">
        <ul class="conn-list">
          {data.connections.map((c: Connection) => (
            <li
              data-conn-row
              data-type={c.type}
              data-strength={c.strength}
              data-search={`${c.id} ${c.from} ${c.to} ${c.anchor_phrase} ${c.synthesis_note || ""}`}
            >
              <div class="conn-anchor">{c.anchor_phrase}</div>
              <div class="conn-meta">
                <span class={`conn-pill conn-pill--type-${c.type}`}>{c.type}</span>
                <span class={`conn-pill conn-pill--str-${c.strength.replace(/[^a-z]/g, "")}`}>{c.strength}</span>
                <code>{c.from}</code> &rarr; <code>{c.to}</code>
              </div>
              {c.synthesis_note && <div class="conn-note muted">{c.synthesis_note}</div>}
              {c.appears_in_units && c.appears_in_units.length > 0 && (
                <div class="conn-units muted">
                  appears in:{" "}
                  {c.appears_in_units.map((id: string, i: number) => (
                    <>
                      {i > 0 && ", "}
                      <a href={`/u/${id}`}><code>{id}</code></a>
                    </>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <script dangerouslySetInnerHTML={{ __html: FILTER_INIT }} />
    </article>
  );
}
