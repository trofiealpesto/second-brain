import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { GitHubHandler } from "./github-handler";
import { SecondBrainMCP } from "./mcp";
import { handleScheduled } from "./cron";
import { LegacyApiHandler, SiriApiHandler } from "./api-handlers";
import { tokensEqual } from "./auth";
import { retrySiriProjections } from "./siri";
import type { Env } from "./types";

export { SecondBrainMCP };

let _provider: OAuthProvider | null = null;

function getProvider(): OAuthProvider {
  if (!_provider) {
    _provider = new OAuthProvider({
      apiHandlers: {
        "/mcp": SecondBrainMCP.serve("/mcp", { binding: "SECOND_BRAIN_MCP" }),
        "/api/": LegacyApiHandler,
        "/v1/siri/": SiriApiHandler,
      },
      authorizeEndpoint: "/authorize",
      clientRegistrationEndpoint: "/register",
      defaultHandler: GitHubHandler,
      tokenEndpoint: "/token",
      scopesSupported: ["brain.read", "brain.write"],
      allowPlainPKCE: false,
      resolveExternalToken: async ({ token, request, env }) => {
        const configured = (env as Env).AUTOMATION_API_TOKEN;
        if (
          new URL(request.url).pathname.startsWith("/api/") &&
          configured &&
          tokensEqual(token, configured)
        ) {
          return { props: { kind: "automation" } };
        }
        return null;
      },
    });
  }
  return _provider;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return getProvider().fetch(request, env, ctx) as Promise<Response>;
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (_controller.cron === "0 9 * * *") {
      ctx.waitUntil(handleScheduled(env));
    }
    ctx.waitUntil(retrySiriProjections(env));
  },
};
