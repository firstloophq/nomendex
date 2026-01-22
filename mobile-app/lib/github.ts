import { Octokit } from "@octokit/rest";
import type { GitHubRepo, GitHubContent, GitHubBranch } from "./types";

let octokitInstance: Octokit | null = null;

export function initOctokit(token: string): Octokit {
  octokitInstance = new Octokit({
    auth: token,
  });
  return octokitInstance;
}

export function getOctokit(): Octokit {
  if (!octokitInstance) {
    throw new Error("Octokit not initialized. Call initOctokit first.");
  }
  return octokitInstance;
}

export function clearOctokit(): void {
  octokitInstance = null;
}

// Fetch user's repositories
export async function listRepos(params?: {
  page?: number;
  perPage?: number;
  sort?: "created" | "updated" | "pushed" | "full_name";
}): Promise<GitHubRepo[]> {
  const octokit = getOctokit();
  const { page = 1, perPage = 30, sort = "updated" } = params ?? {};

  const response = await octokit.repos.listForAuthenticatedUser({
    per_page: perPage,
    page,
    sort,
    direction: "desc",
  });

  return response.data as GitHubRepo[];
}

// Fetch repository contents at a path
export async function getContents(params: {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
}): Promise<GitHubContent | GitHubContent[]> {
  const octokit = getOctokit();
  const { owner, repo, path, ref } = params;

  const response = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref,
  });

  return response.data as GitHubContent | GitHubContent[];
}

// Get file content with base64 decoding
export async function getFileContent(params: {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
}): Promise<{ content: string; sha: string }> {
  const octokit = getOctokit();
  const { owner, repo, path, ref } = params;

  const response = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref,
  });

  const data = response.data as GitHubContent;

  if (Array.isArray(data)) {
    throw new Error("Path is a directory, not a file");
  }

  if (data.type !== "file" || !data.content) {
    throw new Error("Invalid file content");
  }

  // Decode base64 content
  const content = atob(data.content.replace(/\n/g, ""));

  return {
    content,
    sha: data.sha,
  };
}

// Update or create a file
export async function updateFile(params: {
  owner: string;
  repo: string;
  path: string;
  content: string;
  message: string;
  sha?: string;
  branch?: string;
}): Promise<{ sha: string }> {
  const octokit = getOctokit();
  const { owner, repo, path, content, message, sha, branch } = params;

  // Encode content to base64
  const encodedContent = btoa(content);

  const response = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: encodedContent,
    sha,
    branch,
  });

  return {
    sha: response.data.content?.sha ?? "",
  };
}

// List branches
export async function listBranches(params: {
  owner: string;
  repo: string;
}): Promise<GitHubBranch[]> {
  const octokit = getOctokit();
  const { owner, repo } = params;

  const response = await octokit.repos.listBranches({
    owner,
    repo,
    per_page: 100,
  });

  return response.data as GitHubBranch[];
}

// Get repository details
export async function getRepo(params: {
  owner: string;
  repo: string;
}): Promise<GitHubRepo> {
  const octokit = getOctokit();
  const { owner, repo } = params;

  const response = await octokit.repos.get({
    owner,
    repo,
  });

  return response.data as GitHubRepo;
}

// Parse repo full name into owner and repo
export function parseRepoFullName(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repo full name: ${fullName}`);
  }
  return { owner, repo };
}

// Check if a path is a markdown file
export function isMarkdownFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "md" || ext === "markdown";
}
