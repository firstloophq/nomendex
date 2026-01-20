import { getNomendexPath, hasActiveWorkspace } from "@/storage/root-path";

/**
 * Simple secrets manager for the Bun sidecar.
 * - Loads key/value pairs from workspace secrets.json
 * - Auto-creates the secrets file with empty object if it doesn't exist
 * - Provides helpers to access them and optionally hydrate process.env
 * - Avoids logging values
 */
export class SecretsManager {
  private loaded = false;
  private map: Record<string, string> = {};

  private getPath(): string {
    if (!hasActiveWorkspace()) {
      // Fallback to app support directory if no active workspace
      return `${process.env.HOME}/Library/Application Support/com.firstloop.nomendex/secrets.json`;
    }
    return `${getNomendexPath()}/secrets.json`;
  }

  async load(): Promise<void> {
    try {
      const secretsPath = this.getPath();
      const file = Bun.file(secretsPath);
      if (!(await file.exists())) {
        // Auto-create empty secrets file
        await this.createEmptySecretsFile();
        this.loaded = true;
        this.map = {};
        return;
      }
      const json = await file.text();
      try {
        const parsed = JSON.parse(json);
        if (parsed && typeof parsed === "object") {
          this.map = parsed as Record<string, string>;
        }
      } catch {
        this.map = {};
      }
      this.loaded = true;
    } catch {
      // On failure, keep empty map
      this.loaded = true;
      this.map = {};
    }
  }

  /**
   * Creates an empty secrets.json file with instructions
   */
  private async createEmptySecretsFile(): Promise<void> {
    const emptySecrets = {
      _comment: "Add your API keys here. This file is gitignored.",
      CLAUDE_CODE_OAUTH_TOKEN: ""
    };
    const secretsPath = this.getPath();
    try {
      await Bun.write(secretsPath, JSON.stringify(emptySecrets, null, 2));
      console.log(`[SecretsManager] Created empty secrets file at ${secretsPath}`);
    } catch (err) {
      console.error(`[SecretsManager] Failed to create secrets file:`, err);
    }
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  async get(key: string): Promise<string | undefined> {
    await this.ensureLoaded();
    return process.env[key] ?? this.map[key];
  }

  async mustGet(key: string): Promise<string> {
    const val = await this.get(key);
    if (!val) throw new Error(`Missing required secret: ${key}`);
    return val;
  }

  /**
   * Hydrate process.env with values from the secrets file.
   * Existing process.env keys are not overwritten.
   */
  async loadIntoProcessEnv(): Promise<void> {
    await this.ensureLoaded();
    for (const [k, v] of Object.entries(this.map)) {
      if (process.env[k] === undefined) {
        process.env[k] = v;
      }
    }
  }
}

export const secrets = new SecretsManager();
