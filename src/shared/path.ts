/**
 * Dependency-free path helpers shared by the renderer and the main process.
 *
 * The renderer has no Node `path` module, and the main process needs the same
 * slash normalization for cross-platform paths, so the small slice both sides
 * use lives here (bundled into both). Where a full Node `path` is available,
 * prefer `node:path`; these exist so the two processes agree on the rules.
 */

/** Forward-slash form of a path (Windows `\` becomes `/`). */
export function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Parent directory of a path, or "" when it has no separator. */
export function dirName(p: string): string {
  const n = normalizeSlashes(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(0, i) : "";
}

/** Last path segment (file name). */
export function baseName(p: string): string {
  const n = normalizeSlashes(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

/** True for a POSIX `/...` path or a Windows drive path like `C:/...`. */
export function isAbsolutePath(p: string): boolean {
  const n = normalizeSlashes(p);
  return /^[A-Za-z]:\//.test(n) || n.startsWith("/");
}

/** Join a directory and a name with a single `/`. */
export function joinPath(dir: string, name: string): string {
  if (!dir) return normalizeSlashes(name);
  const d = normalizeSlashes(dir).replace(/\/+$/, "");
  return `${d}/${normalizeSlashes(name).replace(/^\/+/, "")}`;
}

/** Relative path from `dir` to `fp`, or null when not computable (different drive). */
export function relativeToDir(dir: string, fp: string): string | null {
  const d = normalizeSlashes(dir).replace(/\/+$/, "");
  const f = normalizeSlashes(fp);
  if (!d || !f) return null;
  const dm = /^([A-Za-z]):/.exec(d);
  const fm = /^([A-Za-z]):/.exec(f);
  if (dm && fm && dm[1] !== fm[1]) return null;
  const da = d.split("/");
  const fa = f.split("/");
  let i = 0;
  while (i < da.length && i < fa.length && da[i] === fa[i]) i++;
  const ups = da.length - i;
  const tail = fa.slice(i).join("/");
  if (!tail) return null;
  return ups > 0 ? `${new Array(ups).fill("..").join("/")}/${tail}` : tail;
}
