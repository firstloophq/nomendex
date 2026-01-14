export * from "./mcp-server-types";

/**
 * OAuth authentication warning for MCP servers.
 * OAuth2 MCP authentication in-client is not currently supported by the Claude Agent SDK.
 * @see https://platform.claude.com/docs/en/agent-sdk/mcp#o-auth2-authentication
 */
export const OAUTH_WARNING =
    "OAuth authentication is not currently supported for MCP servers due to Claude Agent SDK limitations. " +
    "Please use API keys or tokens stored in secrets.json instead. " +
    "Reference secrets in your config using ${SECRET_NAME} syntax.";
