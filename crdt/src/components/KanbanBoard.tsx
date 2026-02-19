import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardEditor } from "@/components/CardEditor";
import { useKanbanCRDT } from "@/hooks/useKanbanCRDT";
import type { UserInfo } from "@/crdt/network/awareness";

function PresenceDots(props: { viewers: ReadonlyArray<UserInfo> }) {
  if (props.viewers.length === 0) return null;
  return (
    <div className="flex -space-x-1">
      {props.viewers.slice(0, 3).map((viewer, i) => (
        <span
          key={i}
          title={viewer.name}
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-medium text-white border border-background"
          style={{ backgroundColor: viewer.color }}
        >
          {viewer.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {props.viewers.length > 3 && (
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-medium border border-background bg-muted text-muted-foreground">
          +{props.viewers.length - 3}
        </span>
      )}
    </div>
  );
}

export function KanbanBoard() {
  const kanban = useKanbanCRDT();
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [newColumnName, setNewColumnName] = useState("");
  const [addingCardToColumn, setAddingCardToColumn] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [draggedCard, setDraggedCard] = useState<{ cardId: string; fromColumn: string } | null>(null);

  // Send presence when card selection changes
  useEffect(() => {
    kanban.sendPresence(selectedCardId);
  }, [selectedCardId, kanban.sendPresence]);

  const addColumn = () => {
    const name = newColumnName.trim();
    if (!name) return;
    kanban.doAddColumn(name);
    setNewColumnName("");
  };

  const removeColumn = (column: string) => {
    kanban.doRemoveColumn(column);
  };

  const addCard = (column: string) => {
    if (!newCardTitle.trim()) return;
    kanban.doCreateCard({ title: newCardTitle.trim(), column });
    setNewCardTitle("");
    setAddingCardToColumn(null);
  };

  const deleteCard = (cardId: string) => {
    kanban.doDeleteCard(cardId);
    if (selectedCardId === cardId) setSelectedCardId(null);
  };

  const handleDragStart = (cardId: string, fromColumn: string) => {
    setDraggedCard({ cardId, fromColumn });
  };

  const handleDrop = (toColumn: string, beforeCardId?: string) => {
    if (!draggedCard) return;
    kanban.doMoveCard({
      cardId: draggedCard.cardId,
      column: toColumn,
      beforeCardId,
    });
    setDraggedCard(null);
  };

  // If a card is selected, show the editor
  if (selectedCardId) {
    return (
      <div className="max-w-2xl mx-auto">
        <CardEditor
          cardId={selectedCardId}
          onClose={() => setSelectedCardId(null)}
          getCard={kanban.getCard}
          doUpdateFields={kanban.doUpdateFields}
          doAddTags={kanban.doAddTags}
          doRemoveTags={kanban.doRemoveTags}
          viewers={kanban.presenceByDoc.get(selectedCardId) ?? []}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">Kanban Board</h1>
        <div className="flex gap-2 ml-auto">
          <Input
            value={newColumnName}
            onChange={(e) => setNewColumnName(e.target.value)}
            placeholder="New column..."
            onKeyDown={(e) => e.key === "Enter" && addColumn()}
          />
          <Button variant="outline" onClick={addColumn}>
            Add Column
          </Button>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {kanban.boardState.columns.map((column) => {
          const cards = kanban.boardState.cardsByColumn[column] ?? [];
          return (
            <div
              key={column}
              className="flex-shrink-0 w-72"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(column);
              }}
            >
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">
                      {column}
                      <span className="ml-2 text-muted-foreground">
                        ({cards.length})
                      </span>
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeColumn(column)}
                      className="h-6 w-6 p-0"
                    >
                      x
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 min-h-[100px]">
                  {cards.map((card) => (
                    <div
                      key={card.cardId}
                      draggable
                      onDragStart={() => handleDragStart(card.cardId, column)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDrop(column, card.cardId);
                      }}
                      className="rounded-md border p-3 cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => setSelectedCardId(card.cardId)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">
                          {card.title || "Untitled"}
                        </span>
                        <div className="flex items-center gap-1 ml-2">
                          <PresenceDots viewers={kanban.presenceByDoc.get(card.cardId) ?? []} />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteCard(card.cardId);
                            }}
                            className="text-muted-foreground hover:text-foreground text-xs"
                          >
                            x
                          </button>
                        </div>
                      </div>
                      {card.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {card.description}
                        </p>
                      )}
                    </div>
                  ))}

                  {addingCardToColumn === column ? (
                    <div className="space-y-2">
                      <Input
                        value={newCardTitle}
                        onChange={(e) => setNewCardTitle(e.target.value)}
                        placeholder="Card title..."
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addCard(column);
                          if (e.key === "Escape") setAddingCardToColumn(null);
                        }}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => addCard(column)}>
                          Add
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setAddingCardToColumn(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => {
                        setAddingCardToColumn(column);
                        setNewCardTitle("");
                      }}
                    >
                      + Add Card
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          );
        })}

        {kanban.boardState.columns.length === 0 && (
          <div className="text-muted-foreground text-sm py-8 text-center w-full">
            No columns yet. Add a column to get started.
          </div>
        )}
      </div>
    </div>
  );
}
