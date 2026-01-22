import React, { useState } from "react";
import { StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";

import { Text, View } from "@/components/Themed";
import { useAuth } from "@/contexts/AuthContext";

export default function LoginScreen() {
  const { login } = useAuth();
  const [token, setToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!token.trim()) {
      Alert.alert("Error", "Please enter a personal access token");
      return;
    }

    setIsLoading(true);
    try {
      await login(token.trim());
      router.back();
    } catch (error) {
      console.error("Login failed:", error);
      Alert.alert("Login Failed", "Invalid token or network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <FontAwesome name="github" size={48} color="#888" />
        <Text style={styles.title}>GitHub Login</Text>

        <Text style={styles.description}>
          Enter a GitHub Personal Access Token with `repo` scope to access your repositories.
        </Text>

        <View style={styles.instructionsContainer}>
          <Text style={styles.instructionsTitle}>How to create a token:</Text>
          <Text style={styles.instruction}>1. Go to GitHub Settings</Text>
          <Text style={styles.instruction}>2. Developer settings &gt; Personal access tokens</Text>
          <Text style={styles.instruction}>3. Generate new token (classic)</Text>
          <Text style={styles.instruction}>4. Select `repo` scope</Text>
          <Text style={styles.instruction}>5. Copy the token</Text>
        </View>

        <TextInput
          style={styles.input}
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          placeholderTextColor="#666"
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.loginButton, isLoading && styles.loginButtonDisabled]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <FontAwesome name="sign-in" size={18} color="#fff" />
              <Text style={styles.loginButtonText}>Login</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginTop: 16,
    marginBottom: 16,
  },
  description: {
    fontSize: 14,
    color: "#888",
    textAlign: "center",
    marginBottom: 24,
  },
  instructionsContainer: {
    width: "100%",
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
  },
  instructionsTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  instruction: {
    fontSize: 13,
    color: "#888",
    marginVertical: 2,
  },
  input: {
    width: "100%",
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#fff",
    marginBottom: 16,
  },
  loginButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    backgroundColor: "#238636",
    paddingVertical: 14,
    borderRadius: 8,
    gap: 8,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  cancelButton: {
    marginTop: 16,
    padding: 12,
  },
  cancelButtonText: {
    color: "#888",
    fontSize: 16,
  },
});
