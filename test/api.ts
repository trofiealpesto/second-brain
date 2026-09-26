import { SELF } from "cloudflare:test";

/** Authenticated request used by tests that exercise the protected /api surface. */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer test-automation-token");
  return SELF.fetch(input, { ...init, headers });
}
