import { EditorState, type Plugin } from "prosemirror-state";
import { EditorView, type DirectEditorProps } from "prosemirror-view";
import { exampleSetup } from "prosemirror-example-setup";
import { sinkListItem, liftListItem, wrapInList } from "prosemirror-schema-list";
import { keymap } from "prosemirror-keymap";
import { chainCommands } from "prosemirror-commands";
import {
    tableSchema,
    getTablePlugins,
    fixTables,
    normalizeTableColumns,
} from "@/components/prosemirror/tables";
import { todoKeymap, todoPlugin } from "./simple-todo";
import {
    createWikiLinkPlugin,
    type WikiLinkPluginState,
} from "@/components/prosemirror/wiki-links";
import {
    createTagLinkPlugin,
    createTagDecorationPlugin,
    type TagLinkPluginState,
} from "@/components/prosemirror/tag-links";
import { createSearchPlugin } from "@/components/prosemirror/search-plugin";
import { createSpellcheckPlugin } from "@/components/prosemirror/spellcheck";
import { parseNotesMarkdown } from "./editor-markdown";

export interface CreateNotesEditorStateParams {
    markdown: string;
    isCollabMode: boolean;
    collabPlugins?: Plugin[];
    onWikiLinkStateChange?: (state: WikiLinkPluginState) => void;
    onTagLinkStateChange?: (state: TagLinkPluginState) => void;
    suggestionInlineActionsPlugin?: Plugin;
    includeSearchPlugin?: boolean;
    includeSpellcheckPlugin?: boolean;
    includeMenuBar?: boolean;
}

export function createNotesEditorPlugins(params: {
    isCollabMode: boolean;
    collabPlugins?: Plugin[];
    onWikiLinkStateChange?: (state: WikiLinkPluginState) => void;
    onTagLinkStateChange?: (state: TagLinkPluginState) => void;
    suggestionInlineActionsPlugin?: Plugin;
    includeSearchPlugin?: boolean;
    includeSpellcheckPlugin?: boolean;
    includeMenuBar?: boolean;
}) {
    const listIndentKeymap = keymap({
        "Tab": chainCommands(sinkListItem(tableSchema.nodes.list_item), wrapInList(tableSchema.nodes.bullet_list)),
        "Shift-Tab": liftListItem(tableSchema.nodes.list_item),
    });
    const wikiLinkPlugin = createWikiLinkPlugin({
        schema: tableSchema,
        onStateChange: params.onWikiLinkStateChange,
    });
    const tagLinkPlugin = createTagLinkPlugin({
        onStateChange: params.onTagLinkStateChange,
    });
    const tagDecorationPlugin = createTagDecorationPlugin();
    const searchPlugin = params.includeSearchPlugin === false ? null : createSearchPlugin();
    const spellcheckPlugin = params.includeSpellcheckPlugin === false ? null : createSpellcheckPlugin();

    const base = [
        ...getTablePlugins(),
        todoKeymap,
        ...(params.collabPlugins ?? []),
        ...exampleSetup({
            schema: tableSchema,
            floatingMenu: false,
            menuBar: params.includeMenuBar ?? true,
            history: !params.isCollabMode,
        }),
        listIndentKeymap,
        todoPlugin,
        wikiLinkPlugin,
        tagLinkPlugin,
        tagDecorationPlugin,
        ...(params.suggestionInlineActionsPlugin ? [params.suggestionInlineActionsPlugin] : []),
        ...(searchPlugin ? [searchPlugin] : []),
        ...(spellcheckPlugin ? [spellcheckPlugin] : []),
    ];

    return {
        plugins: base,
        wikiLinkPlugin,
        tagLinkPlugin,
        tagDecorationPlugin,
        searchPlugin,
        spellcheckPlugin,
        listIndentKeymap,
    };
}

export function createNotesEditorState(params: CreateNotesEditorStateParams): EditorState {
    const doc = parseNotesMarkdown(params.markdown);
    const { plugins } = createNotesEditorPlugins({
        isCollabMode: params.isCollabMode,
        collabPlugins: params.collabPlugins,
        onWikiLinkStateChange: params.onWikiLinkStateChange,
        onTagLinkStateChange: params.onTagLinkStateChange,
        suggestionInlineActionsPlugin: params.suggestionInlineActionsPlugin,
        includeSearchPlugin: params.includeSearchPlugin,
        includeSpellcheckPlugin: params.includeSpellcheckPlugin,
        includeMenuBar: params.includeMenuBar,
    });

    let state = EditorState.create({
        doc: doc!,
        plugins,
    });

    const fixTransaction = fixTables(state);
    if (fixTransaction) {
        state = state.apply(fixTransaction);
    }

    const normalizeTransaction = normalizeTableColumns(state);
    if (normalizeTransaction) {
        state = state.apply(normalizeTransaction);
    }

    return state;
}

export function createNotesEditorView(params: {
    mount: Element;
    state: EditorState;
    props?: Omit<DirectEditorProps, "mount" | "state">;
}): EditorView {
    return new EditorView(params.mount, {
        state: params.state,
        ...(params.props ?? {}),
    });
}
