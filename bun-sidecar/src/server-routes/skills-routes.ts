import { functions } from "@/features/skills/fx";
import {
    getPendingSkillUpdates,
    applySkillUpdate,
    applyAllSkillUpdates,
} from "@/services/default-skills";

export const skillsRoutes = {
    "/api/skills/list": {
        async POST() {
            console.log("[Skills Route] /api/skills/list called");
            const result = await functions.getSkills.fx({});
            console.log("[Skills Route] Returning", result.length, "skills");
            return Response.json(result);
        },
    },
    "/api/skills/pending-updates": {
        async POST() {
            console.log("[Skills Route] /api/skills/pending-updates called");
            const updates = getPendingSkillUpdates();
            console.log("[Skills Route] Returning", updates.length, "pending updates");
            return Response.json(updates);
        },
    },
    "/api/skills/apply-update": {
        async POST(req: Request) {
            const { skillName } = (await req.json()) as { skillName: string };
            console.log("[Skills Route] /api/skills/apply-update called for", skillName);
            const success = await applySkillUpdate(skillName);
            return Response.json({ success });
        },
    },
    "/api/skills/apply-all-updates": {
        async POST() {
            console.log("[Skills Route] /api/skills/apply-all-updates called");
            const result = await applyAllSkillUpdates();
            return Response.json(result);
        },
    },
};
