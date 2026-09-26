import type { Env } from "./types";

/** All GitHub paths are instance configuration, never maintainer defaults. */
export function wikiRepository(env: Env) {
  const owner = env.WIKI_REPO_OWNER?.trim();
  const name = env.WIKI_REPO_NAME?.trim();
  if (!owner || !name || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) {
    throw new Error("Configure WIKI_REPO_OWNER and WIKI_REPO_NAME for your private vault");
  }
  return { owner, name, branch: env.WIKI_BRANCH?.trim() || "main" };
}

export function wikiApiBase(env: Env): string {
  const { owner, name } = wikiRepository(env);
  return `https://api.github.com/repos/${owner}/${name}`;
}

export function wikiBranchRef(env: Env): string {
  return wikiRepository(env).branch.split("/").map(encodeURIComponent).join("/");
}
