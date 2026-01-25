# ProseMirror Spellcheck Plugin

A toggleable spellcheck plugin for ProseMirror that uses TypoJS for client-side spell checking.

## Features

- **Client-side spell checking** using TypoJS (no network requests required)
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

### 2. Download Dictionary Files

```bash
bun run download-dictionaries
```

This will download the English US dictionary files (`en_US.aff` and `en_US.dic`) from the wooorm/dictionaries repository.

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

### How It Works

1. **Dictionary Loading**: When spellcheck is first enabled, the plugin loads the dictionary files from `/dictionaries/en_US.aff` and `/dictionaries/en_US.dic`

2. **Word Scanning**: The plugin scans the document text and extracts words using a regex pattern

3. **Spell Checking**: Each word is checked against the TypoJS dictionary

4. **Decorations**: Misspelled words are marked with inline decorations that apply the `.misspelled-word` CSS class

5. **Suggestions**: When a misspelled word is clicked, TypoJS generates up to 5 suggestions which are shown in a popup

6. **Replacement**: Clicking a suggestion replaces the misspelled word in the document

## Performance Considerations

- Dictionary loading happens asynchronously only when spellcheck is first enabled
- Word scanning only runs when the document changes and spellcheck is enabled
- Decorations are efficiently mapped through transactions
- The dictionary is loaded once and reused across all documents

## Future Enhancements

- Add user dictionary support for custom words
- Support for multiple languages
- Grammar checking (would require switching to LanguageTool or similar)
- Keyboard shortcuts for navigating between misspelledwords
- Right-click context menu for corrections
