import { useState, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

interface TagInputProps {
    value: string[];
    onChange: (tags: string[]) => void;
    availableTags: string[];
    placeholder?: string;
}

export function TagInput({ value, onChange, availableTags, placeholder = "Add tags..." }: TagInputProps) {
    const [inputValue, setInputValue] = useState("");
    const [showSuggestions, setShowSuggestions] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Filter suggestions based on input
    const suggestions = availableTags.filter(
        tag =>
            !value.includes(tag) &&
            tag.toLowerCase().includes(inputValue.toLowerCase())
    );

    const addTag = (tag: string) => {
        const trimmedTag = tag.trim();
        if (trimmedTag && !value.includes(trimmedTag)) {
            onChange([...value, trimmedTag]);
        }
        setInputValue("");
        setShowSuggestions(false);
    };

    const removeTag = (tagToRemove: string) => {
        onChange(value.filter(tag => tag !== tagToRemove));
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            if (inputValue.trim()) {
                addTag(inputValue);
            }
        } else if (e.key === "Backspace" && !inputValue && value.length > 0) {
            // Remove last tag if input is empty
            removeTag(value[value.length - 1]);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
        setShowSuggestions(e.target.value.length > 0);
    };

    const handleBlur = () => {
        // Add tag on blur if there's input
        setTimeout(() => {
            if (inputValue.trim()) {
                addTag(inputValue);
            }
            setShowSuggestions(false);
        }, 200);
    };

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-2 min-h-[2rem] p-2 border rounded-md bg-background">
                {value.map((tag, tagIndex) => (
                    <Badge
                        key={`${tag}-${tagIndex}`}
                        variant="secondary"
                        className="flex items-center gap-1 px-2 py-1 text-xs"
                    >
                        {tag}
                        <button
                            type="button"
                            onClick={() => removeTag(tag)}
                            className="hover:bg-muted rounded-full p-0.5 transition-colors"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </Badge>
                ))}
                <Input
                    ref={inputRef}
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onBlur={handleBlur}
                    onFocus={() => inputValue && setShowSuggestions(true)}
                    placeholder={value.length === 0 ? placeholder : ""}
                    className="flex-1 min-w-[120px] border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-6"
                />
            </div>

            {showSuggestions && suggestions.length > 0 && (
                <div className="border rounded-md bg-popover p-2 shadow-md max-h-40 overflow-y-auto">
                    <div className="text-xs text-muted-foreground mb-1 px-2">Suggestions:</div>
                    <div className="flex flex-wrap gap-1">
                        {suggestions.map((tag, tagIndex) => (
                            <Badge
                                key={`${tag}-${tagIndex}`}
                                variant="outline"
                                className="cursor-pointer hover:bg-accent text-xs"
                                onClick={() => addTag(tag)}
                            >
                                {tag}
                            </Badge>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
