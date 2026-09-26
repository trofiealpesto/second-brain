import type { Env } from "./types";

/** Returns whether a GitHub identity may use this personal deployment. */
export function isAllowedGitHubLogin(login: string, env: Env): boolean {
  const allowed = (env.ALLOWED_GITHUB_LOGINS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(login.trim().toLowerCase());
}

/** Constant-work comparison for the long-lived automation bearer token. */
export function tokensEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
