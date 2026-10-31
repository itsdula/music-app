/** The assembled token registry: global tier then every component set. */
import { GLOBAL_DEFS } from './global';
import { isColorToken, tokenDeps, type TokenDef } from './registry';
import { SET_DEFS, SET_IDS, type SetId } from './sets';

export const TOKENS: readonly TokenDef[] = [
  ...GLOBAL_DEFS,
  ...SET_IDS.flatMap((id) => SET_DEFS[id]),
];

export const TOKEN_MAP: ReadonlyMap<string, TokenDef> = new Map(TOKENS.map((t) => [t.name, t]));

export const getToken = (name: string): TokenDef | undefined => TOKEN_MAP.get(name);

export const GLOBAL_COLOR_TOKENS: readonly string[] = GLOBAL_DEFS.filter(isColorToken).map(
  (t) => t.name,
);

export const SET_TOKENS: Readonly<Record<SetId, readonly string[]>> = Object.fromEntries(
  SET_IDS.map((id) => [id, SET_DEFS[id].map((t) => t.name)]),
) as unknown as Record<SetId, readonly string[]>;

/** Which set a token belongs to, or `undefined` for globals. */
export function tokenSet(name: string): SetId | undefined {
  const tier = TOKEN_MAP.get(name)?.tier;
  return tier?.startsWith('set:') ? (tier.slice(4) as SetId) : undefined;
}

/** Topological order of the registry (dependencies first). Throws on a cycle. */
export function topoOrder(tokens: readonly TokenDef[] = TOKENS): string[] {
  const map = new Map(tokens.map((t) => [t.name, t]));
  const out: string[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (name: string, path: string[]): void => {
    const s = state.get(name);
    if (s === 2) return;
    if (s === 1) throw new Error(`Token cycle: ${[...path, name].join(' -> ')}`);
    state.set(name, 1);
    const def = map.get(name);
    if (def) for (const d of tokenDeps(def)) if (!d.startsWith('$')) visit(d, [...path, name]);
    state.set(name, 2);
    out.push(name);
  };
  for (const t of tokens) visit(t.name, []);
  return out;
}

/** Tokens that (transitively) depend on any of `names` (tokens or `$seed` nodes), plus themselves. */
export function dependents(names: Iterable<string>): Set<string> {
  const rev = REVERSE_DEPS;
  const out = new Set<string>();
  const stack = [...names];
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n)) continue;
    out.add(n);
    for (const d of rev.get(n) ?? []) stack.push(d);
  }
  return out;
}

const REVERSE_DEPS: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const t of TOKENS) {
    for (const d of tokenDeps(t)) {
      const list = m.get(d) ?? [];
      list.push(t.name);
      m.set(d, list);
    }
  }
  return m;
})();

export * from './registry';
export * from './global';
export * from './sets';
