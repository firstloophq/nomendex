import React, { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Alert,
} from "react-native";
import { router } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";

import { Text, View } from "@/components/Themed";
import { useAuth } from "@/contexts/AuthContext";
import { useRepo } from "@/contexts/RepoContext";
import { listRepos, parseRepoFullName, getRepo } from "@/lib/github";
import type { GitHubRepo, RepoConfig } from "@/lib/types";

export default function ReposScreen() {
  const { user, isAuthenticated, logout } = useAuth();
  const { selectRepo, recentRepos, selectedRepo } = useRepo();

  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [filteredRepos, setFilteredRepos] = useState<GitHubRepo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchRepos = useCallback(async () => {
    if (!isAuthenticated) return;

    setIsLoading(true);
    try {
      const data = await listRepos({ perPage: 100 });
      setRepos(data);
      setFilteredRepos(data);
    } catch (error) {
      console.error("Failed to fetch repos:", error);
      Alert.alert("Error", "Failed to fetch repositories");
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchRepos();
    }
  }, [isAuthenticated, fetchRepos]);

  useEffect(() => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const filtered = repos.filter(
        (repo) =>
          repo.name.toLowerCase().includes(query) ||
          repo.full_name.toLowerCase().includes(query) ||
          repo.description?.toLowerCase().includes(query)
      );
      setFilteredRepos(filtered);
    } else {
      setFilteredRepos(repos);
    }
  }, [searchQuery, repos]);

  const handleSelectRepo = async (repo: GitHubRepo) => {
    const config: RepoConfig = {
      fullName: repo.full_name,
      branch: repo.default_branch,
      lastAccessedAt: Date.now(),
    };

    await selectRepo(config);
    router.back();
  };

  const handleSelectRecentRepo = async (config: RepoConfig) => {
    try {
      const { owner, repo } = parseRepoFullName(config.fullName);
      const repoData = await getRepo({ owner, repo });

      const updatedConfig: RepoConfig = {
        fullName: repoData.full_name,
        branch: config.branch || repoData.default_branch,
        lastAccessedAt: Date.now(),
      };

      await selectRepo(updatedConfig);
      router.back();
    } catch (error) {
      console.error("Failed to load recent repo:", error);
      Alert.alert("Error", "Failed to load repository");
    }
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Please login first</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <FontAwesome name="chevron-left" size={16} color="#58a6ff" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={logout} style={styles.logoutButton}>
            <FontAwesome name="sign-out" size={18} color="#888" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.titleSection}>
        <Text style={styles.title}>Select Vault</Text>
        {selectedRepo && (
          <Text style={styles.currentRepo}>
            Current: {selectedRepo.fullName}
          </Text>
        )}
      </View>

      <View style={styles.searchContainer}>
        <FontAwesome name="search" size={16} color="#888" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search repositories..."
          placeholderTextColor="#888"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {recentRepos.length > 0 && !searchQuery && (
        <View style={styles.recentSection}>
          <Text style={styles.sectionTitle}>Recent</Text>
          {recentRepos.slice(0, 3).map((config) => (
            <TouchableOpacity
              key={config.fullName}
              style={[
                styles.recentItem,
                selectedRepo?.fullName === config.fullName && styles.selectedItem,
              ]}
              onPress={() => handleSelectRecentRepo(config)}
            >
              <FontAwesome name="history" size={16} color="#888" />
              <Text style={styles.recentItemText}>{config.fullName}</Text>
              {selectedRepo?.fullName === config.fullName && (
                <FontAwesome name="check" size={14} color="#58a6ff" />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>All Repositories</Text>

      <FlatList
        data={filteredRepos}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.repoItem,
              selectedRepo?.fullName === item.full_name && styles.selectedItem,
            ]}
            onPress={() => handleSelectRepo(item)}
          >
            <View style={styles.repoHeader}>
              <FontAwesome
                name={item.private ? "lock" : "book"}
                size={16}
                color="#888"
                style={styles.repoIcon}
              />
              <Text style={styles.repoName}>{item.name}</Text>
              {selectedRepo?.fullName === item.full_name && (
                <FontAwesome name="check" size={14} color="#58a6ff" />
              )}
            </View>
            {item.description && (
              <Text style={styles.repoDescription} numberOfLines={2}>
                {item.description}
              </Text>
            )}
            <Text style={styles.repoMeta}>{item.full_name}</Text>
          </TouchableOpacity>
        )}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={fetchRepos} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {searchQuery ? "No repositories found" : "No repositories"}
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
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#333",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  backText: {
    fontSize: 16,
    color: "#58a6ff",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
  },
  logoutButton: {
    padding: 8,
  },
  titleSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
  },
  currentRepo: {
    fontSize: 13,
    color: "#58a6ff",
    marginTop: 4,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#1a1a1a",
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: "#fff",
  },
  recentSection: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#888",
    textTransform: "uppercase",
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 8,
  },
  recentItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    marginTop: 6,
  },
  selectedItem: {
    borderWidth: 1,
    borderColor: "#58a6ff",
  },
  recentItemText: {
    flex: 1,
    fontSize: 14,
    color: "#ccc",
  },
  listContent: {
    paddingBottom: 40,
  },
  repoItem: {
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 14,
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
  },
  repoHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
  },
  repoIcon: {
    marginRight: 8,
  },
  repoName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
  },
  repoDescription: {
    fontSize: 14,
    color: "#888",
    marginTop: 6,
  },
  repoMeta: {
    fontSize: 12,
    color: "#666",
    marginTop: 6,
  },
  emptyContainer: {
    alignItems: "center",
    padding: 40,
  },
  emptyText: {
    color: "#888",
    fontSize: 16,
  },
});
