import React, { useRef, useImperativeHandle, forwardRef, useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";

// Embedded editor HTML
const EDITOR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Markdown Editor</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        :root {
            --bg-color: #0d1117;
            --text-color: #c9d1d9;
            --border-color: #30363d;
            --selection-bg: #264f78;
        }

        html, body {
            height: 100%;
            width: 100%;
            background-color: var(--bg-color);
            color: var(--text-color);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 16px;
            line-height: 1.6;
            -webkit-text-size-adjust: 100%;
        }

        .container {
            display: flex;
            flex-direction: column;
            height: 100%;
            padding: 8px;
            padding-top: env(safe-area-inset-top, 8px);
            padding-bottom: env(safe-area-inset-bottom, 8px);
        }

        .toolbar {
            display: flex;
            gap: 8px;
            padding: 8px 0;
            border-bottom: 1px solid var(--border-color);
            margin-bottom: 8px;
            flex-wrap: wrap;
        }

        .toolbar-btn {
            background: #21262d;
            border: 1px solid var(--border-color);
            color: var(--text-color);
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            min-width: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .toolbar-btn:active {
            background: #30363d;
        }

        .editor-wrapper {
            flex: 1;
            position: relative;
            overflow: hidden;
        }

        #editor {
            width: 100%;
            height: 100%;
            background: transparent;
            border: none;
            color: var(--text-color);
            font-family: "SF Mono", SFMono-Regular, ui-monospace, monospace;
            font-size: 15px;
            line-height: 1.7;
            resize: none;
            outline: none;
            padding: 8px;
            -webkit-appearance: none;
        }

        #editor::selection {
            background: var(--selection-bg);
        }

        #editor::-webkit-scrollbar {
            width: 8px;
        }

        #editor::-webkit-scrollbar-track {
            background: transparent;
        }

        #editor::-webkit-scrollbar-thumb {
            background: var(--border-color);
            border-radius: 4px;
        }

        .status-bar {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            font-size: 12px;
            color: #8b949e;
            border-top: 1px solid var(--border-color);
            margin-top: 8px;
        }

        .dirty-indicator {
            color: #f0883e;
        }

        .saving-indicator {
            color: #58a6ff;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="toolbar">
            <button class="toolbar-btn" onclick="insertMarkdown('**', '**')" title="Bold">B</button>
            <button class="toolbar-btn" onclick="insertMarkdown('*', '*')" title="Italic"><em>I</em></button>
            <button class="toolbar-btn" onclick="insertMarkdown('\\\`', '\\\`')" title="Code">&lt;/&gt;</button>
            <button class="toolbar-btn" onclick="insertMarkdown('# ', '')" title="Heading">H</button>
            <button class="toolbar-btn" onclick="insertMarkdown('- ', '')" title="List">\u2022</button>
            <button class="toolbar-btn" onclick="insertMarkdown('- [ ] ', '')" title="Task">\u2610</button>
            <button class="toolbar-btn" onclick="insertMarkdown('[', '](url)')" title="Link">\uD83D\uDD17</button>
        </div>
        <div class="editor-wrapper">
            <textarea id="editor" placeholder="Start writing..."></textarea>
        </div>
        <div class="status-bar">
            <span id="status">Ready</span>
            <span id="word-count">0 words</span>
        </div>
    </div>

    <script>
        const editor = document.getElementById('editor');
        const statusEl = document.getElementById('status');
        const wordCountEl = document.getElementById('word-count');

        let isDirty = false;
        let originalContent = '';
        let debounceTimer = null;

        function init() {
            editor.addEventListener('input', handleInput);
            editor.addEventListener('keydown', handleKeyDown);
            updateWordCount();
        }

        function handleInput() {
            isDirty = editor.value !== originalContent;
            updateStatus();
            updateWordCount();

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                sendToNative('contentChange', { content: editor.value, isDirty: isDirty });
            }, 300);
        }

        function handleKeyDown(e) {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                save();
            }

            if (e.key === 'Tab') {
                e.preventDefault();
                insertAtCursor('    ');
            }
        }

        function insertMarkdown(before, after) {
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            const selectedText = editor.value.substring(start, end);
            const newText = before + selectedText + after;

            editor.setRangeText(newText, start, end, 'select');
            editor.focus();

            if (selectedText.length === 0) {
                editor.setSelectionRange(start + before.length, start + before.length);
            }

            handleInput();
        }

        function insertAtCursor(text) {
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            editor.setRangeText(text, start, end, 'end');
            handleInput();
        }

        function setContent(content) {
            editor.value = content;
            originalContent = content;
            isDirty = false;
            updateStatus();
            updateWordCount();
        }

        function getContent() {
            return editor.value;
        }

        function save() {
            sendToNative('save', { content: editor.value });
            statusEl.textContent = 'Saving...';
            statusEl.className = 'saving-indicator';
        }

        function markSaved() {
            originalContent = editor.value;
            isDirty = false;
            updateStatus();
        }

        function updateStatus() {
            if (isDirty) {
                statusEl.textContent = 'Modified';
                statusEl.className = 'dirty-indicator';
            } else {
                statusEl.textContent = 'Saved';
                statusEl.className = '';
            }
        }

        function updateWordCount() {
            const text = editor.value.trim();
            const words = text ? text.split(/\\s+/).length : 0;
            wordCountEl.textContent = words + ' word' + (words !== 1 ? 's' : '');
        }

        function sendToNative(type, data) {
            if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type: type }, data)));
            }
        }

        function handleNativeMessage(event) {
            try {
                const message = JSON.parse(event.data);

                switch (message.type) {
                    case 'setContent':
                        setContent(message.content || '');
                        break;
                    case 'getContent':
                        sendToNative('content', { content: getContent() });
                        break;
                    case 'markSaved':
                        markSaved();
                        break;
                    case 'focus':
                        editor.focus();
                        break;
                }
            } catch (e) {
                console.error('Failed to parse message:', e);
            }
        }

        window.addEventListener('message', handleNativeMessage);
        document.addEventListener('message', handleNativeMessage);

        window.addEventListener('load', function() {
            init();
            sendToNative('ready', {});
        });
    </script>
