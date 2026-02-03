import { createServiceLogger } from "@/lib/logger";
import { getSkillsPath, hasActiveWorkspace } from "@/storage/root-path";
import { SkillMetadata, SkillMetadataSchema, SkillUpdateCheckResult, SkillUpdateInfo } from "./skills-types";
import { mkdir, chmod } from "node:fs/promises";
import path from "path";
import yaml from "js-yaml";

const logger = createServiceLogger("DEFAULT-SKILLS");

/**
 * Embedded default skills - these are written to workspace on first init
 */
interface DefaultSkill {
    name: string;
    files: Record<string, string>; // filename -> content
}

const DEFAULT_SKILLS: DefaultSkill[] = [
    {
        name: "todos",
        files: {
            "SKILL.md": `---
name: todos
description: Manages project todos via REST API. Use when the user asks to create, view, update, or delete todos, list tasks by project, check task status, or filter by due date. Requires the Nomendex app to be running.
version: 2
---

# Todos Management

## Overview

Manages todos via the Nomendex REST API. The API handles all validation, ID generation, timestamps, and ordering automatically.

Todos are displayed in a kanban board UI with columns for each status. Users can drag and drop todos between columns to change their status, or use the API to update status programmatically.

## Todo Status

Each todo has a status field that controls which kanban column it appears in. The available statuses are:

| Status | Description |
|--------|-------------|
| \`todo\` | Not started - the default status for new todos |
| \`in_progress\` | Currently being worked on |
| \`done\` | Completed |
| \`later\` | Deferred or backlogged for future consideration |

When creating a todo, status defaults to \`todo\` if not specified. When updating a todo's status, the system automatically assigns a new order position at the end of the target column.

## Port Discovery

The server writes its port to a discoverable location. Extract it with:

\`\`\`bash
PORT=$(cat ~/Library/Application\\ Support/com.firstloop.nomendex/serverport.json | grep -o '"port":[0-9]*' | cut -d: -f2)
\`\`\`

## API Endpoints

All endpoints use POST with JSON body at \`http://localhost:$PORT\`:

| Endpoint | Description |
|----------|-------------|
| \`/api/todos/create\` | Create a new todo |
| \`/api/todos/list\` | List todos (with optional project filter) |
| \`/api/todos/get\` | Get a single todo by ID |
| \`/api/todos/update\` | Update a todo |
| \`/api/todos/delete\` | Delete a todo |
| \`/api/todos/projects\` | List all projects |
| \`/api/todos/tags\` | List all tags |
| \`/api/todos/archive\` | Archive a todo |
| \`/api/todos/unarchive\` | Unarchive a todo |
| \`/api/todos/archived\` | List archived todos |

## Create Todo

\`\`\`bash
curl -s -X POST "http://localhost:$PORT/api/todos/create" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "My todo", "project": "work"}'

# With explicit status
curl -s -X POST "http://localhost:$PORT/api/todos/create" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "My todo", "status": "in_progress", "project": "work"}'
\`\`\`

## List Todos

\`\`\`bash
# All active todos
curl -s -X POST "http://localhost:$PORT/api/todos/list" \\
  -H "Content-Type: application/json" \\
  -d '{}'

# Todos for a specific project
curl -s -X POST "http://localhost:$PORT/api/todos/list" \\
  -H "Content-Type: application/json" \\
  -d '{"project": "work"}'
\`\`\`

## Update Todo

\`\`\`bash
# Update status
curl -s -X POST "http://localhost:$PORT/api/todos/update" \\
  -H "Content-Type: application/json" \\
  -d '{"todoId": "todo-123", "updates": {"status": "done"}}'

# Update multiple fields
curl -s -X POST "http://localhost:$PORT/api/todos/update" \\
  -H "Content-Type: application/json" \\
  -d '{"todoId": "todo-123", "updates": {"title": "New title", "status": "in_progress"}}'
\`\`\`

## Important Constraints

**Project Creation is Disabled**: You cannot create new projects programmatically. 
Before assigning a todo to a project, verify the project exists using /api/todos/projects or /api/projects/list.
If the project doesn't exist, tell the user: "Please open the 'Projects' view from the sidebar and click 'New Project' to create it."

## How Claude Should Use This Skill

Always start by getting the server port, then use the appropriate endpoint.
`,
        },
    },
    {
        name: "manage-skills",
        files: {
            "SKILL.md": `---
name: manage-skills
description: Manages Claude Code skills - creates, updates, and maintains skills following established design principles. Use when the user asks to create a skill, update a skill, refactor a skill, or wants to teach Claude a new capability.
version: 3
---

# Skill Management

## Skill Design Principles

### 1. SKILL.md is Self-Contained
- Contains ALL information needed to use the skill
- Should be as minimal as possible while conveying complete information
- No need for separate README, USAGE, INSTALL, or CHANGELOG files

### 2. Single Script Design
- Optimize for ONE script per skill (not multiple scripts)
- Use command-line parameters for different operations
- Pattern: \`./script.sh <command> [arguments]\`

### 3. Minimal File Structure
\`\`\`
skill-name/
├── SKILL.md          # Required - complete documentation
└── script.sh         # Optional - single CLI if needed
\`\`\`

## SKILL.md Structure

Required frontmatter:
\`\`\`yaml
---
name: skill-name
description: What it does and when to use it. Use when [triggers].
version: 1
---
\`\`\`

## Creating a New Skill

1. Create directory in \`.claude/skills/skill-name/\`
2. Create SKILL.md with frontmatter and documentation
3. Optionally add a shell script for automation
4. Make scripts executable with \`chmod +x\`

## Rendering Custom UI

For rendering interactive HTML interfaces in chat, use the **create-interface** skill which provides comprehensive documentation on the \`mcp__noetect-ui__render_ui\` tool.
`,
        },
    },
    {
        name: "create-interface",
        files: {
            "SKILL.md": `---
name: create-interface
description: Renders interactive HTML interfaces in chat using the render_ui tool. Use when the user asks to display UI, create a widget, show a form, render a chart, build an interface, or display interactive content.
version: 1
---

# Create Interface

Render custom HTML interfaces directly in chat using the \`mcp__noetect-ui__render_ui\` tool. Perfect for forms, charts, tables, dashboards, and interactive widgets.

## Tool Usage

\`\`\`
Tool: mcp__noetect-ui__render_ui
Input:
  html: "<div class='card'><h2>Hello</h2></div>"   # Required - HTML content (body only, no <html> wrapper)
  title: "My Widget"                                # Optional - header above the UI
  height: 300                                       # Optional - fixed height in pixels (default: auto-resize)
\`\`\`

## Theme Integration

The UI automatically inherits the app's current theme. Use CSS variables for consistent styling across light/dark modes.

### Surface Colors (backgrounds)
| Variable | Usage |
|----------|-------|
| \`var(--surface-primary)\` | Main background |
| \`var(--surface-secondary)\` | Cards, elevated surfaces |
| \`var(--surface-tertiary)\` | Nested containers |
| \`var(--surface-accent)\` | Highlighted areas |
| \`var(--surface-muted)\` | Subtle backgrounds, code blocks |

### Content Colors (text)
| Variable | Usage |
|----------|-------|
| \`var(--content-primary)\` | Main text |
| \`var(--content-secondary)\` | Secondary text, labels |
| \`var(--content-tertiary)\` | Muted text, placeholders |
| \`var(--content-accent)\` | Highlighted text |

### Border Colors
| Variable | Usage |
|----------|-------|
| \`var(--border-default)\` | Standard borders |
| \`var(--border-accent)\` | Emphasized borders |

### Semantic Colors
| Variable | Usage |
|----------|-------|
| \`var(--semantic-primary)\` | Primary actions, links |
| \`var(--semantic-primary-foreground)\` | Text on primary background |
| \`var(--semantic-destructive)\` | Destructive actions, errors |
| \`var(--semantic-destructive-foreground)\` | Text on destructive background |
| \`var(--semantic-success)\` | Success states |
| \`var(--semantic-success-foreground)\` | Text on success background |

### Design Tokens
| Variable | Usage |
|----------|-------|
| \`var(--border-radius)\` | Standard corner radius |
| \`var(--shadow-sm)\` | Subtle shadow |
| \`var(--shadow-md)\` | Medium shadow |
| \`var(--shadow-lg)\` | Large shadow |

## Built-in Utility Classes

### Text Classes
- \`.text-primary\` - Main text color
- \`.text-secondary\` - Secondary text color
- \`.text-muted\` - Muted/tertiary text color
- \`.text-accent\` - Accent text color
- \`.text-success\` - Success color
- \`.text-destructive\` - Error/destructive color

### Background Classes
- \`.bg-primary\` - Primary surface background
- \`.bg-secondary\` - Secondary surface background
- \`.bg-muted\` - Muted surface background

### Container Classes
- \`.card\` - Styled container with secondary background, border, border-radius, and 16px padding

## Pre-styled Elements

These elements have default theme-aware styles applied automatically:

- **body** - System font, 14px, primary text color, 12px padding
- **a** - Primary semantic color
- **button** - Secondary background, border, border-radius, hover state
- **button.primary** - Primary semantic background with foreground text
- **button.destructive** - Destructive semantic background with foreground text
- **input, select, textarea** - Primary background, border, focus ring
- **table, th, td** - Full width, border-bottom on rows
- **code** - Monospace font, muted background, 2px/4px padding
- **pre** - Monospace font, muted background, 12px padding, overflow scroll

## Auto-Resize Behavior

By default, the UI auto-resizes to fit its content. The iframe:
1. Measures content height on load
2. Observes DOM mutations and resizes dynamically
3. Responds to window resize events

Set a fixed \`height\` parameter to disable auto-resize.

## Examples

### Simple Card
\`\`\`html
<div class="card">
  <h3 style="margin: 0 0 8px 0;">Status</h3>
  <p class="text-secondary" style="margin: 0;">All systems operational</p>
</div>
\`\`\`

### Form with Inputs
\`\`\`html
<div class="card">
  <h3 style="margin: 0 0 12px 0;">Contact</h3>
  <input type="text" placeholder="Name" style="width: 100%; margin-bottom: 8px;">
  <input type="email" placeholder="Email" style="width: 100%; margin-bottom: 8px;">
  <textarea placeholder="Message" style="width: 100%; height: 80px; margin-bottom: 12px;"></textarea>
  <button class="primary">Send</button>
</div>
\`\`\`

### Data Table
\`\`\`html
<table>
  <thead>
    <tr><th>Name</th><th>Status</th><th>Actions</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>Item 1</td>
      <td class="text-success">Active</td>
      <td><button>Edit</button></td>
    </tr>
    <tr>
      <td>Item 2</td>
      <td class="text-muted">Inactive</td>
      <td><button>Edit</button></td>
    </tr>
  </tbody>
</table>
\`\`\`

### Stats Dashboard
\`\`\`html
<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
  <div class="card" style="text-align: center;">
    <div style="font-size: 24px; font-weight: 600;">128</div>
    <div class="text-secondary">Users</div>
  </div>
  <div class="card" style="text-align: center;">
    <div style="font-size: 24px; font-weight: 600;">1.2k</div>
    <div class="text-secondary">Events</div>
  </div>
  <div class="card" style="text-align: center;">
    <div style="font-size: 24px; font-weight: 600;">99.9%</div>
    <div class="text-secondary">Uptime</div>
  </div>
</div>
\`\`\`

### Interactive with JavaScript
\`\`\`html
<div class="card">
  <div id="count" style="font-size: 32px; text-align: center; margin-bottom: 12px;">0</div>
  <div style="display: flex; gap: 8px; justify-content: center;">
    <button onclick="update(-1)">−</button>
    <button class="primary" onclick="update(1)">+</button>
  </div>
</div>
<script>
  let count = 0;
  function update(delta) {
    count += delta;
    document.getElementById('count').textContent = count;
  }
</script>
\`\`\`

## Security Notes

- UI renders in a **sandboxed iframe** with \`allow-scripts allow-forms\`
- **No access** to parent window, localStorage, cookies, or parent DOM
- Scripts execute within the iframe only
- Forms work but submissions stay within the iframe
- Safe for displaying user-generated or dynamic content
`,
        },
    },
    {
        name: "daily-notes",
        files: {
            "SKILL.md": `---
name: daily-notes
description: Manages daily notes with M-D-YYYY format (e.g., 1-1-2026.md). Use when the user asks to view recent notes, create daily notes, read today's notes, summarize the week, or references @notes/ or dates. Can fetch last 7 days of notes. Notes location is configurable in Settings > Storage.
version: 1
---

# Daily Notes Management

## Overview

This skill manages daily notes stored in the workspace's notes directory using the \`M-D-YYYY.md\` format (e.g., \`1-1-2026.md\`, \`12-31-2025.md\`).

## Date Format

All daily notes follow this format:
- **Format**: \`M-D-YYYY.md\`
- **No leading zeros**: \`1-1-2026.md\` not \`01-01-2026.md\`
- **Examples**:
  - January 1, 2026 -> \`1-1-2026.md\`
  - December 31, 2025 -> \`12-31-2025.md\`
  - March 5, 2026 -> \`3-5-2026.md\`

## Getting the Notes Directory

The notes location is configurable in Settings > Storage. To get the correct path, query the workspace paths API:

\`\`\`bash
curl http://localhost:1234/api/workspace/paths
# Returns: { "success": true, "data": { "notes": "/path/to/notes", ... } }
\`\`\`

Or use \`jq\` to extract just the notes path:
\`\`\`bash
NOTES_DIR=$(curl -s http://localhost:1234/api/workspace/paths | jq -r '.data.notes')
\`\`\`

## CLI Usage

The skill provides a shell script. Set the \`NOTES_DIR\` environment variable to the workspace's notes path (obtained from the API above).

\`\`\`bash
NOTES_DIR=/path/to/workspace/notes .claude/skills/daily-notes/daily-note.sh <command> [arguments]
\`\`\`

### Commands

#### get-today
Get or create today's daily note.
\`\`\`bash
./daily-note.sh get-today
\`\`\`

#### get-note [date]
Get a specific date's note.
\`\`\`bash
./daily-note.sh get-note 1-1-2026
\`\`\`

#### get-last-x [duration]
Get notes from the last N days.
\`\`\`bash
./daily-note.sh get-last-x 7days
./daily-note.sh get-last-x 30days
\`\`\`

#### get-range [start] [end]
Get notes between two dates (ISO format).
\`\`\`bash
./daily-note.sh get-range 2026-01-01 2026-01-07
\`\`\`

## How Claude Should Use This Skill

**Important**: Always set the \`NOTES_DIR\` environment variable to the workspace's notes path before running the script.

### When User Asks About Recent Work
\`\`\`
User: "What have I been working on this week?"
-> Run: NOTES_DIR=/path/to/notes ./daily-note.sh get-last-x 7days
-> Parse content and provide summary
\`\`\`

### When User Wants to Add to Today's Note
\`\`\`
User: "Add this to my daily note: Completed feature X"
-> Run: NOTES_DIR=/path/to/notes ./daily-note.sh get-today
-> Use Edit tool to append content
\`\`\`

## Best Practices

1. **Always set NOTES_DIR** - Don't rely on the default path
2. **Handle missing notes gracefully** - Not every day has a note
3. **Preserve existing content** - Use Edit tool, not Write when modifying
4. **Support natural language dates** - Convert to \`M-D-YYYY\` format
`,
            "daily-note.sh": `#!/bin/bash

# Daily Notes CLI
# Manages daily notes in M-D-YYYY format (e.g., 1-1-2026.md)

NOTES_DIR="\${NOTES_DIR:-$HOME/.mcpclient/notes}"
mkdir -p "$NOTES_DIR"

format_date() {
    local date_str="$1"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        date -j -f "%Y-%m-%d" "$date_str" "+%-m-%-d-%Y" 2>/dev/null
    else
        date -d "$date_str" "+%-m-%-d-%Y" 2>/dev/null
    fi
}

get_date_n_days_ago() {
    local days_ago="$1"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        date -v-"\${days_ago}"d "+%Y-%m-%d"
    else
        date -d "\${days_ago} days ago" "+%Y-%m-%d"
    fi
}

get_today() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        date "+%-m-%-d-%Y"
    else
        date "+%-m-%-d-%Y"
    fi
}

display_note() {
    local note_file="$1"
    local note_date="$2"
    local show_header="\${3:-true}"

    if [[ -f "$note_file" && -s "$note_file" ]]; then
        if [[ "$show_header" == "true" ]]; then
            echo ""
            echo "=== Notes from $note_date ==="
            echo ""
        fi
        cat "$note_file"
        if [[ "$show_header" == "true" ]]; then
            echo ""
            echo "---"
        fi
        return 0
    else
        return 1
    fi
}

cmd_get_today() {
    local TODAY=$(get_today)
    local NOTE_PATH="$NOTES_DIR/\${TODAY}.md"

    if [[ ! -f "$NOTE_PATH" ]]; then
        touch "$NOTE_PATH"
        echo "Created: $NOTE_PATH" >&2
    fi

    if [[ -s "$NOTE_PATH" ]]; then
        cat "$NOTE_PATH"
    fi
}

cmd_get_note() {
    local date_input="$1"
    if [[ -z "$date_input" ]]; then
        echo "Error: Date required" >&2
        exit 1
    fi
    local NOTE_FILE="$NOTES_DIR/\${date_input}.md"
    if display_note "$NOTE_FILE" "$date_input" "false"; then
        exit 0
    else
        echo "Error: No note found for date: $date_input" >&2
        exit 1
    fi
}

cmd_get_last_x() {
    local days_input="$1"
    if [[ -z "$days_input" ]]; then
        echo "Error: Duration required (e.g., 7days)" >&2
        exit 1
    fi
    local days="\${days_input//[^0-9]/}"
    echo "Fetching daily notes from the last $days days..."
    echo "==========================================="
    local FOUND_NOTES=0
    for ((i=0; i<days; i++)); do
        local DATE_ISO=$(get_date_n_days_ago "$i")
        local DATE_FORMATTED=$(format_date "$DATE_ISO")
        if [[ -n "$DATE_FORMATTED" ]]; then
            local NOTE_FILE="$NOTES_DIR/\${DATE_FORMATTED}.md"
            if display_note "$NOTE_FILE" "$DATE_FORMATTED"; then
                FOUND_NOTES=$((FOUND_NOTES + 1))
            fi
        fi
    done
    echo ""
    echo "Found $FOUND_NOTES note(s) from the last $days days."
}

COMMAND="\${1:-}"
case "$COMMAND" in
    get-today) cmd_get_today ;;
    get-note) cmd_get_note "$2" ;;
    get-last-x) cmd_get_last_x "$2" ;;
    *)
        echo "Daily Notes CLI"
        echo "Usage: $0 <command> [arguments]"
        echo "Commands: get-today, get-note [M-D-YYYY], get-last-x [Ndays]"
        exit 1
        ;;
esac
`,
        },
    },
];

