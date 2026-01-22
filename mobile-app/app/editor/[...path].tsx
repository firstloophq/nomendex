import React, { useEffect, useState, useRef, useCallback } from "react";
import { StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useNavigation, router } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";

import { Text, View } from "@/components/Themed";
import { MarkdownEditor, type MarkdownEditorRef } from "@/components/MarkdownEditor";
import { useAuth } from "@/contexts/AuthContext";
import { useRepo } from "@/contexts/RepoContext";
import { getFileContent, updateFile, parseRepoFullName } from "@/lib/github";
import {
  cacheFile,
  getCachedFile,
  updateCachedFile,
  markCachedFileSynced,
} from "@/lib/storage";

export default function EditorScreen() {
  const params = useLocalSearchParams<{ path: string[] }>();
  const navigation = useNavigation();
  const { isAuthenticated } = useAuth();
  const { selectedRepo } = useRepo();

  const editorRef = useRef<MarkdownEditorRef>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [content, setContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [fileSha, setFileSha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Get the file path from params
  const filePath = Array.isArray(params.path) ? params.path.join("/") : params.path ?? "";
  const fileName = filePath.split("/").pop() ?? "Untitled";

  // Set navigation title
  useEffect(() => {
    navigation.setOptions({
      title: fileName,
      headerRight: () => (
        <TouchableOpacity
          onPress={handleSave}
          disabled={!isDirty || isSaving}
          style={[styles.headerButton, (!isDirty || isSaving) && styles.headerButtonDisabled]}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#58a6ff" />
          ) : (
            <FontAwesome
              name="save"
              size={20}
              color={isDirty ? "#58a6ff" : "#666"}
            />
          )}
        </TouchableOpacity>
      ),
    });
  }, [navigation, fileName, isDirty, isSaving]);

  // Load file content
  const loadFile = useCallback(async () => {
    if (!selectedRepo || !filePath) {
      setError("No file selected");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check cache first
      const cached = await getCachedFile({
        repoFullName: selectedRepo.fullName,
        path: filePath,
      });

      if (cached) {
        setContent(cached.content);
        setFileSha(cached.sha);
        setIsDirty(cached.isDirty);
        editorRef.current?.setContent(cached.content);
        setIsLoading(false);

        // Optionally refresh from remote in background
        if (!cached.isDirty) {
          refreshFromRemote();
        }
        return;
      }

      // Fetch from GitHub
      await refreshFromRemote();
    } catch (err) {
      console.error("Failed to load file:", err);
      setError("Failed to load file");
    } finally {
      setIsLoading(false);
    }
  }, [selectedRepo, filePath]);

  // Refresh content from remote
  const refreshFromRemote = async () => {
    if (!selectedRepo) return;

    try {
      const { owner, repo } = parseRepoFullName(selectedRepo.fullName);
      const fileData = await getFileContent({
        owner,
        repo,
        path: filePath,
        ref: selectedRepo.branch,
      });

      setContent(fileData.content);
      setFileSha(fileData.sha);
      setIsDirty(false);
      editorRef.current?.setContent(fileData.content);

      // Cache the file
      await cacheFile({
        repoFullName: selectedRepo.fullName,
        branch: selectedRepo.branch,
        path: filePath,
        sha: fileData.sha,
        content: fileData.content,
      });
    } catch (err) {
      console.error("Failed to refresh from remote:", err);
      throw err;
    }
  };

  useEffect(() => {
    if (isAuthenticated && selectedRepo) {
      loadFile();
    }
  }, [isAuthenticated, selectedRepo, loadFile]);

  // Handle content changes from editor
  const handleContentChange = useCallback(
    async (newContent: string, dirty: boolean) => {
      setContent(newContent);
      setIsDirty(dirty);

      if (dirty && selectedRepo) {
        // Update local cache
        try {
          await updateCachedFile({
            repoFullName: selectedRepo.fullName,
            path: filePath,
            content: newContent,
          });
        } catch {
          // File might not be cached yet, ignore
        }
      }
    },
    [selectedRepo, filePath]
  );

  // Handle save
  const handleSave = useCallback(async () => {
    if (!selectedRepo || !isDirty || isSaving) return;

    setIsSaving(true);

    try {
      const { owner, repo } = parseRepoFullName(selectedRepo.fullName);

      const result = await updateFile({
        owner,
        repo,
        path: filePath,
        content,
        message: `Update ${fileName}`,
        sha: fileSha ?? undefined,
        branch: selectedRepo.branch,
      });

      setFileSha(result.sha);
      setIsDirty(false);
      editorRef.current?.markSaved();

      // Update cache with new SHA
      await markCachedFileSynced({
        repoFullName: selectedRepo.fullName,
        path: filePath,
        newSha: result.sha,
      });

      Alert.alert("Saved", "File saved successfully");
    } catch (err) {
      console.error("Failed to save file:", err);

      // Check for conflict
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      if (errorMessage.includes("409") || errorMessage.includes("SHA")) {
        Alert.alert(
          "Conflict",
          "The file has been modified on GitHub. Would you like to overwrite?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Refresh",
              onPress: async () => {
                await refreshFromRemote();
              },
            },
            {
              text: "Overwrite",
              style: "destructive",
              onPress: async () => {
                // Fetch latest SHA and retry
                try {
                  const { owner, repo } = parseRepoFullName(selectedRepo.fullName);
                  const latest = await getFileContent({
                    owner,
                    repo,
                    path: filePath,
                    ref: selectedRepo.branch,
                  });
                  setFileSha(latest.sha);
                  // Retry save
                  handleSave();
                } catch {
                  Alert.alert("Error", "Failed to resolve conflict");
                }
              },
            },
          ]
        );
      } else {
        Alert.alert("Error", "Failed to save file: " + errorMessage);
      }
    } finally {
      setIsSaving(false);
    }
  }, [selectedRepo, isDirty, isSaving, filePath, content, fileName, fileSha]);

  // Handle editor save request
  const handleEditorSave = useCallback(
    (editorContent: string) => {
      setContent(editorContent);
      handleSave();
    },
    [handleSave]
  );

  // Warn about unsaved changes when leaving
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (!isDirty) return;

      e.preventDefault();

      Alert.alert(
        "Unsaved Changes",
        "You have unsaved changes. Do you want to discard them?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save & Leave",
            onPress: async () => {
              await handleSave();
              navigation.dispatch(e.data.action);
            },
          },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => navigation.dispatch(e.data.action),
          },
        ]
      );
    });

    return unsubscribe;
  }, [navigation, isDirty, handleSave]);

  if (!isAuthenticated || !selectedRepo) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Please select a repository first</Text>
          <TouchableOpacity style={styles.button} onPress={() => router.push("/")}>
            <Text style={styles.buttonText}>Go to Repos</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#58a6ff" />
          <Text style={styles.loadingText}>Loading file...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <FontAwesome name="exclamation-circle" size={48} color="#f85149" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.button} onPress={loadFile}>
            <Text style={styles.buttonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MarkdownEditor
        ref={editorRef}
        initialContent={content}
        onContentChange={handleContentChange}
        onSave={handleEditorSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerButtonDisabled: {
    opacity: 0.5,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 16,
    color: "#888",
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errorText: {
    marginTop: 16,
    color: "#888",
    textAlign: "center",
  },
  button: {
    marginTop: 24,
    backgroundColor: "#238636",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
});
