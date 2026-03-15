#!/bin/bash

# if set version, update manifest.json and updates.json
if [ -n "$1" ]; then
  version="$1"
  echo "Updating version to $version..."
  # update manifest.json
  sed -i '' "s/\"version\": \".*\"/\"version\": \"$version\"/g" manifest.json
  # update updates.json
  sed -i '' "s/\"version\": \".*\"/\"version\": \"$version\"/g" dist/firefox/updates.json
fi

zip -r multicol-reader.xpi manifest.json background.js content-script.js reader.css icons -x "*.DS_Store";
echo "Built location: $(pwd)/multicol-reader.xpi"