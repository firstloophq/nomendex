import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { UserInfo } from "@/crdt/network/awareness";

interface CardData {
  id: string;
  fields: Record<string, string>;
  tags: ReadonlyArray<string>;
  body: string;
  position: { column: string; order: string } | null;
}

export function CardEditor(props: {
  cardId: string;
  onClose: () => void;
  getCard: (cardId: string) => CardData | null;
  doUpdateFields: (cardId: string, fields: Record<string, string>) => void;
  doAddTags: (cardId: string, tags: ReadonlyArray<string>) => void;
  doRemoveTags: (cardId: string, tags: ReadonlyArray<string>) => void;
  viewers?: ReadonlyArray<UserInfo>;
}) {
  const [newTag, setNewTag] = useState("");
  const [newFieldKey, setNewFieldKey] = useState("");
  const [newFieldValue, setNewFieldValue] = useState("");

  // Read card data directly from CRDT state (always fresh)
  const card = props.getCard(props.cardId);

  const updateField = useCallback(
    (fieldName: string, value: string) => {
      props.doUpdateFields(props.cardId, { [fieldName]: value });
    },
    [props.cardId, props.doUpdateFields]
  );

  const addTag = useCallback(() => {
    if (!newTag.trim()) return;
    props.doAddTags(props.cardId, [newTag.trim()]);
    setNewTag("");
  }, [newTag, props.cardId, props.doAddTags]);

  const removeTag = useCallback(
    (tag: string) => {
      props.doRemoveTags(props.cardId, [tag]);
    },
    [props.cardId, props.doRemoveTags]
  );

  const addCustomField = useCallback(() => {
    if (!newFieldKey.trim()) return;
    updateField(newFieldKey.trim(), newFieldValue);
    setNewFieldKey("");
    setNewFieldValue("");
  }, [newFieldKey, newFieldValue, updateField]);

  if (!card) {
    return <div className="p-4">Card not found.</div>;
  }

  // Separate known fields from custom fields
  const knownFields = ["title", "description", "due_date"];
  const customFieldKeys = Object.keys(card.fields).filter(
    (k) => !knownFields.includes(k)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Edit Card</h2>
        <Button variant="outline" size="sm" onClick={props.onClose}>
          Close
        </Button>
      </div>

      {props.viewers && props.viewers.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Also viewing:</span>
          <div className="flex items-center gap-1">
            {props.viewers.map((viewer, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-white"
                style={{ backgroundColor: viewer.color }}
              >
                {viewer.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="card-title">Title</Label>
        <Input
          id="card-title"
          value={card.fields.title ?? ""}
          onChange={(e) => updateField("title", e.target.value)}
          placeholder="Card title..."
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="card-desc">Description</Label>
        <Textarea
          id="card-desc"
          value={card.fields.description ?? ""}
          onChange={(e) => updateField("description", e.target.value)}
          placeholder="Card description..."
          rows={3}
        />
      </div>

      {/* Due Date */}
      <div className="space-y-2">
        <Label htmlFor="card-due">Due Date</Label>
        <Input
          id="card-due"
          type="date"
          value={card.fields.due_date ?? ""}
          onChange={(e) => updateField("due_date", e.target.value)}
        />
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <Label>Tags</Label>
        <div className="flex flex-wrap gap-2">
          {card.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm"
            >
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="text-muted-foreground hover:text-foreground ml-1"
              >
                x
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Add tag..."
            onKeyDown={(e) => e.key === "Enter" && addTag()}
          />
          <Button variant="outline" size="sm" onClick={addTag}>
            Add
          </Button>
        </div>
      </div>

      {/* Custom Fields */}
      {customFieldKeys.length > 0 && (
        <div className="space-y-2">
          <Label>Custom Fields</Label>
          {customFieldKeys.map((key) => (
            <div key={key} className="flex gap-2 items-center">
              <span className="text-sm font-medium min-w-[100px]">{key}:</span>
              <Input
                value={card.fields[key] ?? ""}
                onChange={(e) => updateField(key, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Add Custom Field */}
      <div className="space-y-2">
        <Label>Add Custom Field</Label>
        <div className="flex gap-2">
          <Input
            value={newFieldKey}
            onChange={(e) => setNewFieldKey(e.target.value)}
            placeholder="Field name"
          />
          <Input
            value={newFieldValue}
            onChange={(e) => setNewFieldValue(e.target.value)}
            placeholder="Value"
          />
          <Button variant="outline" size="sm" onClick={addCustomField}>
            Add
          </Button>
        </div>
      </div>

      {/* Body (plain text for now, ProseMirror integration can come later) */}
      <div className="space-y-2">
        <Label htmlFor="card-body">Body</Label>
        <Textarea
          id="card-body"
          value={card.body}
          readOnly
          rows={6}
          placeholder="Card body (read-only, edit via collab editor)"
        />
      </div>
    </div>
  );
}
