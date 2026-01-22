import React, { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Pressable,
} from "react-native";
import { router } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";

import { Text, View } from "@/components/Themed";
import { useAuth } from "@/contexts/AuthContext";
import { useRepo } from "@/contexts/RepoContext";
import { getContents, getFileContent, parseRepoFullName, isMarkdownFile } from "@/lib/github";
import type { GitHubContent } from "@/lib/types";

// Get today's daily note filename in M-D-YYYY.md format
function getTodayDailyNoteFileName(): string {
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const year = today.getFullYear();
  return `${month}-${day}-${year}.md`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// Parse markdown content for in-progress items (- [ ] or checkbox style)
function extractTodos(content: string): { text: string; done: boolean }[] {
  const lines = content.split("\n");
  const todos: { text: string; done: boolean }[] = [];

  for (const line of lines) {
    const todoMatch = line.match(/^[\s]*-\s*\[([ xX])\]\s*(.+)$/);
    if (todoMatch) {
      todos.push({
        done: todoMatch[1].toLowerCase() === "x",
        text: todoMatch[2].trim(),
      });
    }
  }

  return todos;
}

// Extract first few lines of content as preview
function getContentPreview(content: string, maxLines: number = 5): string {
  const lines = content.split("\n").filter((line) => {
    // Skip frontmatter
    if (line.startsWith("---")) return false;
    // Skip empty lines at start
    if (line.trim() === "") return false;
    // Skip headers
    if (line.startsWith("#")) return false;
    return true;
  });

  return lines.slice(0, maxLines).join("\n");
}

export default function HomeScreen() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { selectedRepo } = useRepo();

  const [dailyNoteContent, setDailyNoteContent] = useState<string | null>(null);
  const [dailyNoteExists, setDailyNoteExists] = useState(false);
  const [inProgressTodos, setInProgressTodos] = useState<{ text: string; done: boolean }[]>([]);
  const [recentFiles, setRecentFiles] = useState<GitHubContent[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const todayFileName = getTodayDailyNoteFileName();

  const loadDashboardData = useCallback(async () => {
    if (!isAuthenticated || !selectedRepo) return;

    setIsLoading(true);

    try {
      const { owner, repo } = parseRepoFullName(selectedRepo.fullName);

      // Try to load today's daily note
      try {
        const dailyNote = await getFileContent({
          owner,
          repo,
          path: todayFileName,
          ref: selectedRepo.branch,
        });
        setDailyNoteContent(dailyNote.content);
        setDailyNoteExists(true);

        // Extract todos from daily note
        const todos = extractTodos(dailyNote.content);
        setInProgressTodos(todos.filter((t) => !t.done).slice(0, 5));
      } catch {
        // Daily note doesn't exist
        setDailyNoteContent(null);
        setDailyNoteExists(false);
        setInProgressTodos([]);
      }

      // Load recent markdown files from root
      try {
        const contents = await getContents({
          owner,
          repo,
          path: "",
          ref: selectedRepo.branch,
        });

        const contentArray = Array.isArray(contents) ? contents : [contents];
        const mdFiles = contentArray
          .filter((item) => item.type === "file" && isMarkdownFile(item.path))
          .slice(0, 5);

        setRecentFiles(mdFiles);
      } catch {
        setRecentFiles([]);
      }
    } catch (error) {
      console.error("Failed to load dashboard data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, selectedRepo, todayFileName]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const handleMicPress = () => {
    // TODO: Implement voice input
    console.log("Mic pressed - voice input coming soon");
  };

  const handleDailyNotePress = () => {
    if (dailyNoteExists) {
      router.push(`/editor/${encodeURIComponent(todayFileName)}`);
    } else {
      // Create new daily note
      router.push(`/editor/${encodeURIComponent(todayFileName)}`);
    }
  };

  const handleFilePress = (path: string) => {
    router.push(`/editor/${encodeURIComponent(path)}`);
  };

  if (authLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <FontAwesome name="book" size={64} color="#888" />
          <Text style={styles.title}>Nomendex</Text>
          <Text style={styles.subtitle}>Your markdown vault, anywhere</Text>
          <TouchableOpacity style={styles.loginButton} onPress={() => router.push("/login")}>
            <FontAwesome name="github" size={20} color="#fff" />
            <Text style={styles.loginButtonText}>Connect GitHub</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!selectedRepo) {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <FontAwesome name="folder-open-o" size={64} color="#888" />
          <Text style={styles.title}>Select a Vault</Text>
          <Text style={styles.subtitle}>Choose a repository to get started</Text>
          <TouchableOpacity style={styles.selectButton} onPress={() => router.push("/repos")}>
            <FontAwesome name="github" size={18} color="#fff" />
            <Text style={styles.selectButtonText}>Select Repository</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={loadDashboardData} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.greeting}>Hello, {user?.name || user?.login}</Text>
          <Text style={styles.date}>{formatDate(new Date())}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push("/repos")} style={styles.repoChip}>
          <FontAwesome name="book" size={12} color="#888" />
          <Text style={styles.repoChipText} numberOfLines={1}>
            {selectedRepo.fullName.split("/")[1]}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Quick Input - Mic Button */}
      <View style={styles.quickInputSection}>
        <Pressable
          style={({ pressed }) => [styles.micButton, pressed && styles.micButtonPressed]}
          onPress={handleMicPress}
        >
          <FontAwesome name="microphone" size={32} color="#fff" />
        </Pressable>
        <Text style={styles.micHint}>Tap to capture a thought</Text>
      </View>

      {/* Today's Daily Note */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Today's Note</Text>
          <TouchableOpacity onPress={handleDailyNotePress}>
            <Text style={styles.sectionAction}>{dailyNoteExists ? "Open" : "Create"}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.dailyNoteCard} onPress={handleDailyNotePress}>
          <View style={styles.dailyNoteHeader}>
            <FontAwesome name="calendar" size={16} color="#58a6ff" />
            <Text style={styles.dailyNoteFileName}>{todayFileName}</Text>
          </View>
          {dailyNoteExists && dailyNoteContent ? (
            <Text style={styles.dailyNotePreview} numberOfLines={4}>
              {getContentPreview(dailyNoteContent) || "Empty note"}
            </Text>
          ) : (
            <Text style={styles.dailyNoteEmpty}>
              No daily note yet. Tap to create one.
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* In Progress Items */}
      {inProgressTodos.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>In Progress</Text>
            <Text style={styles.sectionCount}>{inProgressTodos.length}</Text>
          </View>

          <View style={styles.todosCard}>
            {inProgressTodos.map((todo, index) => (
              <View key={index} style={styles.todoItem}>
                <View style={styles.todoCheckbox}>
                  <FontAwesome name="square-o" size={18} color="#58a6ff" />
                </View>
                <Text style={styles.todoText} numberOfLines={1}>
                  {todo.text}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Recent Files */}
      {recentFiles.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Files</Text>
            <TouchableOpacity onPress={() => router.push("/files")}>
              <Text style={styles.sectionAction}>See All</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.recentFilesCard}>
            {recentFiles.map((file) => (
              <TouchableOpacity
                key={file.path}
                style={styles.recentFileItem}
                onPress={() => handleFilePress(file.path)}
              >
                <FontAwesome name="file-text-o" size={16} color="#8b949e" />
                <Text style={styles.recentFileName}>{file.name}</Text>
                <FontAwesome name="chevron-right" size={12} color="#666" />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Bottom spacing */}
      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loadingText: {
    color: "#888",
    fontSize: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginTop: 20,
  },
  subtitle: {
    fontSize: 16,
    color: "#888",
    marginTop: 8,
    textAlign: "center",
  },
  loginButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#238636",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 32,
    gap: 10,
  },
  loginButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  selectButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#24292e",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 32,
    gap: 10,
  },
  selectButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerLeft: {
    flex: 1,
    backgroundColor: "transparent",
  },
  greeting: {
    fontSize: 24,
    fontWeight: "700",
  },
  date: {
    fontSize: 14,
    color: "#888",
    marginTop: 2,
  },
  repoChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
    maxWidth: 120,
  },
  repoChipText: {
    fontSize: 12,
    color: "#888",
  },
  quickInputSection: {
    alignItems: "center",
    paddingVertical: 32,
    backgroundColor: "transparent",
  },
  micButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#58a6ff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#58a6ff",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  micButtonPressed: {
    transform: [{ scale: 0.95 }],
    opacity: 0.9,
  },
  micHint: {
    fontSize: 13,
    color: "#666",
    marginTop: 12,
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    backgroundColor: "transparent",
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#c9d1d9",
  },
  sectionAction: {
    fontSize: 14,
    color: "#58a6ff",
  },
  sectionCount: {
    fontSize: 14,
    color: "#888",
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  dailyNoteCard: {
    backgroundColor: "#161b22",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#30363d",
  },
  dailyNoteHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
    backgroundColor: "transparent",
  },
  dailyNoteFileName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#58a6ff",
  },
  dailyNotePreview: {
    fontSize: 14,
    color: "#8b949e",
    lineHeight: 20,
  },
  dailyNoteEmpty: {
    fontSize: 14,
    color: "#666",
    fontStyle: "italic",
  },
  todosCard: {
    backgroundColor: "#161b22",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#30363d",
    overflow: "hidden",
  },
  todoItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#30363d",
    backgroundColor: "transparent",
  },
  todoCheckbox: {
    marginRight: 12,
    backgroundColor: "transparent",
  },
  todoText: {
    flex: 1,
    fontSize: 15,
    color: "#c9d1d9",
  },
  recentFilesCard: {
    backgroundColor: "#161b22",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#30363d",
    overflow: "hidden",
  },
  recentFileItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#30363d",
    gap: 12,
  },
  recentFileName: {
    flex: 1,
    fontSize: 15,
    color: "#c9d1d9",
  },
  bottomSpacer: {
    height: 40,
  },
});
