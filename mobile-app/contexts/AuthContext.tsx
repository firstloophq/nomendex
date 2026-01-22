import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { GitHubUser } from "@/lib/auth";
import {
  getStoredToken,
  storeToken,
  clearToken,
  getStoredUser,
  storeUser,
  fetchGitHubUser,
} from "@/lib/auth";
import { initOctokit, clearOctokit } from "@/lib/github";

interface AuthContextType {
  user: GitHubUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load stored auth on mount
  useEffect(() => {
    async function loadStoredAuth() {
      try {
        const storedToken = await getStoredToken();
        const storedUser = await getStoredUser();

        if (storedToken && storedUser) {
          setToken(storedToken);
          setUser(storedUser);
          initOctokit(storedToken);
        }
      } catch (error) {
        console.error("Failed to load stored auth:", error);
      } finally {
        setIsLoading(false);
      }
    }

    loadStoredAuth();
  }, []);

  const login = useCallback(async (newToken: string) => {
    try {
      setIsLoading(true);

      // Initialize Octokit with the new token
      initOctokit(newToken);

      // Fetch user profile
      const githubUser = await fetchGitHubUser(newToken);

      // Store credentials
      await storeToken(newToken);
      await storeUser(githubUser);

      // Update state
      setToken(newToken);
      setUser(githubUser);
    } catch (error) {
      clearOctokit();
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await clearToken();
      clearOctokit();
      setToken(null);
      setUser(null);
    } catch (error) {
      console.error("Failed to logout:", error);
    }
  }, []);

  const value: AuthContextType = {
    user,
    token,
    isLoading,
    isAuthenticated: !!token && !!user,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
