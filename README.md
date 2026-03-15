# Firefox Multicol Reader

<img src="icons/icon-128.png" width="128" alt="Firefox Multicol Reader icon">

A Firefox WebExtension that lets you pick the main content area on a page and read it in a fixed 1 / 2 / 3 column reader.

## Features

- Manual content selection with hover highlight
- Fixed reader window with 1, 2, or 3 columns
- Shared vertical reading progress across columns
- Wheel scrolling, arrow key paging, and keyboard shortcuts
- Hides small fixed overlays that get in the way

## Install For Development

1. Open Firefox and go to `about:debugging`.
2. Open `This Firefox`.
3. Click `Load Temporary Add-on`.
4. Select [manifest.json](manifest.json).

## Usage

1. Open any article page.
2. Click the extension toolbar button.
3. Move the pointer to highlight the main content container.
4. Click to enter reader mode.

Shortcuts in reader mode:

- `1` / `2` / `3`: switch column count
- `Wheel`, `ArrowUp`, `ArrowDown`, `PageUp`, `PageDown`, `Space`: scroll
- `ArrowLeft`, `ArrowRight`: page backward / forward
- `Esc`: exit reader mode

## Build XPI

Run this in the project root:

```bash
zip -r firefox-multicol-reader.xpi manifest.json background.js content-script.js reader.css icons -x "*.DS_Store"
```

## Notes

- The extension currently works best on article-style pages.
- Some site-specific layouts may still need targeted adjustments.
- This version is tuned for common blog and docs layouts, including Quarto-style content pages.
