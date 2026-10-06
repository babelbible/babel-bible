import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCollection } from "@neutron-build/core";
import { sectionLabel, sectionOrder } from "../lib/sections";
import { validateDeps } from "../lib/manifest-schema";

export function head() {
  return {
    title: "Dependency map | Babel Bible",
    description: "Curriculum prerequisite graph. Apex-first; pending units fill in over time.",
  };
}

interface Edge { from: string; to: string; state: string }

// id -> section key, built from canonical unit frontmatter. Unit-id
// prefixes are NOT section orders (29.04.05 is psychology, not section 29
// in SectionInfo.order), so the mapping must come from each unit's own
// `section` frontmatter. Ids with no content (pending forward-refs) fall
// back to the generated `_prefix_sections` majority-vote prefix map in
// deps.json (see scripts/integrate_unit.py --regenerate).
function buildSectionKeyForId(
  idSection: Map<string, string>,
  prefixSections: Record<string, string>,
): (id: string) => string {
  return (id: string) =>
    idSection.get(id)
    ?? prefixSections[id.split(".")[0]]
    ?? "unsectioned";
}

export async function loader() {
  const depsPath = resolve(import.meta.dirname, "../../../manifests/deps.json");
  let deps: any;
  try {
    deps = JSON.parse(readFileSync(depsPath, "utf-8"));
  } catch (e) {
    // Build-fatal: a missing or malformed manifest must never silently
    // render an empty dependency map. An explicitly-valid empty manifest
    // ({ edges: [], shipped: [], pending: [] }) still renders fine.
    throw new Error(
      `dag: cannot read dependency manifest at ${depsPath}: ${(e as Error).message}`,
    );
  }
  validateDeps(deps);

  const edges: Edge[] = deps.edges || [];
  const shipped: string[] = deps.shipped || [];
  const pending: string[] = deps.pending || [];
  const notes: Record<string, string> = deps._notes || {};
  const prefixSections: Record<string, string> = deps._prefix_sections || {};

  const idSection = new Map<string, string>();
  for (const unit of (await getCollection("units")) as any[]) {
    const id: string | undefined = unit?.data?.id;
    const section: string | undefined = unit?.data?.section;
    if (id && section && !idSection.has(id)) idSection.set(id, section);
  }
  const sectionKeyForId = buildSectionKeyForId(idSection, prefixSections);

  // Section adjacency counts: from-section -> to-section -> count.
  const sectionsUsed = new Set<string>();
  shipped.forEach((id) => sectionsUsed.add(sectionKeyForId(id)));
  pending.forEach((id) => sectionsUsed.add(sectionKeyForId(id)));

  const sectionOrder_ = (k: string) => sectionOrder(k);
  const sectionList = Array.from(sectionsUsed).sort((a, b) => sectionOrder_(a) - sectionOrder_(b));

  const matrix: Record<string, Record<string, number>> = {};
  for (const k of sectionList) {
    matrix[k] = {};
    for (const j of sectionList) matrix[k][j] = 0;
  }
  for (const e of edges) {
    const from = sectionKeyForId(e.from);
    const to = sectionKeyForId(e.to);
    if (matrix[from] && matrix[from][to] !== undefined) {
      matrix[from][to]++;
    }
  }

  // Find max count for color scale.
  let maxCount = 0;
  for (const k of sectionList) for (const j of sectionList) {
    if (k === j) continue;
    if (matrix[k][j] > maxCount) maxCount = matrix[k][j];
  }

  return {
    edgeCount: edges.length,
    shipped, pending, notes,
    sectionList,
    matrix,
    maxCount,
  };
}

export default function DagPage({ data }: { data: any }) {
  const sections: string[] = data.sectionList;
  const matrix = data.matrix as Record<string, Record<string, number>>;
  const max = data.maxCount || 1;

  return (
    <article>
      <section class="page-narrow" style="padding-top: 0;">
        <h1>Dependency map</h1>
        <p class="lede">
          Curriculum prerequisite graph from <code>manifests/deps.json</code>.{" "}
          <strong>{data.edgeCount}</strong> edges across {data.shipped.length} shipped and{" "}
          {data.pending.length} pending units.
        </p>
      </section>

      <section class="page-narrow">
        <h2>Section adjacency</h2>
        <p class="muted">
          How many prerequisite edges flow from one section to another. Rows are the prereq
          (<em>from</em>); columns are the dependent (<em>to</em>). Diagonal cells (intra-section)
          and off-diagonal cells (cross-section) are coloured by edge density.
        </p>
        <div class="dag-matrix-wrap">
          <table class="dag-matrix">
            <thead>
              <tr>
                <th class="dag-matrix__corner"></th>
                {sections.map((s) => (
                  <th class="dag-matrix__col-head" title={sectionLabel(s)}>
                    <span class="dag-matrix__rot">{sectionLabel(s)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map((row) => (
                <tr>
                  <th class="dag-matrix__row-head">{sectionLabel(row)}</th>
                  {sections.map((col) => {
                    const v = matrix[row]?.[col] || 0;
                    const intensity = v === 0 ? 0 : Math.min(1, v / max);
                    const bg = `color-mix(in srgb, var(--accent) ${Math.round(intensity * 70)}%, transparent)`;
                    return (
                      <td
                        class="dag-matrix__cell"
                        style={`background:${bg}`}
                        title={`${sectionLabel(row)} → ${sectionLabel(col)}: ${v} edges`}
                      >
                        {v > 0 ? v : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section class="page-narrow">
        <h2>Shipped units ({data.shipped.length})</h2>
        {data.shipped.length === 0 ? (
          <p class="muted">None yet.</p>
        ) : (
          <ul class="dag-id-list">
            {data.shipped.map((id: string) => (
              <li>
                <a href={`/u/${id}`}><code>{id}</code></a>
                {data.notes[id] && <span class="muted"> — {data.notes[id]}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.pending.length > 0 && (
        <section class="page-narrow">
          <h2>Pending units ({data.pending.length})</h2>
          <p class="muted">
            Declared as a prerequisite or successor by a shipped unit but not yet produced.
          </p>
          <ul class="dag-id-list">
            {data.pending.map((id: string) => (
              <li>
                <code>{id}</code>
                {data.notes[id] && <span class="muted"> — {data.notes[id]}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
