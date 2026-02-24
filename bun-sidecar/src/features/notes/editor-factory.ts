import { EditorState, type Plugin } from "prosemirror-state";
import { EditorView, type DirectEditorProps } from "prosemirror-view";
import { exampleSetup } from "prosemirror-example-setup";
import { sinkListItem, liftListItem, wrapInList } from "prosemirror-schema-list";
import { keymap } from "prosemirror-keymap";
import { chainCommands } from "prosemirror-commands";
import {
    InputRule,
    inputRules,
    wrappingInputRule,
    textblockTypeInputRule,
    smartQuotes,
    ellipsis,
    emDash,
} from "prosemirror-inputrules";
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

function isInsideListItem(state: EditorState): boolean {
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name === "list_item") return true;
    }
    return false;
}

function createNotesInputRulesPlugin(): Plugin {
    const rules: InputRule[] = [...smartQuotes, ellipsis, emDash];
    const blockquote = tableSchema.nodes.blockquote;
    const orderedList = tableSchema.nodes.ordered_list;
    const bulletList = tableSchema.nodes.bullet_list;
    const codeBlock = tableSchema.nodes.code_block;
    const heading = tableSchema.nodes.heading;

    if (blockquote) {
        rules.push(wrappingInputRule(/^\s*>\s$/, blockquote));
    }
    if (orderedList) {
        rules.push(
            wrappingInputRule(
                /^(\d+)\.\s$/,
                orderedList,
                (match) => ({ order: Number(match[1]) }),
                (match, node) => node.childCount + node.attrs.order === Number(match[1])
            )
        );
    }
    if (bulletList) {
        rules.push(wrappingInputRule(/^\s*([-+*])\s$/, bulletList));
    }
    if (codeBlock) {
        rules.push(textblockTypeInputRule(/^```$/, codeBlock));
    }
    if (heading) {
        rules.push(
            new InputRule(/^(#{1,6})\s$/, (state, match, start, end) => {
                if (isInsideListItem(state)) return null;
                const $start = state.doc.resolve(start);
                if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), heading)) {
                    return null;
                }
                return state.tr
                    .delete(start, end)
                    .setBlockType(start, start, heading, { level: match[1].length });
            })
        );
    }

    return inputRules({ rules });
}

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
    const notesInputRulesPlugin = createNotesInputRulesPlugin();
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

    const examplePlugins = exampleSetup({
        schema: tableSchema,
        floatingMenu: false,
        menuBar: params.includeMenuBar ?? true,
        history: !params.isCollabMode,
    }).filter((plugin) => !((plugin.spec as { isInputRules?: boolean }).isInputRules));

    const base = [
        ...getTablePlugins(),
        todoKeymap,
        ...(params.collabPlugins ?? []),
        notesInputRulesPlugin,
        ...examplePlugins,
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
