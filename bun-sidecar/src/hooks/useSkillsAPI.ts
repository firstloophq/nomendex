import { Skill } from "@/features/skills";
import { SkillUpdateInfo } from "@/services/skills-types";

async function fetchAPI<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`/api/skills/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return response.json();
}

export const skillsAPI = {
    getSkills: () => fetchAPI<Skill[]>("list"),
    getPendingUpdates: () => fetchAPI<SkillUpdateInfo[]>("pending-updates"),
    applyUpdate: (params: { skillName: string }) =>
        fetchAPI<{ success: boolean }>("apply-update", params),
    applyAllUpdates: () =>
        fetchAPI<{ success: string[]; failed: string[] }>("apply-all-updates"),
};

export function useSkillsAPI() {
    return skillsAPI;
}
