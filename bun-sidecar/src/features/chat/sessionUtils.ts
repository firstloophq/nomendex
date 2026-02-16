// Session utility functions for message reconstruction

import type { SessionMetadata } from "./index";
export type { SessionMetadata };

export type ContentBlock =
  | { type: "text"; content: string; id: string }
  | { type: "image"; content: string; id: string }
  | { type: "thinking"; content: string; id: string }
  | { type: "tool"; toolCall: ToolCall; id: string };

export type ToolCall = {
  id: string;
  name: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  blocks: ContentBlock[];
};

type SDKMessage = {
  type: string;
  subtype?: string;
  uuid?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    }>;
  };
};

// Reconstruct UI messages from Claude SDK JSONL messages
export function reconstructMessages(sdkMessages: SDKMessage[]): ChatMessage[] {
  const uiMessages: ChatMessage[] = [];
  let currentAssistantMessage: ChatMessage | null = null;

  for (const msg of sdkMessages) {
    // Skip system messages
    if (msg.type === "system") {
      continue;
    }

    // Handle user messages
    if (msg.type === "user") {
      const contentBlocks = Array.isArray(msg.message?.content)
        ? msg.message.content
        : [];

      // Check for tool results in this user message
      const toolResultBlocks = contentBlocks.filter(
        (block) => block.type === "tool_result"
      );

      // Update tool states with results
      if (toolResultBlocks.length > 0 && currentAssistantMessage) {
        for (const toolResult of toolResultBlocks) {
          const toolBlock = currentAssistantMessage.blocks.find(
            (b): b is Extract<ContentBlock, { type: "tool" }> =>
              b.type === "tool" && b.toolCall.id === toolResult.tool_use_id
          );
          if (toolBlock) {
            toolBlock.toolCall.state = toolResult.is_error ? "output-error" : "output-available";
            toolBlock.toolCall.output = toolResult.content;
            if (toolResult.is_error) {
              toolBlock.toolCall.errorText = String(toolResult.content);
            }
          }
        }
      }

      // Extract text content from the message
      let textContent = "";

      if (typeof msg.message === "string") {
        textContent = msg.message;
      } else {
        const textBlocks = contentBlocks.filter(
          (block) => block.type === "text"
        );
        textContent = textBlocks
          .map((block) => block.text || "")
          .join("\n");
      }

      // Skip user messages that are just tool results (no actual user text)
      if (!textContent) {
        continue;
      }

      const userMessage: ChatMessage = {
        id: msg.uuid || crypto.randomUUID(),
        role: "user",
        blocks: [
          {
            type: "text",
            content: textContent,
            id: `text-${msg.uuid || crypto.randomUUID()}`,
          },
        ],
      };
      uiMessages.push(userMessage);
      currentAssistantMessage = null; // Reset assistant message accumulator
      continue;
    }

    // Handle assistant messages
    if (msg.type === "assistant") {
      const messageContent = msg.message?.content || [];

      // If we don't have a current assistant message, create one
      if (!currentAssistantMessage) {
        currentAssistantMessage = {
          id: msg.uuid || crypto.randomUUID(),
          role: "assistant",
          blocks: [],
        };
        uiMessages.push(currentAssistantMessage);
      }

      // Extract blocks from assistant message
      const newBlocks: ContentBlock[] = [];

      for (let i = 0; i < messageContent.length; i++) {
        const block = messageContent[i];
        const blockId = `${msg.uuid}-${i}`;

        if (block.type === "thinking") {
          newBlocks.push({
            type: "thinking",
            content: block.thinking || "",
            id: blockId,
          });
        } else if (block.type === "text") {
          newBlocks.push({
            type: "text",
            content: block.text || "",
            id: blockId,
          });
        } else if (block.type === "tool_use" && block.id) {
          newBlocks.push({
            type: "tool",
            id: block.id,
            toolCall: {
              id: block.id,
              name: block.name || "unknown",
              state: "input-available",
              input: block.input,
            },
          });
        }
      }

      currentAssistantMessage.blocks.push(...newBlocks);
    }

    // Handle result messages (conversation complete)
    if (msg.type === "result") {
      // Just mark conversation as complete, don't modify content
      console.log("[SessionUtils] Conversation complete");
    }
  }

  return uiMessages;
}

// Extract first user message as session title
export function extractSessionTitle(sdkMessages: SDKMessage[]): string {
  const firstUserMessage = sdkMessages.find((msg) => msg.type === "user");
  if (firstUserMessage) {
    const content =
      typeof firstUserMessage.message === "string"
        ? firstUserMessage.message
        : (firstUserMessage.message?.content?.[0] as { text?: string })?.text || "";
    // Truncate to 60 characters
    return content.length > 60 ? content.slice(0, 60) + "..." : content;
  }
  return "Untitled Session";
}

// Count messages in session
export function countMessages(sdkMessages: SDKMessage[]): number {
  return sdkMessages.filter((msg) => msg.type === "user" || msg.type === "assistant").length;
}
