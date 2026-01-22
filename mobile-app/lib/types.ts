// Type definitions for the mobile app

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    avatar_url: string;
  };
  description: string | null;
  private: boolean;
  default_branch: string;
  updated_at: string;
}

export interface GitHubContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: "file" | "dir";
  download_url: string | null;
  content?: string;
  encoding?: string;
}

export interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

export interface CachedFile {
  path: string;
  sha: string;
  content: string;
  repoFullName: string;
  branch: string;
  lastModified: number;
  isDirty: boolean;
}

export interface RepoConfig {
  fullName: string;
  branch: string;
  lastAccessedAt: number;
}

export interface AppState {
  selectedRepo: RepoConfig | null;
  currentPath: string;
}