</body>
</html>`;

interface EditorMessage {
  type: "ready" | "contentChange" | "save" | "content";
  content?: string;
  isDirty?: boolean;
}

interface MarkdownEditorProps {
  initialContent?: string;
  onContentChange?: (content: string, isDirty: boolean) => void;
  onSave?: (content: string) => void;
  onReady?: () => void;
}

export interface MarkdownEditorRef {
  setContent: (content: string) => void;
  getContent: () => void;
  markSaved: () => void;
  focus: () => void;
}

export const MarkdownEditor = forwardRef<MarkdownEditorRef, MarkdownEditorProps>(
  function MarkdownEditor({ initialContent = "", onContentChange, onSave, onReady }, ref) {
    const webViewRef = useRef<WebView>(null);
    const isReady = useRef(false);
    const pendingContent = useRef<string | null>(initialContent);

    const sendMessage = useCallback((type: string, data: Record<string, string> = {}) => {
      if (webViewRef.current && isReady.current) {
        const message = JSON.stringify({ type, ...data });
        webViewRef.current.postMessage(message);
      }
    }, []);

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        try {
          const message = JSON.parse(event.nativeEvent.data) as EditorMessage;

          switch (message.type) {
            case "ready":
              isReady.current = true;
              // Send any pending content
              if (pendingContent.current !== null) {
                sendMessage("setContent", { content: pendingContent.current });
                pendingContent.current = null;
              }
              onReady?.();
              break;

            case "contentChange":
              onContentChange?.(message.content ?? "", message.isDirty ?? false);
              break;

            case "save":
              onSave?.(message.content ?? "");
              break;

            case "content":
              // Response to getContent request
              break;
          }
        } catch (error) {
          console.error("Failed to parse editor message:", error);
        }
      },
      [onContentChange, onSave, onReady, sendMessage]
    );

    useImperativeHandle(
      ref,
      () => ({
        setContent: (content: string) => {
          if (isReady.current) {
            sendMessage("setContent", { content });
          } else {
            pendingContent.current = content;
          }
        },
        getContent: () => {
          sendMessage("getContent");
        },
        markSaved: () => {
          sendMessage("markSaved");
        },
        focus: () => {
          sendMessage("focus");
        },
      }),
      [sendMessage]
    );

    return (
      <View style={styles.container}>
        <WebView
          ref={webViewRef}
          source={{ html: EDITOR_HTML }}
          style={styles.webview}
          onMessage={handleMessage}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          scrollEnabled={false}
          bounces={false}
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView={false}
          allowsBackForwardNavigationGestures={false}
        />
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: "#0d1117",
  },
});
