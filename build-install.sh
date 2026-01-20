#!/bin/bash

# Build and Install Nomendex

echo "🔨 Building and installing Nomendex..."

# Remove existing app from Applications
echo "📦 Removing existing app from /Applications..."
rm -rf /Applications/Nomendex.app

# Build the new bundle
echo "🛠️  Building new bundle..."
cd mac-app && make && cd ..

# Move the new app to Applications
echo "📁 Moving new app to /Applications..."
cp -R mac-app/bundle/Nomendex.app /Applications/

echo "✅ Done! Nomendex has been installed to /Applications/"
echo "You can now run: open /Applications/Nomendex.app"