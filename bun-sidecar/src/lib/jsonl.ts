import { existsSync, mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function readJSONL<T>(filePath: string): Promise<T[]> {
    if (!existsSync(filePath)) {
        return [];
    }
    const content = await Bun.file(filePath).text();
    return content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
}

export async function appendJSONL(filePath: string, data: object): Promise<void> {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    const line = JSON.stringify(data) + "\n";
    await appendFile(filePath, line);
}

export async function updateJSONL<T extends { id: string }>(
    filePath: string,
    id: string,
    updater: (item: T) => T
): Promise<void> {
    const items = await readJSONL<T>(filePath);
    const updatedItems = items.map((item) =>
        item.id === id ? updater(item) : item
    );
    const content = updatedItems.map((item) => JSON.stringify(item)).join("\n") + "\n";
    await Bun.write(filePath, content);
}
