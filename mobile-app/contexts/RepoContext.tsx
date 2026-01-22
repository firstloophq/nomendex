import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { RepoConfig, AppState } from "@/lib/types";
import { getAppState, setAppState, addRecentRepo, getRecentRepos } from "@/lib/storage";

interface RepoContextType {
  selectedRepo: RepoConfig | null;
  currentPath: string;
  recentRepos: RepoConfig[];
  isLoading: boolean;
  selectRepo: (repo: RepoConfig) => Promise<void>;
  setCurrentPath: (path: string) => void;
  clearSelection: () => Promise<void>;
}

const RepoContext = createContext<RepoContextType | null>(null);

export function RepoProvider({ children }: { children: React.ReactNode }) {
  const [selectedRepo, setSelectedRepo] = useState<RepoConfig | null>(null);
  const [currentPath, setCurrentPathState] = useState("");
  const [recentRepos, setRecentRepos] = useState<RepoConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load stored state on mount
  useEffect(() => {
    async function loadStoredState() {
      try {
        const state = await getAppState();
        setSelectedRepo(state.selectedRepo);
        setCurrentPathState(state.currentPath);

        const recent = await getRecentRepos();
        setRecentRepos(recent);
      } catch (error) {
        console.error("Failed to load app state:", error);
      } finally {
        setIsLoading(false);
      }
    }

    loadStoredState();
  }, []);

  const selectRepo = useCallback(async (repo: RepoConfig) => {
    setSelectedRepo(repo);
    setCurrentPathState("");

    const newState: AppState = {
      selectedRepo: repo,
      currentPath: "",
    };

    await setAppState(newState);
    await addRecentRepo(repo);

    const recent = await getRecentRepos();
    setRecentRepos(recent);
  }, []);

  const setCurrentPath = useCallback(
    (path: string) => {
      setCurrentPathState(path);

      if (selectedRepo) {
        const newState: AppState = {
          selectedRepo,
          currentPath: path,
        };
        setAppState(newState);
      }
    },
    [selectedRepo]
  );

  const clearSelection = useCallback(async () => {
    setSelectedRepo(null);
    setCurrentPathState("");

    const newState: AppState = {
      selectedRepo: null,
      currentPath: "",
    };

    await setAppState(newState);
  }, []);

  const value: RepoContextType = {
    selectedRepo,
    currentPath,
    recentRepos,
    isLoading,
    selectRepo,
    setCurrentPath,
    clearSelection,
  };

  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
}

export function useRepo(): RepoContextType {
  const context = useContext(RepoContext);
  if (!context) {
    throw new Error("useRepo must be used within a RepoProvider");
  }
  return context;
}