/**
 * In-memory storage for pending updates.
 * This is populated during initialization and consumed by the UI.
 */
let pendingUpdates: SkillUpdateInfo[] = [];

/**
 * Parse SKILL.md frontmatter to extract metadata including version
 */
function parseSkillFrontmatter(content: string): SkillMetadata | null {
    const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
    const match = content.match(frontMatterRegex);

    if (!match) {
        return null;
    }

    try {
        const frontMatterYaml = match[1];
        const parsed = yaml.load(frontMatterYaml);
        const result = SkillMetadataSchema.safeParse(parsed);

        if (result.success) {
            return result.data;
        }

        logger.warn("Invalid skill frontmatter schema", { parsed, error: result.error });
        return null;
    } catch (error) {
        logger.error("Failed to parse skill frontmatter", { error });
        return null;
    }
}

/**
 * Get the version of an installed skill, or null if not installed
 */
async function getInstalledSkillVersion(skillName: string): Promise<number | null> {
    if (!hasActiveWorkspace()) {
        return null;
    }

    const skillPath = path.join(getSkillsPath(), skillName, "SKILL.md");
    const file = Bun.file(skillPath);

    if (!(await file.exists())) {
        return null;
    }

    try {
        const content = await file.text();
        const metadata = parseSkillFrontmatter(content);
        return metadata?.version ?? null;
    } catch {
        return null;
    }
}

