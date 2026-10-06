// Build-time shape validation for manifests/deps.json and
// manifests/connections.json. Malformed-but-parseable JSON must fail the
// build loudly (throw from a loader) instead of silently rendering
// half-defaulted pages.

export interface DepsManifest {
  edges: { from: string; to: string; state?: string }[];
  shipped: string[];
  pending: string[];
  _notes?: Record<string, string>;
  _prefix_sections?: Record<string, string>;
}

export interface ConnectionEntry {
  id: string;
  from: string;
  to: string;
  type: string;
  strength: string;
  anchor_phrase: string;
  synthesis_note?: string;
  appears_in_units?: string[];
}

export interface ConnectionsManifest {
  connections: ConnectionEntry[];
  connection_types: string[];
  strength_levels: string[];
}

function str(x: unknown, what: string): string {
  if (typeof x !== "string" || x.length === 0) {
    throw new Error(`manifests: ${what} must be a non-empty string`);
  }
  return x;
}

export function validateDeps(raw: any): DepsManifest {
  for (const key of ["edges", "shipped", "pending"]) {
    if (!Array.isArray(raw[key])) {
      throw new Error(`manifests/deps.json: \`${key}\` must be an array`);
    }
  }
  const shipped: string[] = raw.shipped.map((id: any) => str(id, "deps.json shipped id"));
  const pending: string[] = raw.pending.map((id: any) => str(id, "deps.json pending id"));
  const overlap = shipped.filter((id) => pending.includes(id));
  if (overlap.length > 0) {
    throw new Error(
      `manifests/deps.json: id(s) in both shipped and pending: ${overlap.join(", ")}`,
    );
  }
  const known = new Set<string>([...shipped, ...pending]);
  const seen = new Set<string>();
  for (const e of raw.edges) {
    const from = str(e?.from, "deps.json edge `from`");
    const to = str(e?.to, "deps.json edge `to`");
    const key = `${from}\u0000${to}`;
    if (seen.has(key)) {
      throw new Error(`manifests/deps.json: duplicate edge ${from} -> ${to}`);
    }
    seen.add(key);
    for (const id of [from, to]) {
      if (!known.has(id)) {
        throw new Error(
          `manifests/deps.json: edge ${from} -> ${to} references ` +
          `unknown unit id "${id}" (not in shipped/pending)`,
        );
      }
    }
  }
  return raw;
}

export function validateConnections(raw: any, deps: DepsManifest): ConnectionsManifest {
  for (const key of ["connections", "connection_types", "strength_levels"]) {
    if (!Array.isArray(raw[key])) {
      throw new Error(`manifests/connections.json: \`${key}\` must be an array`);
    }
  }
  const types = new Set<string>(raw.connection_types);
  const strengths = new Set<string>(raw.strength_levels);
  const knownIds = new Set<string>([...deps.shipped, ...deps.pending]);
  const seenIds = new Set<string>();
  for (const c of raw.connections) {
    const id = str(c?.id, "connections.json `id`");
    if (seenIds.has(id)) {
      throw new Error(`manifests/connections.json: duplicate id ${id}`);
    }
    seenIds.add(id);
    str(c?.from, `connections.json ${id} \`from\``);
    str(c?.to, `connections.json ${id} \`to\``);
    const type = str(c?.type, `connections.json ${id} \`type\``);
    const strength = str(c?.strength, `connections.json ${id} \`strength\``);
    str(c?.anchor_phrase, `connections.json ${id} \`anchor_phrase\``);
    if (!types.has(type)) {
      throw new Error(
        `manifests/connections.json: ${id} has unknown type "${type}"`,
      );
    }
    if (!strengths.has(strength)) {
      throw new Error(
        `manifests/connections.json: ${id} has unknown strength "${strength}"`,
      );
    }
    for (const u of c?.appears_in_units ?? []) {
      if (!knownIds.has(u)) {
        throw new Error(
          `manifests/connections.json: ${id} appears_in_units references ` +
          `unknown unit id "${u}" (not in deps.json shipped/pending)`,
        );
      }
    }
  }
  return raw;
}
