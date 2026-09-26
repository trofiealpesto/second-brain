import { isAllowedGitHubLogin } from "./auth";
import { GitHubHandler } from "./github-handler";
import type { Props } from "./oauth-utils";
import { handleSiriRequest } from "./siri";
import type { Env } from "./types";

type HandlerContext = ExecutionContext & { props?: unknown };
type AutomationProps = { kind: "automation" };

/** The legacy REST surface is reserved for the non-interactive automation. */
export const LegacyApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as HandlerContext).props as AutomationProps | undefined;
    if (props?.kind !== "automation") return forbidden();
    return GitHubHandler.fetch(request, env, ctx);
  },
};

/** Siri calls require an OAuth grant with the scope matching the operation. */
export const SiriApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as HandlerContext).props as Props | undefined;
    if (!props?.login || !isAllowedGitHubLogin(props.login, env)) return forbidden();

    const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return forbidden();
    const summary = await env.OAUTH_PROVIDER.unwrapToken<Props>(token);
    if (!summary || !isAllowedGitHubLogin(summary.grant.props.login, env)) {
      return forbidden();
    }
    const write = isWriteRequest(request);
    if (!summary.scope.includes(write ? "brain.write" : "brain.read")) {
      return forbidden("The OAuth grant does not include the required scope");
    }
    return handleSiriRequest(request, env, { login: summary.grant.props.login });
  },
};

function isWriteRequest(request: Request) {
  return request.method !== "GET" && request.method !== "HEAD";
}

function forbidden(message = "Authorization is required") {
  return new Response(JSON.stringify({ error: { code: "FORBIDDEN", message } }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}
