# Prompt Copier

A SillyTavern extension that lets you copy prompts from your current Chat Completion preset into a different preset — no manual re-typing or re-adding required.

## Features

- Pick one, several, or all prompts from your currently active preset via checkboxes
- Pick any other preset from your existing preset list as the copy target
- Automatically switches presets and re-creates each selected prompt for you
- Falls back to copying prompt content to your clipboard if it can't find ST's internal prompt form (so you're never stuck with nothing)

## Installation

1. Download this repo as a ZIP (or `git clone` it) into your SillyTavern extensions folder:
   ```
   SillyTavern/data/default-user/extensions/prompt-copier/
   ```
   The folder should directly contain `manifest.json`, `index.js`, and `style.css` — not a nested subfolder.
2. Fully restart SillyTavern via `start.bat` (or your equivalent launch script). A browser refresh alone won't pick it up.
3. Go to the **Extensions** panel in ST and look for **Prompt Copier** in the list.

## How to use

1. Open the **Chat Completion → Prompts** panel first, so the prompt list is loaded on the page.
2. Open the Extensions panel → **Prompt Copier** → click **Open Prompt Copier**.
3. Check the boxes for the prompt(s) you want to copy (or use Select all / Select none).
4. Choose the target preset from the dropdown.
5. Click **Copy Selected →**. It'll switch presets and add each prompt automatically.

If a prompt can't be auto-added (ST's UI structure varies a bit between versions), its content is copied to your clipboard instead so you can paste it in manually — you'll see a status message either way.

## Preset Merger (the reliable option)

`tool/preset-merger.html` does the same job by editing preset files directly instead of automating SillyTavern's interface. Open it in any browser — it runs locally, nothing is uploaded anywhere.

1. Export both presets from SillyTavern (Chat Completion preset dropdown → export)
2. Load the source preset, then the target preset
3. Tick the prompts you want, click **Merge and download**
4. Import the downloaded file back into SillyTavern

Because it writes both `prompts[]` and `prompt_order[]`, copied prompts actually appear in the list rather than sitting invisible in the file. It also gives a copy a fresh identifier if the target already uses that one, so nothing gets overwritten.

This is the recommended path. The extension below is more convenient when it works, but depends on SillyTavern's interface staying put.

## Known limitations

- Depends on SillyTavern's Prompt Manager DOM structure. If ST updates its UI significantly, some selectors in `index.js` (search for the `SEL` object near the top) may need small tweaks.
- If nothing happens when you open the tool, make sure you've opened the Prompts panel at least once first — the extension reads live from that list.
- If prompts aren't detected or the "add prompt" step fails, open your browser console (F12) and check for errors — that'll usually point to which selector needs updating.

## License

Do whatever you want with it, just don't sell it lol.
