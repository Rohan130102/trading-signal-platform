const { getDefaultConfig } = require('expo/metro-config');

// Expo works out the monorepo itself, so the shared domain package resolves through the workspace.
module.exports = getDefaultConfig(__dirname);
