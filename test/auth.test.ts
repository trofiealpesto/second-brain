import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("protected HTTP surfaces", () => {
  it("denies an unauthenticated legacy API request", async () => {
    const response = await SELF.fetch("http://localhost/api/health");
    expect(response.status).toBe(401);
  });

  it("denies an unauthenticated Siri request", async () => {
    const response = await SELF.fetch("http://localhost/v1/siri/sync");
    expect(response.status).toBe(401);
  });

  it("denies the automation token on the Siri surface", async () => {
    const response = await SELF.fetch("http://localhost/v1/siri/sync", {
      headers: { Authorization: "Bearer test-automation-token" },
    });
    expect(response.status).toBe(401);
  });
});
