#!/bin/bash

# Dave Evals Runner
# Usage: ./run-evals.sh [test-name]

echo "🧪 Dave AI Agent Evaluation Framework"
echo "====================================="

# Check if Dave is running
echo "🔍 Checking if Dave is running..."
if ! curl -s http://localhost:3000/dave > /dev/null; then
    echo "❌ Dave is not running on localhost:3000"
    echo "Please start Dave with: npm run dev"
    exit 1
fi

echo "✅ Dave is running"

# Set test auth token if provided
if [ -n "$TEST_AUTH_TOKEN" ]; then
    echo "🔑 Using provided auth token"
else
    echo "⚠️  No TEST_AUTH_TOKEN provided - using mock token"
fi

# Run the evals
echo "🚀 Running evaluations..."
echo ""

if [ -n "$1" ]; then
    echo "🎯 Running filtered tests: $1"
    node evals/test-runner.mjs --filter "$1"
else
    echo "🎯 Running all tests"
    node evals/test-runner.mjs
fi

echo ""
echo "✨ Evaluation complete!"
