import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { skillsAPI } from "./useSkillsAPI";

/**
 * Hook that checks for pending skill updates on mount and shows a toast notification.
 * Should be called once at the app root level.
 */
export function useSkillUpdates() {
    const hasChecked = useRef(false);

    useEffect(() => {
        // Only check once per app session
        if (hasChecked.current) {
            return;
        }
        hasChecked.current = true;

        async function checkForUpdates() {
            try {
                const updates = await skillsAPI.getPendingUpdates();

                if (updates.length === 0) {
                    return;
                }

                const count = updates.length;
                const skillNames = updates.map((u) => u.skillName).join(", ");

                toast(`${count} skill update${count > 1 ? "s" : ""} available`, {
                    description: skillNames,
                    action: {
                        label: "Update",
                        onClick: async () => {
                            const result = await skillsAPI.applyAllUpdates();

                            if (result.success.length > 0) {
                                toast.success(
                                    `Updated ${result.success.length} skill${result.success.length > 1 ? "s" : ""}`
                                );
                            }

                            if (result.failed.length > 0) {
                                toast.error(`Failed to update: ${result.failed.join(", ")}`);
                            }
                        },
                    },
                    duration: 15000, // 15 seconds
                });
            } catch (error) {
                console.error("[SkillUpdates] Failed to check for updates:", error);
            }
        }

        // Delay the check slightly to let the UI settle
        const timeoutId = setTimeout(checkForUpdates, 2000);

        return () => {
            clearTimeout(timeoutId);
        };
    }, []);
}