/**
 * Get metadata for an embedded default skill
 */
function getDefaultSkillMetadata(skillName: string): SkillMetadata | null {
    const skill = DEFAULT_SKILLS.find((s) => s.name === skillName);
    if (!skill) return null;

    const skillMd = skill.files["SKILL.md"];
    if (!skillMd) return null;

    return parseSkillFrontmatter(skillMd);
}

/**
 * Write a default skill to the workspace
 */
async function writeDefaultSkill(skillName: string): Promise<boolean> {
    if (!hasActiveWorkspace()) {
        logger.warn("No active workspace, cannot write skill");
        return false;
    }

    const skill = DEFAULT_SKILLS.find((s) => s.name === skillName);
    if (!skill) {
        logger.error(`Default skill not found: ${skillName}`);
        return false;
    }

    const destPath = path.join(getSkillsPath(), skillName);

    try {
        // Create destination directory
        await mkdir(destPath, { recursive: true });

        // Write all files
        for (const [filename, content] of Object.entries(skill.files)) {
            const filePath = path.join(destPath, filename);
            await Bun.write(filePath, content);

            // Make shell scripts executable
            if (filename.endsWith(".sh")) {
                await chmod(filePath, 0o755);
            }

            logger.info(`Wrote ${filename} to ${destPath}`);
        }

        logger.info(`Successfully wrote skill: ${skillName}`);
        return true;
    } catch (error) {
        logger.error(`Failed to write skill: ${skillName}`, { error });
        return false;
    }
}

