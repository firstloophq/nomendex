/**
 * GitHub App utility functions.
 *
 * Provides JWT generation, installation access token management,
 * and GitHub API helpers for the GitHub App integration.
 */

// --- Types ---

interface InstallationToken {
  token: string;
  expiresAt: Date;
}

interface GitHubRepo {
  id: number;
  fullName: string;
  name: string;
  isPrivate: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

interface GitHubInstallationAccount {
  login: string;
  type: string;
  avatarUrl: string;
  id: number;
}

interface GitHubInstallationInfo {
  id: number;
  account: GitHubInstallationAccount;
  appSlug: string;
  permissions: Record<string, string>;
}

// --- In-memory token cache ---

const tokenCache = new Map<number, InstallationToken>();

// --- Helpers ---

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Convert a PEM-encoded RSA private key to a CryptoKey for RS256 signing.
 * Uses Web Crypto API (natively supported by Bun).
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Handle literal \n in env vars (common when pasting multi-line PEM as single line)
  const normalizedPem = pem.replace(/\\n/g, "\n");

  // Strip PEM headers and whitespace
  const pemBody = normalizedPem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, "")
    .replace(/-----END RSA PRIVATE KEY-----/, "")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  // Try PKCS8 first, fall back to PKCS1
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      binaryDer.buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    // If the PEM is in PKCS1 (RSA PRIVATE KEY) format, wrap it in PKCS8
    // This is a simplified approach — for production, use a proper ASN.1 wrapper.
    throw new Error(
      "Failed to import private key. Ensure GITHUB_APP_PRIVATE_KEY is in PKCS8 format " +
      "(BEGIN PRIVATE KEY). You can convert with: openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in key.pem -out key-pkcs8.pem",
    );
  }
}

function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// --- Public API ---

/**
 * Generate a short-lived JWT signed by the GitHub App's private key.
 * Used to authenticate as the GitHub App itself.
 */
export async function generateAppJWT(): Promise<string> {
  const appId = getRequiredEnv("GITHUB_APP_ID");
  const privateKeyPem = getRequiredEnv("GITHUB_APP_PRIVATE_KEY");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 60, // 60 seconds in the past to account for clock drift
    exp: now + 10 * 60, // 10 minutes
    iss: appId,
  };

  const encodedHeader = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(header)),
  );
  const encodedPayload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await importPrivateKey(privateKeyPem);

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );

  const encodedSignature = base64UrlEncode(new Uint8Array(signature));
  return `${signingInput}.${encodedSignature}`;
}

/**
 * Create (or return cached) an installation access token for a GitHub App installation.
 * Tokens are cached in-memory and refreshed 5 minutes before expiry.
 */
export async function createInstallationAccessToken(params: {
  installationId: number;
}): Promise<InstallationToken> {
  const { installationId } = params;

  // Check cache
  const cached = tokenCache.get(installationId);
  if (cached) {
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
    if (cached.expiresAt > fiveMinutesFromNow) {
      return cached;
    }
  }

  const jwt = await generateAppJWT();

  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to create installation access token (${response.status}): ${body}`,
    );
  }

  const data = (await response.json()) as { token: string; expires_at: string };
  const result: InstallationToken = {
    token: data.token,
    expiresAt: new Date(data.expires_at),
  };

  tokenCache.set(installationId, result);
  return result;
}

/**
 * List repositories accessible to a GitHub App installation.
 * Paginates automatically.
 */
export async function listInstallationRepos(params: {
  token: string;
}): Promise<GitHubRepo[]> {
  const { token } = params;
  const repos: GitHubRepo[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await fetch(
      `https://api.github.com/installation/repositories?per_page=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to list repos (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      total_count: number;
      repositories: Array<{
        id: number;
        full_name: string;
        name: string;
        private: boolean;
        default_branch: string;
        html_url: string;
      }>;
    };

    for (const repo of data.repositories) {
      repos.push({
        id: repo.id,
        fullName: repo.full_name,
        name: repo.name,
        isPrivate: repo.private,
        defaultBranch: repo.default_branch,
        htmlUrl: repo.html_url,
      });
    }

    if (repos.length >= data.total_count || data.repositories.length < perPage) {
      break;
    }

    page++;
  }

  return repos;
}

/**
 * Get details about a specific GitHub App installation.
 */
export async function getInstallation(params: {
  installationId: number;
}): Promise<GitHubInstallationInfo> {
  const { installationId } = params;
  const jwt = await generateAppJWT();

  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}`,
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to get installation (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    id: number;
    account: {
      login: string;
      type: string;
      avatar_url: string;
      id: number;
    };
    app_slug: string;
    permissions: Record<string, string>;
  };

  return {
    id: data.id,
    account: {
      login: data.account.login,
      type: data.account.type,
      avatarUrl: data.account.avatar_url,
      id: data.account.id,
    },
    appSlug: data.app_slug,
    permissions: data.permissions,
  };
}

/**
 * Exchange an OAuth code for a user access token.
 * Used during the GitHub App callback flow.
 */
export async function exchangeCodeForToken(params: {
  code: string;
}): Promise<{ accessToken: string }> {
  const { code } = params;
  const clientId = getRequiredEnv("GITHUB_APP_CLIENT_ID");
  const clientSecret = getRequiredEnv("GITHUB_APP_CLIENT_SECRET");

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (data.error || !data.access_token) {
    throw new Error(
      `Token exchange error: ${data.error_description || data.error || "Unknown error"}`,
    );
  }

  return { accessToken: data.access_token };
}

// Re-export types
export type { InstallationToken, GitHubRepo, GitHubInstallationAccount, GitHubInstallationInfo };
