import { getNoetectPath, hasActiveWorkspace } from "@/storage/root-path";

function getSecretsPath(): string {
    if (!hasActiveWorkspace()) {
        return `${process.env.HOME}/Library/Application Support/com.firstloop.noetect/secrets.json`;
    }
    return `${getNoetectPath()}/secrets.json`;
}

// Define the predefined secret keys and their metadata
const PREDEFINED_SECRETS: Record<string, { label: string; description: string; placeholder: string; helpText: string }> = {
    CLAUDE_CODE_OAUTH_TOKEN: {
        label: "Claude OAuth Token",
        description: "OAuth token for Claude Agent SDK. Generate with 'claude setup-token'",
        placeholder: "sk-ant-oat01-...",
        helpText: "Run 'claude setup-token' in terminal to generate a token",
    },
    GITHUB_PAT: {
        label: "GitHub Personal Access Token",
        description: "PAT for git sync operations. Requires 'repo' scope.",
        placeholder: "ghp_...",
        helpText: "Create at github.com/settings/tokens with 'repo' scope",
    },
};

type SecretsData = Record<string, string>;

async function loadSecrets(): Promise<SecretsData> {
    const file = Bun.file(getSecretsPath());
    if (!(await file.exists())) {
        return {};
    }
    try {
        const json = await file.text();
        const parsed = JSON.parse(json);
        if (parsed && typeof parsed === "object") {
            // Filter out the _comment field
            const { _comment, ...secrets } = parsed;
            return secrets as SecretsData;
        }
        return {};
    } catch {
        return {};
    }
}

async function saveSecrets(secrets: SecretsData): Promise<void> {
    const dataToSave = {
        _comment: "Add your API keys here. This file is gitignored.",
        ...secrets,
    };
    await Bun.write(getSecretsPath(), JSON.stringify(dataToSave, null, 2));

    // Also update process.env for immediate use
    for (const [key, value] of Object.entries(secrets)) {
        if (value) {
            process.env[key] = value;
        } else {
            delete process.env[key];
        }
    }
}

export const secretsRoutes = {
    "/api/secrets/list": {
        async GET() {
            try {
                const secrets = await loadSecrets();

                // Start with predefined secrets
                const result: Array<{
                    key: string;
                    label: string;
                    description: string;
                    placeholder: string;
                    helpText: string;
                    hasValue: boolean;
                    maskedValue: string;
                    isPredefined: boolean;
                }> = Object.entries(PREDEFINED_SECRETS).map(([key, def]) => ({
                    key,
                    label: def.label,
                    description: def.description,
                    placeholder: def.placeholder,
                    helpText: def.helpText,
                    hasValue: !!secrets[key],
                    maskedValue: secrets[key] ? maskSecret(secrets[key]) : "",
                    isPredefined: true,
                }));

                // Add custom secrets (keys not in predefined list)
                const predefinedKeys = new Set(Object.keys(PREDEFINED_SECRETS));
                for (const [key, value] of Object.entries(secrets)) {
                    if (!predefinedKeys.has(key)) {
                        result.push({
                            key,
                            label: key,
                            description: "Custom API key",
                            placeholder: "",
                            helpText: "",
                            hasValue: true,
                            maskedValue: maskSecret(value),
                            isPredefined: false,
                        });
                    }
                }

                return Response.json({ secrets: result });
            } catch (error) {
                console.error("[Secrets] Error listing secrets:", error);
                return Response.json({ error: "Failed to list secrets" }, { status: 500 });
            }
        },
    },

    "/api/secrets/set": {
        async POST(req: Request) {
            try {
                const body = await req.json();
                const { key, value } = body as { key: string; value: string };

                if (!key || typeof key !== "string") {
                    return Response.json({ error: "Key is required" }, { status: 400 });
                }

                // Validate key format (uppercase letters, numbers, underscores)
                if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
                    return Response.json(
                        { error: "Key must be uppercase letters, numbers, and underscores, starting with a letter" },
                        { status: 400 }
                    );
                }

                const secrets = await loadSecrets();

                if (value) {
                    secrets[key] = value;
                } else {
                    delete secrets[key];
                }

                await saveSecrets(secrets);

                return Response.json({
                    success: true,
                    hasValue: !!value,
                    maskedValue: value ? maskSecret(value) : "",
                });
            } catch (error) {
                console.error("[Secrets] Error setting secret:", error);
                return Response.json({ error: "Failed to set secret" }, { status: 500 });
            }
        },
    },

    "/api/secrets/delete": {
        async POST(req: Request) {
            try {
                const body = await req.json();
                const { key } = body as { key: string };

                if (!key || typeof key !== "string") {
                    return Response.json({ error: "Key is required" }, { status: 400 });
                }

                const secrets = await loadSecrets();
                delete secrets[key];
                await saveSecrets(secrets);

                // Also remove from process.env
                delete process.env[key];

                return Response.json({ success: true });
            } catch (error) {
                console.error("[Secrets] Error deleting secret:", error);
                return Response.json({ error: "Failed to delete secret" }, { status: 500 });
            }
        },
    },
};

function maskSecret(value: string): string {
    if (value.length <= 8) {
        return "••••••••";
    }
    const prefix = value.slice(0, 12);
    return `${prefix}${"•".repeat(Math.min(20, value.length - 12))}`;
}
