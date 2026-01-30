import { PluginBase, SerializablePlugin } from "@/types/Plugin";
import { z } from "zod";
import ProjectsBrowserView from "./projects-browser-view";
import ProjectDetailView from "./project-detail-view";

export { ProjectConfigSchema, type ProjectConfig } from "./project-types";

export const ProjectInfoSchema = z.object({
    name: z.string(),
    todoCount: z.number(),
    inProgressCount: z.number(),
    doneCount: z.number(),
    notesCount: z.number(),
});

export type ProjectInfo = z.infer<typeof ProjectInfoSchema>;

export const projectDetailViewPropsSchema = z.object({
    projectName: z.string(),
});
export type ProjectDetailViewProps = z.infer<typeof projectDetailViewPropsSchema>;

const views = {
    default: {
        id: "default",
        name: "Projects Browser",
        component: ProjectsBrowserView,
    },
    browser: {
        id: "browser",
        name: "Projects Browser",
        component: ProjectsBrowserView,
    },
    detail: {
        id: "detail",
        name: "Project Detail",
        component: ProjectDetailView,
        props: projectDetailViewPropsSchema,
    },
} as const;

export const projectsPluginSerial: SerializablePlugin = {
    id: "projects",
    name: "Projects",
    icon: "workflow",
};

export const ProjectsPluginBase: PluginBase = {
    id: projectsPluginSerial.id,
    name: projectsPluginSerial.name,
    icon: projectsPluginSerial.icon,
    mcpServers: {},
    views,
    functionStubs: {},
    commands: [],
};
