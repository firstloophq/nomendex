import { createContext, useContext, useCallback, useMemo } from "react";
import { ClerkProvider, useAuth, useUser } from "@clerk/clerk-react";

// The Clerk publishable key is loaded from environment or a well-known config location.
// In development, set CLERK_PUBLISHABLE_KEY env var.
// In production, the native app injects it.
const CLERK_PUBLISHABLE_KEY =
    (typeof window !== "undefined" && (window as unknown as Record<string, string>).__CLERK_PUBLISHABLE_KEY__) ||
    "pk_test_cG9zaXRpdmUtc2t1bmstMTEuY2xlcmsuYWNjb3VudHMuZGV2JA";

interface TeamAuthContextValue {
    isSignedIn: boolean;
    userId: string | null;
    userName: string | null;
    userImageUrl: string | null;
    getToken: () => Promise<string | null>;
    signOut: () => Promise<void>;
}

const TeamAuthContext = createContext<TeamAuthContextValue | null>(null);

/**
 * Inner provider that exposes Clerk auth state through our own context.
 */
function TeamAuthInner(props: { children: React.ReactNode }) {
    const { isSignedIn, getToken, signOut } = useAuth();
    const { user } = useUser();

    const getTokenStable = useCallback(async () => {
        try {
            return await getToken();
        } catch {
            return null;
        }
    }, [getToken]);

    const signOutStable = useCallback(async () => {
        await signOut();
    }, [signOut]);

    const value = useMemo<TeamAuthContextValue>(() => ({
        isSignedIn: isSignedIn ?? false,
        userId: user?.id ?? null,
        userName: user?.fullName ?? user?.username ?? null,
        userImageUrl: user?.imageUrl ?? null,
        getToken: getTokenStable,
        signOut: signOutStable,
    }), [isSignedIn, user?.id, user?.fullName, user?.username, user?.imageUrl, getTokenStable, signOutStable]);

    return (
        <TeamAuthContext.Provider value={value}>
            {props.children}
        </TeamAuthContext.Provider>
    );
}

/**
 * AuthProvider wraps children with Clerk auth. Always active — signing in is
 * optional, not forced. Users can be anonymous and still use local workspaces.
 */
export function AuthProvider(props: { children: React.ReactNode }) {
    if (!CLERK_PUBLISHABLE_KEY) {
        return <>{props.children}</>;
    }

    return (
        <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
            <TeamAuthInner>
                {props.children}
            </TeamAuthInner>
        </ClerkProvider>
    );
}

/**
 * Hook to access team auth state. Returns safe defaults when not signed in
 * or when no TeamAuthContext is provided.
 */
export function useTeamAuth(): TeamAuthContextValue {
    const context = useContext(TeamAuthContext);

    // Fallback when AuthProvider is not mounted (shouldn't happen now, but safe)
    if (!context) {
        return {
            isSignedIn: false,
            userId: null,
            userName: null,
            userImageUrl: null,
            getToken: async () => null,
            signOut: async () => {},
        };
    }

    return context;
}
