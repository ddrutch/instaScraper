#!/usr/bin/env bash

# Test script for Instagram Reel Scraper
echo "🧪 Testing Instagram Reel Scraper"
echo "=================================="

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if Playwright browsers are installed
if [ ! -d "node_modules/playwright/.local-browsers" ] && [ ! -d "$HOME/.cache/ms-playwright" ]; then
    echo "🎭 Installing Playwright browsers..."
    npx playwright install chromium
fi

# Build the project
echo "🔨 Building project..."
npm run build

# Test with sample Instagram reel URL
echo "🧪 Running test with sample URL..."
echo '{"url": "https://www.instagram.com/reel/DBY2nwzpK9V/"}' > test_input.json

# Set environment variables for local testing
export APIFY_INPUT_PATH="./test_input.json"
export APIFY_DATASET_PATH="./apify_storage/datasets/default"
export APIFY_KEY_VALUE_STORE_PATH="./apify_storage/key_value_stores/default"

# Create storage directories
mkdir -p apify_storage/datasets/default
mkdir -p apify_storage/key_value_stores/default

echo "🚀 Starting scraper..."
npm run start:prod

echo "✅ Test completed! Check ./apify_storage/datasets/default/ for results."

# Clean up
rm -f test_input.json