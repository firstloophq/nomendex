/**
 * FrontmatterPanel Component
 *
 * A collapsible panel for editing YAML frontmatter fields above the note editor.
 * Provides specialized inputs for reserved fields (project, tags) and
 * allows adding/removing custom key-value fields with autocomplete.
 */

import { useState, useEffect, useCallback, useRef, KeyboardEvent } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Plus, X, Settings2 } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { notesAPI } from "@/hooks/useNotesAPI";
import { cn } from "@/lib/utils";
import { TagInput } from "./TagInput";
import { ProjectInput } from "./ProjectInput";

// Reserved field names that have specialized UI and are handled separately
const RESERVED_FIELDS = ["tags", "project"];

interface CustomField {
    key: string;
    value: string;
}

interface FrontmatterPanelProps {
    frontMatter: Record<string, unknown> | undefined;
    tags: string[];
    project: string | null;
    onTagsChange: (tags: string[]) => void;
    onProjectChange: (project: string | null) => void;
    onFrontmatterChange: (frontMatter: Record<string, unknown>) => void;
}

export function FrontmatterPanel({
    frontMatter,
    tags,
    project,
    onTagsChange,
    onProjectChange,
    onFrontmatterChange,
}: FrontmatterPanelProps) {
    const { currentTheme } = useTheme();

    // Panel is collapsed by default when no custom fields exist
    const hasCustomFields = frontMatter && Object.keys(frontMatter).some(
        (key) => !RESERVED_FIELDS.includes(key)
    );
    const [isOpen, setIsOpen] = useState(hasCustomFields);

    // Custom fields (excluding reserved fields)
    const [customFields, setCustomFields] = useState<CustomField[]>([]);

    // State for adding new field
    const [isAddingField, setIsAddingField] = useState(false);
    const [newFieldKey, setNewFieldKey] = useState("");
    const [newFieldValue, setNewFieldValue] = useState("");

    // Autocomplete suggestions
    const [allFieldKeys, setAllFieldKeys] = useState<string[]>([]);
    const [fieldValueSuggestions, setFieldValueSuggestions] = useState<string[]>([]);

    const newKeyInputRef = useRef<HTMLInputElement>(null);
    const newValueInputRef = useRef<HTMLInputElement>(null);

    // Initialize custom fields from frontmatter
    useEffect(() => {
        if (frontMatter) {
            const fields: CustomField[] = [];
            for (const [key, value] of Object.entries(frontMatter)) {
                if (!RESERVED_FIELDS.includes(key)) {
                    fields.push({
                        key,
                        value: typeof value === "string" ? value : JSON.stringify(value),
                    });
                }
            }
            setCustomFields(fields);
        } else {
            setCustomFields([]);
        }
    }, [frontMatter]);

    // Load all field keys from all notes for autocomplete
    useEffect(() => {
        async function loadFieldKeys() {
            try {
                const keys = await notesAPI.getAllFrontmatterKeys();
                setAllFieldKeys(keys);
            } catch (error) {
                console.error("Failed to load frontmatter keys:", error);
            }
        }
        loadFieldKeys();
    }, []);

    // Load field value suggestions when key changes
    const loadValueSuggestions = useCallback(async (key: string) => {
        if (!key.trim()) {
            setFieldValueSuggestions([]);
            return;
        }
        try {
            const values = await notesAPI.getFrontmatterValues({ key });
            setFieldValueSuggestions(values);
        } catch (error) {
            console.error("Failed to load frontmatter values:", error);
            setFieldValueSuggestions([]);
        }
    }, []);

    // Build updated frontmatter from custom fields
    const buildFrontmatter = useCallback(
        (fields: CustomField[]): Record<string, unknown> => {
            const updated: Record<string, unknown> = {};

            // Add reserved fields
            if (tags.length > 0) {
                updated.tags = tags;
            }
            if (project) {
                updated.project = project;
            }

            // Add custom fields
            for (const field of fields) {
                if (field.key.trim()) {
                    updated[field.key] = field.value;
                }
            }

            return updated;
        },
        [tags, project]
    );

    // Handle adding a new custom field
    const handleAddField = () => {
        const trimmedKey = newFieldKey.trim();
        const trimmedValue = newFieldValue.trim();

        if (!trimmedKey) return;
        if (RESERVED_FIELDS.includes(trimmedKey.toLowerCase())) {
            return; // Don't allow reserved field names
        }

        // Check if field already exists
        if (customFields.some((f) => f.key === trimmedKey)) {
            return;
        }

        const newFields = [...customFields, { key: trimmedKey, value: trimmedValue }];
        setCustomFields(newFields);
        setNewFieldKey("");
        setNewFieldValue("");
        setIsAddingField(false);

        onFrontmatterChange(buildFrontmatter(newFields));
    };

    // Handle updating a custom field value
    const handleFieldValueChange = (index: number, newValue: string) => {
        const newFields = [...customFields];
        newFields[index] = { ...newFields[index], value: newValue };
        setCustomFields(newFields);
    };

    // Handle field value blur (save on blur)
    const handleFieldValueBlur = (_index: number) => {
        onFrontmatterChange(buildFrontmatter(customFields));
    };

    // Handle removing a custom field
    const handleRemoveField = (index: number) => {
        const newFields = customFields.filter((_, i) => i !== index);
        setCustomFields(newFields);
        onFrontmatterChange(buildFrontmatter(newFields));
    };

    // Get key autocomplete suggestion
    const keyAutocompleteSuggestion = newFieldKey.trim()
        ? allFieldKeys.find(
              (key) =>
                  key.toLowerCase().startsWith(newFieldKey.toLowerCase()) &&
                  !RESERVED_FIELDS.includes(key.toLowerCase()) &&
                  !customFields.some((f) => f.key === key)
          )
        : null;

    // Get value autocomplete suggestion
    const valueAutocompleteSuggestion = newFieldValue.trim() && fieldValueSuggestions.length > 0
        ? fieldValueSuggestions.find((v) => v.toLowerCase().startsWith(newFieldValue.toLowerCase()))
        : null;

    const handleKeyInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Tab" && keyAutocompleteSuggestion) {
            e.preventDefault();
            setNewFieldKey(keyAutocompleteSuggestion);
            loadValueSuggestions(keyAutocompleteSuggestion);
        } else if (e.key === "Enter" && newFieldKey.trim()) {
            e.preventDefault();
            // Move focus to value input
            newValueInputRef.current?.focus();
        } else if (e.key === "Escape") {
            e.preventDefault();
            setIsAddingField(false);
            setNewFieldKey("");
            setNewFieldValue("");
        }
    };

    const handleValueInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Tab" && valueAutocompleteSuggestion) {
            e.preventDefault();
            setNewFieldValue(valueAutocompleteSuggestion);
        } else if (e.key === "Enter") {
            e.preventDefault();
            handleAddField();
        } else if (e.key === "Escape") {
            e.preventDefault();
            setIsAddingField(false);
            setNewFieldKey("");
            setNewFieldValue("");
        }
    };

    // Focus key input when adding new field
    useEffect(() => {
        if (isAddingField) {
            setTimeout(() => newKeyInputRef.current?.focus(), 0);
        }
    }, [isAddingField]);

    // Filter key suggestions based on input
    const keySuggestions = newFieldKey.trim()
        ? allFieldKeys.filter(
              (key) =>
                  key.toLowerCase().includes(newFieldKey.toLowerCase()) &&
                  !RESERVED_FIELDS.includes(key.toLowerCase()) &&
                  !customFields.some((f) => f.key === key)
          ).slice(0, 5)
        : [];

    return (
        <div
            className="border-b"
            style={{
                backgroundColor: currentTheme.styles.surfacePrimary,
                borderColor: currentTheme.styles.borderDefault,
            }}
        >
            <Collapsible open={isOpen} onOpenChange={setIsOpen}>
                {/* Header row with reserved fields */}
                <div className="px-4 py-2 flex items-center gap-4">
                    <ProjectInput project={project} onProjectChange={onProjectChange} />
                    <TagInput tags={tags} onTagsChange={onTagsChange} placeholder="Add tag..." />

                    {/* Collapsible trigger for custom fields */}
                    <CollapsibleTrigger
                        className="ml-auto flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-50 hover:opacity-100 transition-opacity"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        <Settings2 className="h-3 w-3" />
                        <span>Fields</span>
                        <ChevronDown
                            className={cn(
                                "h-3 w-3 transition-transform",
                                !isOpen && "-rotate-90"
                            )}
                        />
                        {customFields.length > 0 && (
                            <span
                                className="ml-1 px-1.5 py-0.5 rounded-full text-[9px]"
                                style={{
                                    backgroundColor: currentTheme.styles.surfaceMuted,
                                    color: currentTheme.styles.contentSecondary,
                                }}
                            >
                                {customFields.length}
                            </span>
                        )}
                    </CollapsibleTrigger>
                </div>

                {/* Custom fields content */}
                <CollapsibleContent>
                    <div
                        className="px-4 pb-3 space-y-2"
                        style={{ borderTop: `1px dashed ${currentTheme.styles.borderDefault}` }}
                    >
                        {/* Existing custom fields */}
                        {customFields.map((field, index) => (
                            <div key={field.key} className="flex items-center gap-2">
                                <span
                                    className="text-xs font-medium shrink-0 w-24 truncate"
                                    style={{ color: currentTheme.styles.contentSecondary }}
                                    title={field.key}
                                >
                                    {field.key}
                                </span>
                                <input
                                    type="text"
                                    value={field.value}
                                    onChange={(e) => handleFieldValueChange(index, e.target.value)}
                                    onBlur={() => handleFieldValueBlur(index)}
                                    className="flex-1 px-2 py-1 text-xs rounded border outline-none focus:ring-1"
                                    style={{
                                        backgroundColor: currentTheme.styles.surfaceSecondary,
                                        borderColor: currentTheme.styles.borderDefault,
                                        color: currentTheme.styles.contentPrimary,
                                    }}
                                />
                                <button
                                    onClick={() => handleRemoveField(index)}
                                    className="opacity-40 hover:opacity-100 transition-opacity p-1"
                                    style={{ color: currentTheme.styles.contentTertiary }}
                                    aria-label={`Remove ${field.key} field`}
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>
                        ))}

                        {/* Add new field form */}
                        {isAddingField ? (
                            <div className="space-y-2 pt-2">
                                <div className="flex items-center gap-2">
                                    {/* Key input with ghost text autocomplete */}
                                    <div className="relative w-24 shrink-0">
                                        <div
                                            className="absolute inset-0 px-2 py-1 text-xs pointer-events-none flex items-center overflow-hidden"
                                        >
                                            <span style={{ color: currentTheme.styles.contentPrimary }}>{newFieldKey}</span>
                                            {keyAutocompleteSuggestion && (
                                                <span style={{ color: currentTheme.styles.contentTertiary, opacity: 0.6 }}>
                                                    {keyAutocompleteSuggestion.slice(newFieldKey.length)}
                                                </span>
                                            )}
                                        </div>
                                        <input
                                            ref={newKeyInputRef}
                                            type="text"
                                            value={newFieldKey}
                                            onChange={(e) => {
                                                setNewFieldKey(e.target.value);
                                                if (e.target.value.trim()) {
                                                    loadValueSuggestions(e.target.value);
                                                }
                                            }}
                                            onKeyDown={handleKeyInputKeyDown}
                                            placeholder="Key"
                                            className="w-full px-2 py-1 text-xs rounded border outline-none focus:ring-1"
                                            style={{
                                                backgroundColor: currentTheme.styles.surfaceSecondary,
                                                borderColor: currentTheme.styles.borderDefault,
                                                color: "transparent",
                                                caretColor: currentTheme.styles.contentPrimary,
                                            }}
                                        />
                                    </div>

                                    {/* Value input with ghost text autocomplete */}
                                    <div className="relative flex-1">
                                        <div
                                            className="absolute inset-0 px-2 py-1 text-xs pointer-events-none flex items-center overflow-hidden"
                                        >
                                            <span style={{ color: currentTheme.styles.contentPrimary }}>{newFieldValue}</span>
                                            {valueAutocompleteSuggestion && (
                                                <span style={{ color: currentTheme.styles.contentTertiary, opacity: 0.6 }}>
                                                    {valueAutocompleteSuggestion.slice(newFieldValue.length)}
                                                </span>
                                            )}
                                        </div>
                                        <input
                                            ref={newValueInputRef}
                                            type="text"
                                            value={newFieldValue}
                                            onChange={(e) => setNewFieldValue(e.target.value)}
                                            onKeyDown={handleValueInputKeyDown}
                                            placeholder="Value"
                                            className="w-full px-2 py-1 text-xs rounded border outline-none focus:ring-1"
                                            style={{
                                                backgroundColor: currentTheme.styles.surfaceSecondary,
                                                borderColor: currentTheme.styles.borderDefault,
                                                color: "transparent",
                                                caretColor: currentTheme.styles.contentPrimary,
                                            }}
                                        />
                                    </div>

                                    <button
                                        onClick={() => {
                                            setIsAddingField(false);
                                            setNewFieldKey("");
                                            setNewFieldValue("");
                                        }}
                                        className="opacity-40 hover:opacity-100 transition-opacity p-1"
                                        style={{ color: currentTheme.styles.contentTertiary }}
                                        aria-label="Cancel"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>

                                {/* Key suggestions */}
                                {keySuggestions.length > 0 && newFieldKey && (
                                    <div className="flex flex-wrap items-center gap-x-1 text-xs" style={{ color: currentTheme.styles.contentTertiary }}>
                                        <span>Suggestions:</span>
                                        {keySuggestions.map((key, index) => (
                                            <span key={key} className="flex items-center">
                                                <button
                                                    onClick={() => {
                                                        setNewFieldKey(key);
                                                        loadValueSuggestions(key);
                                                        newValueInputRef.current?.focus();
                                                    }}
                                                    className="hover:underline"
                                                    style={{ color: currentTheme.styles.contentAccent }}
                                                >
                                                    {key}
                                                </button>
                                                {index < keySuggestions.length - 1 && (
                                                    <span className="mx-1">·</span>
                                                )}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {/* Keyboard hints */}
                                <div
                                    className="text-[10px] flex gap-x-3"
                                    style={{ color: currentTheme.styles.contentTertiary }}
                                >
                                    <span>
                                        <kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: currentTheme.styles.surfaceSecondary }}>Tab</kbd> autocomplete
                                    </span>
                                    <span>
                                        <kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: currentTheme.styles.surfaceSecondary }}>Enter</kbd> add
                                    </span>
                                    <span>
                                        <kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: currentTheme.styles.surfaceSecondary }}>Esc</kbd> cancel
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setIsAddingField(true)}
                                className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-50 hover:opacity-100 transition-opacity pt-1"
                                style={{ color: currentTheme.styles.contentTertiary }}
                            >
                                <Plus className="h-2.5 w-2.5" />
                                Add field
                            </button>
                        )}
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}
