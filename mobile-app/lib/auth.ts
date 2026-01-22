import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";

// Register for web browser redirect
WebBrowser.maybeCompleteAuthSession();

const GITHUB_CLIENT_ID = "YOUR_GITHUB_CLIENT_ID"; // TODO: Replace with actual client ID
const TOKEN_KEY = "github_token";
const USER_KEY = "github_user";

// GitHub OAuth discovery
const discovery = {
  authorizationEndpoint: "https://github.com/login/oauth/authorize",
  tokenEndpoint: "https://github.com/login/oauth/access_token",
  revocationEndpoint: `https://github.com/settings/connections/applications/${GITHUB_CLIENT_ID}`,
};

export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  name: string | null;
}

export async function getStoredToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function storeToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}

export async function getStoredUser(): Promise<GitHubUser | null> {
  try {
    const userJson = await SecureStore.getItemAsync(USER_KEY);
    if (userJson) {
      return JSON.parse(userJson) as GitHubUser;
    }
    return null;
  } catch {
    return null;
  }
}

export async function storeUser(user: GitHubUser): Promise<void> {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

export function useGitHubAuth() {
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "nomendex",
  });

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: GITHUB_CLIENT_ID,
      scopes: ["repo", "user"],
      redirectUri,
    },
    discovery
  );

  return {
    request,
    response,
    promptAsync,
    redirectUri,
  };
}

// Exchange authorization code for access token
// Note: This typically requires a backend server for security
// For development, you can use a GitHub App with device flow instead
export async function exchangeCodeForToken(params: {
  code: string;
  clientSecret: string;
}): Promise<string> {
  const { code, clientSecret } = params;

  const response = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: clientSecret,
        code,
      }),
    }
  );

  const data = (await response.json()) as { access_token?: string; error?: string };

  if (data.error) {
    throw new Error(data.error);
  }

  if (!data.access_token) {
    throw new Error("No access token received");
  }

  return data.access_token;
}

// Fetch the authenticated user's profile
export async function fetchGitHubUser(token: string): Promise<GitHubUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch user profile");
  }

  return (await response.json()) as GitHubUser;
}
