import {
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  writeAsStringAsync,
  readAsStringAsync,
  readDirectoryAsync,
  deleteAsync,
} from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import type { CachedFile, RepoConfig, AppState } from "./types";

const CACHE_DIR = `${documentDirectory}cache/`;
const APP_STATE_KEY = "app_state";
const RECENT_REPOS_KEY = "recent_repos";

// Ensure cache directory exists
async function ensureCacheDir(): Promise<void> {
  const dirInfo = await getInfoAsync(CACHE_DIR);
  if (!dirInfo.exists) {
    await makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

// Generate a safe filename for caching
function getCacheFilePath(repoFullName: string, filePath: string): string {
  const safeRepoName = repoFullName.replace("/", "_");
  const safeFilePath = filePath.replace(/\//g, "_");
  return `${CACHE_DIR}${safeRepoName}__${safeFilePath}.json`;
}

// Save file to local cache
export async function cacheFile(params: {
  repoFullName: string;
  branch: string;
  path: string;
  sha: string;
  content: string;
}): Promise<void> {
  const { repoFullName, branch, path, sha, content } = params;

  await ensureCacheDir();

  const cachedFile: CachedFile = {
    path,
    sha,
    content,
    repoFullName,
    branch,
    lastModified: Date.now(),
    isDirty: false,
  };

  const cacheFilePath = getCacheFilePath(repoFullName, path);
  await writeAsStringAsync(cacheFilePath, JSON.stringify(cachedFile));
}

// Get file from local cache
export async function getCachedFile(params: {
  repoFullName: string;
  path: string;
}): Promise<CachedFile | null> {
  const { repoFullName, path } = params;

  const cacheFilePath = getCacheFilePath(repoFullName, path);

  try {
    const fileInfo = await getInfoAsync(cacheFilePath);
    if (!fileInfo.exists) {
      return null;
    }

    const content = await readAsStringAsync(cacheFilePath);
    return JSON.parse(content) as CachedFile;
  } catch {
    return null;
  }
}

// Update cached file content (marks as dirty)
export async function updateCachedFile(params: {
  repoFullName: string;
  path: string;
  content: string;
}): Promise<void> {
  const { repoFullName, path, content } = params;

  const cached = await getCachedFile({ repoFullName, path });
  if (!cached) {
    throw new Error("File not in cache");
  }

  cached.content = content;
  cached.isDirty = true;
  cached.lastModified = Date.now();

  const cacheFilePath = getCacheFilePath(repoFullName, path);
  await writeAsStringAsync(cacheFilePath, JSON.stringify(cached));
}

// Mark cached file as synced (after push to GitHub)
export async function markCachedFileSynced(params: {
  repoFullName: string;
  path: string;
  newSha: string;
}): Promise<void> {
  const { repoFullName, path, newSha } = params;

  const cached = await getCachedFile({ repoFullName, path });
  if (!cached) {
    throw new Error("File not in cache");
  }

  cached.sha = newSha;
  cached.isDirty = false;
  cached.lastModified = Date.now();

  const cacheFilePath = getCacheFilePath(repoFullName, path);
  await writeAsStringAsync(cacheFilePath, JSON.stringify(cached));
}

// List all cached files for a repo
export async function listCachedFiles(repoFullName: string): Promise<CachedFile[]> {
  await ensureCacheDir();

  const safeRepoName = repoFullName.replace("/", "_");
  const files = await readDirectoryAsync(CACHE_DIR);

  const cachedFiles: CachedFile[] = [];

  for (const file of files) {
    if (file.startsWith(`${safeRepoName}__`)) {
      const content = await readAsStringAsync(`${CACHE_DIR}${file}`);
      cachedFiles.push(JSON.parse(content) as CachedFile);
    }
  }

  return cachedFiles;
}

// Delete cached file
export async function deleteCachedFile(params: {
  repoFullName: string;
  path: string;
}): Promise<void> {
  const { repoFullName, path } = params;

  const cacheFilePath = getCacheFilePath(repoFullName, path);

  try {
    await deleteAsync(cacheFilePath);
  } catch {
    // File doesn't exist, ignore
  }
}

// Clear all cache for a repo
export async function clearRepoCache(repoFullName: string): Promise<void> {
  await ensureCacheDir();

  const safeRepoName = repoFullName.replace("/", "_");
  const files = await readDirectoryAsync(CACHE_DIR);

  for (const file of files) {
    if (file.startsWith(`${safeRepoName}__`)) {
      await deleteAsync(`${CACHE_DIR}${file}`);
    }
  }
}

// App State Management
export async function getAppState(): Promise<AppState> {
  try {
    const stateJson = await SecureStore.getItemAsync(APP_STATE_KEY);
    if (stateJson) {
      return JSON.parse(stateJson) as AppState;
    }
  } catch {
    // Ignore errors
  }

  return {
    selectedRepo: null,
    currentPath: "",
  };
}

export async function setAppState(state: AppState): Promise<void> {
  await SecureStore.setItemAsync(APP_STATE_KEY, JSON.stringify(state));
}

// Recent Repos Management
export async function getRecentRepos(): Promise<RepoConfig[]> {
  try {
    const reposJson = await SecureStore.getItemAsync(RECENT_REPOS_KEY);
    if (reposJson) {
      return JSON.parse(reposJson) as RepoConfig[];
    }
  } catch {
    // Ignore errors
  }

  return [];
}

export async function addRecentRepo(repo: RepoConfig): Promise<void> {
  const repos = await getRecentRepos();

  // Remove existing entry if present
  const filtered = repos.filter((r) => r.fullName !== repo.fullName);

  // Add to front
  filtered.unshift({
    ...repo,
    lastAccessedAt: Date.now(),
  });

  // Keep only 10 recent repos
  const trimmed = filtered.slice(0, 10);

  await SecureStore.setItemAsync(RECENT_REPOS_KEY, JSON.stringify(trimmed));
}
