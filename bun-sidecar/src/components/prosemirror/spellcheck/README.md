# ProseMirror Spellcheck Plugin

A toggleable spellcheck plugin for ProseMirror that uses a custom browser-compatible spellcheck engine.

## Features

- **Client-side spell checking** using a custom engine (no network requests required after loading)
- **Toggleable** via command palette (disabled by default)
- **Visual indicators** for misspelled words (red wavy underline)
- **Correction suggestions** shown in popup when clicking misspelled words
- **Theme-aware** styling using the app's theme system

## Setup

### 1. Install Dependencies

```bash
cd bun-sidecar
bun install
```

### 2. Build Dictionary

```bash
bun run build-dictionary
```

This will download the Hunspell dictionary files from the Typo.js repository, expand all affix rules, and generate a pre-expanded JSON word list at `src/dictionaries/en_US.json`.

## Usage

### Toggling Spellcheck

1. Open a note in the editor
2. Open the command palette (Cmd+K)
3. Search for "Toggle Spellcheck"
4. Press Enter

Spellcheck is **disabled by default** to avoid performance issues on large documents.

### Correcting Misspelled Words

1. When spellcheck is enabled, misspelled words will be underlined with a red wavy line
2. Click on a misspelled word to see suggestions
3. Click a suggestion to replace the misspelled word

## Architecture

### Files

- `index.ts` - Main plugin file with word scanning and decoration logic
- `SpellcheckPopup.tsx` - React component for showing correction suggestions
- `spellcheck.css` - Styles for misspelled words and suggestion popup
- `@/lib/spellcheck/` - Custom spellcheck engine (browser-compatible)

### How It Works

1. **Dictionary Loading**: When spellcheck is first enabled, the plugin loads the pre-expanded dictionary from `/dictionaries/en_US.json`

2. **Word Scanning**: The plugin scans the document text and extracts words using a regex pattern

3. **Spell Checking**: Each word is checked against the dictionary using O(1) Set lookup

4. **Decorations**: Misspelled words are marked with inline decorations that apply the `.misspelled-word` CSS class

5. **Suggestions**: When a misspelled word is clicked, the engine generates suggestions using edit-distance algorithm (up to 5 suggestions shown)

6. **Replacement**: Clicking a suggestion replaces the misspelled word in the document

### Custom Spellcheck Engine

The spellcheck engine (`@/lib/spellcheck/`) is a browser-compatible replacement for typo-js:

- **Pre-expanded dictionary**: All affix rules are expanded at build time, not runtime
- **Hash-based lookup**: Uses `Set<string>` for O(1) word checks
- **Edit-distance suggestions**: Generates 1-edit variants, filters against dictionary, then 2-edit if needed

## Performance Considerations

- Dictionary loading happens asynchronously only when spellcheck is first enabled
- Pre-expanded dictionary means faster load times (no affix processing at runtime)
- Word scanning only runs when the document changes and spellcheck is enabled
- Decorations are efficiently mapped through transactions
- The dictionary is loaded once and reused across all documents

## Future Enhancements

- Add user dictionary support for custom words
- Support for multiple languages
- Grammar checking (would require switching to LanguageTool or similar)
- Keyboard shortcuts for navigating between misspelled words
- Right-click context menu for corrections