/**
 * Check for available skill updates
 */
async function checkForSkillUpdates(): Promise<SkillUpdateCheckResult> {
    const result: SkillUpdateCheckResult = {
        pendingUpdates: [],
        newSkills: [],
    };

    if (!hasActiveWorkspace()) {
        return result;
    }

    for (const skill of DEFAULT_SKILLS) {
        const defaultMetadata = getDefaultSkillMetadata(skill.name);
        if (!defaultMetadata) {
            logger.warn(`Could not read metadata for default skill: ${skill.name}`);
            continue;
        }

        const installedVersion = await getInstalledSkillVersion(skill.name);

        if (installedVersion === null) {
            // Skill not installed
            result.newSkills.push(skill.name);
        } else if (installedVersion < defaultMetadata.version) {
            // Update available
            result.pendingUpdates.push({
                skillName: skill.name,
                currentVersion: installedVersion,
                availableVersion: defaultMetadata.version,
            });
        }
    }

    return result;
}

/**
 * Initialize default skills on workspace startup.
 * - Writes any missing default skills
 * - Checks for available updates
 * - Returns list of pending updates for UI notification
 */
export async function initializeDefaultSkills(): Promise<SkillUpdateCheckResult> {
    if (!hasActiveWorkspace()) {
        logger.info("No active workspace, skipping default skills initialization");
        return { pendingUpdates: [], newSkills: [] };
    }

    logger.info("Initializing default skills...");

    // Check for new skills and updates
    const updateCheck = await checkForSkillUpdates();

    // Write any new (missing) skills
    for (const skillName of updateCheck.newSkills) {
        logger.info(`Installing new default skill: ${skillName}`);
        await writeDefaultSkill(skillName);
    }

    // Store pending updates for UI notification
    pendingUpdates = updateCheck.pendingUpdates;

    if (updateCheck.pendingUpdates.length > 0) {
        logger.info(`${updateCheck.pendingUpdates.length} skill update(s) available`);
    }

    logger.info(`Default skills initialization complete. Installed ${updateCheck.newSkills.length} new skill(s).`);

    return {
        pendingUpdates: updateCheck.pendingUpdates,
        newSkills: updateCheck.newSkills,
    };
}

/**
 * Get the list of pending skill updates
 */
export function getPendingSkillUpdates(): SkillUpdateInfo[] {
    return pendingUpdates;
}

/**
 * Apply a skill update (write new version to workspace)
 */
export async function applySkillUpdate(skillName: string): Promise<boolean> {
    const success = await writeDefaultSkill(skillName);

    if (success) {
        // Remove from pending updates
        pendingUpdates = pendingUpdates.filter((u) => u.skillName !== skillName);
    }

    return success;
}

/**
 * Apply all pending skill updates
 */
export async function applyAllSkillUpdates(): Promise<{ success: string[]; failed: string[] }> {
    const success: string[] = [];
    const failed: string[] = [];

    for (const update of [...pendingUpdates]) {
        const result = await applySkillUpdate(update.skillName);
        if (result) {
            success.push(update.skillName);
        } else {
            failed.push(update.skillName);
        }
    }

    return { success, failed };
}
