import { useState, useEffect } from "react";

interface EnvConfig {
    suppressWarnings: boolean;
}

/**
 * Hook to fetch environment configuration from the server
 * @returns Environment configuration object or null if loading
 */
export function useEnvConfig() {
    const [config, setConfig] = useState<EnvConfig | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const response = await fetch("/api/env/config");
                if (response.ok) {
                    const data = await response.json();
                    setConfig(data);
                }
            } catch (error) {
                console.error("Failed to fetch environment config:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchConfig();
    }, []);

    return { config, loading };
}
