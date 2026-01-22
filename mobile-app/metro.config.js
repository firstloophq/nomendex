const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Add html as an asset extension
config.resolver.assetExts.push("html");

module.exports = config;
