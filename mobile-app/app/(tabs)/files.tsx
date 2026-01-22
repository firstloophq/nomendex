import React, { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from "react-native";
import { router } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";

import { Text, View } from "@/components/Themed";
import { useAuth } from "@/contexts/AuthContext";
import { useRepo } from "@/contexts/RepoContext";
import { getContents, parseRepoFullName, isMarkdownFile } from "@/lib/github";
import type { GitHubContent } from "@/lib/types";

export default function FilesScreen() {
  const { isAuthenticated } = useAuth();
  const { selectedRepo, currentPath, setCurrentPath, clearSelection } = useRepo();

  const [contents, setContents] = useState<GitHubContent[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchContents = useCallback(async () => {
    if (!isAuthenticated || !selectedRepo) return;

    setIsLoading(true);
    try {
      const { owner, repo } = parseRepoFullName(selectedRepo.fullName);
      const data = await getContents({
        owner,
        repo,
        path: currentPath,
        ref: selectedRepo.branch,
      });

      const contentArray = Array.isArray(data) ? data : [data];

      // Sort: directories first, then files alphabetically
      const sorted = contentArray.sort((a, b) => {
        if (a.type === "dir" && b.type !== "dir") return -1;
        if (a.type !== "dir" && b.type === "dir") return 1;
        return a.name.localeCompare(b.name);
      });

      setContents(sorted);
    } catch (error) {
      console.error("Failed to fetch contents:", error);
      Alert.alert("Error", "Failed to load directory contents");
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, selectedRepo, currentPath]);

  useEffect(() => {
    fetchContents();
  }, [fetchContents]);

  const handleItemPress = (item: GitHubContent) => {
    if (item.type === "dir") {
      setCurrentPath(item.path);
    } else if (isMarkdownFile(item.path)) {
      router.push(`/editor/${encodeURIComponent(item.path)}`);
    } else {
      Alert.alert("Unsupported File", "Only markdown files can be edited");
    }
  };

  const handleGoBack = () => {
    if (currentPath) {
      const parentPath = currentPath.split("/").slice(0, -1).join("/");
      setCurrentPath(parentPath);
    }
  };

  const handleChangeRepo = async () => {
    await clearSelection();
    router.push("/");
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Please login first</Text>
          <TouchableOpacity style={styles.loginLink} onPress={() => router.push("/")}>
            <Text style={styles.loginLinkText}>Go to Login</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!selectedRepo) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <FontAwesome name="folder-open" size={48} color="#888" />
          <Text style={styles.emptyText}>No repository selected</Text>
          <TouchableOpacity style={styles.loginLink} onPress={() => router.push("/")}>
            <Text style={styles.loginLinkText}>Select a Repository</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const pathParts = currentPath ? currentPath.split("/") : [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleChangeRepo} style={styles.repoButton}>
          <FontAwesome name="book" size={16} color="#888" />
          <Text style={styles.repoName} numberOfLines={1}>
            {selectedRepo.fullName}
          </Text>
          <FontAwesome name="chevron-down" size={12} color="#666" />
        </TouchableOpacity>
      </View>

      <View style={styles.breadcrumb}>
        <TouchableOpacity
          onPress={() => setCurrentPath("")}
          style={styles.breadcrumbItem}
          disabled={!currentPath}
        >
          <FontAwesome name="home" size={14} color={currentPath ? "#2f95dc" : "#888"} />
        </TouchableOpacity>

        {pathParts.map((part, index) => {
          const partPath = pathParts.slice(0, index + 1).join("/");
          const isLast = index === pathParts.length - 1;

          return (
            <React.Fragment key={partPath}>
              <FontAwesome name="chevron-right" size={10} color="#666" style={styles.breadcrumbSeparator} />
              <TouchableOpacity
                onPress={() => setCurrentPath(partPath)}
                style={styles.breadcrumbItem}
                disabled={isLast}
              >
                <Text style={[styles.breadcrumbText, isLast && styles.breadcrumbTextActive]}>
                  {part}
                </Text>
              </TouchableOpacity>
            </React.Fragment>
          );
        })}
      </View>

      {currentPath && (
        <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
          <FontAwesome name="arrow-left" size={14} color="#888" />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={contents}
        keyExtractor={(item) => item.path}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.fileItem} onPress={() => handleItemPress(item)}>
            <FontAwesome
              name={item.type === "dir" ? "folder" : isMarkdownFile(item.path) ? "file-text" : "file"}
              size={18}
              color={item.type === "dir" ? "#8b949e" : isMarkdownFile(item.path) ? "#58a6ff" : "#666"}
              style={styles.fileIcon}
            />
            <Text style={styles.fileName}>{item.name}</Text>
            {item.type !== "dir" && (
              <FontAwesome name="chevron-right" size={12} color="#666" />
            )}
          </TouchableOpacity>
        )}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={fetchContents} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {isLoading ? "Loading..." : "This directory is empty"}
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#333",
  },
  repoButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  repoName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  breadcrumb: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexWrap: "wrap",
    gap: 4,
  },
  breadcrumbItem: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  breadcrumbSeparator: {
    marginHorizontal: 2,
  },
  breadcrumbText: {
    fontSize: 13,
    color: "#2f95dc",
  },
  breadcrumbTextActive: {
    color: "#888",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
  },
  backButtonText: {
    fontSize: 14,
    color: "#888",
  },
  listContent: {
    paddingBottom: 20,
  },
  fileItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#222",
  },
  fileIcon: {
    width: 24,
    textAlign: "center",
    marginRight: 12,
  },
  fileName: {
    flex: 1,
    fontSize: 15,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyText: {
    color: "#888",
    fontSize: 16,
    marginTop: 16,
  },
  loginLink: {
    marginTop: 16,
  },
  loginLinkText: {
    color: "#2f95dc",
    fontSize: 16,
  },
});
