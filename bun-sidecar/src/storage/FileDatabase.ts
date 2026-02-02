import path from "path";
import { mkdir, readdir, unlink } from "node:fs/promises";

export interface DatabaseRecord {
    id: string;
    [key: string]: unknown;
}

export interface QueryOptions<T> {
    where?: Partial<T>;
    orderBy?: keyof T;
    order?: "asc" | "desc";
    limit?: number;
    offset?: number;
}

export class FileDatabase<T extends DatabaseRecord> {
    private basePath: string;
    private fileExtension: string = ".md";

    constructor(basePath: string) {
        this.basePath = basePath;
    }

    /**
     * Initialize the database directory
     */
    async initialize(): Promise<void> {
        await mkdir(this.basePath, { recursive: true });
    }

    /**
     * Convert a record to markdown with YAML frontmatter
     */
    private recordToFile(record: T): string {
        const { description, ...metadata } = record as Record<string, unknown>;

        // Build YAML frontmatter
        const yamlContent = Object.entries(metadata)
            .map(([key, value]) => {
                // Handle different value types
                if (value === null || value === undefined) {
                    return `${key}: null`;
                } else if (typeof value === "string") {
                    // Always quote empty strings or strings with special characters
                    if (value === "" || value.includes(":") || value.includes("\n") || value.includes("#")) {
                        return `${key}: "${value.replace(/"/g, '\\"')}"`;
                    }
                    return `${key}: ${value}`;
                } else if (typeof value === "boolean") {
                    return `${key}: ${value}`;
                } else if (value instanceof Date) {
                    return `${key}: ${value.toISOString()}`;
                } else {
                    return `${key}: ${JSON.stringify(value)}`;
                }
            })
            .join("\n");

        // Build the full file content
        let content = `---\n${yamlContent}\n---\n`;

        if (description) {
            content += `\n${description}\n`;
        }

        return content;
    }

    /**
     * Parse a markdown file with YAML frontmatter to a record
     */
    private fileToRecord(content: string): T {
        // Extract frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
            throw new Error("Invalid file format: missing frontmatter");
        }

        const yamlContent = frontmatterMatch[1];
        const bodyContent = content.slice(frontmatterMatch[0].length).trim();

        // Parse YAML frontmatter
        // @ts-ignore - Bun.YAML is available at runtime
        const metadata = (globalThis as any).Bun.YAML.parse(yamlContent) as Record<string, unknown>;

        // Convert numeric id to string if needed (for backward compatibility)
        if (typeof metadata.id === "number") {
            metadata.id = String(metadata.id);
        }

        // Note: We intentionally preserve null values to allow explicit field clearing
        // (e.g., clearing a dueDate field by setting it to null)

        // Add description from body if present
        if (bodyContent) {
            metadata.description = bodyContent;
        }

        return metadata as T;
    }

    /**
     * Get the file path for a record
     */
    private getFilePath(id: string): string {
        // Sanitize ID for filename
        const sanitizedId = id.replace(/[^a-zA-Z0-9-_]/g, "-");
        return path.join(this.basePath, `${sanitizedId}${this.fileExtension}`);
    }

    /**
     * Create a new record
     */
    async create(record: T): Promise<T> {
        const filePath = this.getFilePath(record.id);
        const content = this.recordToFile(record);

        await Bun.write(filePath, content);
        return record;
    }

    /**
     * Read a record by ID
     */
    async findById(id: string): Promise<T | null> {
        const filePath = this.getFilePath(id);

        try {
            const file = Bun.file(filePath);
            if (!(await file.exists())) {
                return null;
            }

            const content = await file.text();
            return this.fileToRecord(content);
        } catch (error) {
            console.error(`Error reading record ${id}:`, error);
            return null;
        }
    }

    /**
     * Update a record
     */
    async update(id: string, updates: Partial<T>): Promise<T | null> {
        const existing = await this.findById(id);
        if (!existing) {
            return null;
        }

        const updated = { ...existing, ...updates, id }; // Ensure ID doesn't change
        const filePath = this.getFilePath(id);
        const content = this.recordToFile(updated);

        await Bun.write(filePath, content);
        return updated;
    }

    /**
     * Delete a record
     */
    async delete(id: string): Promise<boolean> {
        const filePath = this.getFilePath(id);

        try {
            await unlink(filePath);
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return false;
            }
            throw error;
        }
    }

    /**
     * Find all records matching query options
     */
    async find(options: QueryOptions<T> = {}): Promise<T[]> {
        const files = await readdir(this.basePath);
        const records: T[] = [];

        // Read all markdown files
        for (const fileName of files) {
            if (!fileName.endsWith(this.fileExtension)) continue;

            const filePath = path.join(this.basePath, fileName);
            try {
                const content = await Bun.file(filePath).text();
                const record = this.fileToRecord(content);

                // Apply where filters
                if (options.where) {
                    let matches = true;
                    for (const [key, value] of Object.entries(options.where)) {
                        if (record[key as keyof T] !== value) {
                            matches = false;
                            break;
                        }
                    }
                    if (!matches) continue;
                }

                records.push(record);
            } catch (error) {
                console.error(`Error reading file ${fileName}:`, error);
            }
        }

        // Apply sorting
        if (options.orderBy) {
            records.sort((a, b) => {
                const aVal = a[options.orderBy as keyof T];
                const bVal = b[options.orderBy as keyof T];

                if (aVal < bVal) return options.order === "desc" ? 1 : -1;
                if (aVal > bVal) return options.order === "desc" ? -1 : 1;
                return 0;
            });
        }

        // Apply pagination
        let result = records;
        if (options.offset) {
            result = result.slice(options.offset);
        }
        if (options.limit) {
            result = result.slice(0, options.limit);
        }

        return result;
    }

    /**
     * Find all records (convenience method)
     */
    async findAll(): Promise<T[]> {
        return this.find();
    }

    /**
     * Count records matching query
     */
    async count(options: QueryOptions<T> = {}): Promise<number> {
        const records = await this.find({ ...options, limit: undefined, offset: undefined });
        return records.length;
    }

    /**
     * Check if a record exists
     */
    async exists(id: string): Promise<boolean> {
        const filePath = this.getFilePath(id);
        const file = Bun.file(filePath);
        return file.exists();
    }

    /**
     * Batch create multiple records
     */
    async createMany(records: T[]): Promise<T[]> {
        const results = await Promise.all(records.map((record) => this.create(record)));
        return results;
    }

    /**
     * Batch update multiple records
     */
    async updateMany(updates: Array<{ id: string; updates: Partial<T> }>): Promise<(T | null)[]> {
        const results = await Promise.all(updates.map(({ id, updates }) => this.update(id, updates)));
        return results;
    }

    /**
     * Clear all records (use with caution!)
     */
    async clear(): Promise<void> {
        const files = await readdir(this.basePath);

        await Promise.all(files.filter((f) => f.endsWith(this.fileExtension)).map((f) => unlink(path.join(this.basePath, f))));
    }
}
