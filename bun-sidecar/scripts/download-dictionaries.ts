#!/usr/bin/env bun

/**
 * Download English US dictionary files for spellcheck
 */

const DICT_BASE_URL = "https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/en-US";
const DICT_DIR = "./src/dictionaries";

async function downloadFile(url: string, dest: string) {
    console.log(`Downloading ${url}...`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: ${response.statusText}`);
    }
    const data = await response.text();
    await Bun.write(dest, data);
    console.log(`Saved to ${dest}`);
}

async function main() {
    // Create dictionaries directory if it doesn't exist
    await Bun.write(`${DICT_DIR}/.gitkeep`, "");

    // Download .aff and .dic files
    await downloadFile(`${DICT_BASE_URL}/index.aff`, `${DICT_DIR}/en_US.aff`);
    await downloadFile(`${DICT_BASE_URL}/index.dic`, `${DICT_DIR}/en_US.dic`);

    console.log("Dictionary files downloaded successfully!");
}

main().catch(console.error);
