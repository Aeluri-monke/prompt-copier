import { extension_settings, getContext } from "../../../extensions.js";
import { eventSource, event_types, saveSettingsDebounced } from "../../../../script.js";

const MODULE = "prompt_copier";
const VERSION = "1.0.1";
const defaultSettings = { lastTarget: "" };

// Selectors used to read the Chat Completion Prompt Manager UI.
// If ST changes its markup these are the first things to re-check.
const SEL = {
    presetDropdown: "#settings_preset_openai",
    promptList: "#completion_prompt_manager_list",
    promptItem: ".completion_prompt_manager_prompt",
    promptName: ".completion_prompt_manager_prompt_name",
    // clicking a prompt row opens the edit popup with these fields
    editPopup: "#prompt-manager-popup, #completion_prompt_manager_popup",
    editNameInput: "#prompt-manager-popup-entry-form-name, #completion_prompt_manager_popup_entry_form_name",
    editContentArea: "#prompt-manager-popup-entry-form-prompt, #completion_prompt_manager_popup_entry_form_prompt",
    editSaveBtn: "#prompt-manager-popup-entry-form-save, .prompt-manager-popup-entry-form-save",
    editCloseBtn: "#prompt-manager-popup-close, .prompt-manager-popup-close",
    addPromptBtn: 'a.fa-plus-square[title="New prompt"], a[title="New prompt"], #prompt_manager_add, .prompt-manager-add',
};

function getSettings() {
    if (extension_settings[MODULE] === undefined) {
        extension_settings[MODULE] = structuredClone(defaultSettings);
    }
    for (const key in defaultSettings) {
        if (extension_settings[MODULE][key] === undefined) {
            extension_settings[MODULE][key] = defaultSettings[key];
        }
    }
    return extension_settings[MODULE];
}

function toast(type, msg) {
    try {
        if (typeof toastr !== "undefined") {
            toastr[type]?.(msg, "Prompt Copier");
            return;
        }
    } catch {}
    console.log(`[Prompt Copier] ${type}: ${msg}`);
}

function qAll(sel) {
    return Array.from(document.querySelectorAll(sel));
}
function q(sel) {
    return document.querySelector(sel);
}

function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
}

// Poll for an element that may render late (e.g. after a preset switch
// re-renders the prompt manager). Returns the element or null on timeout.
async function waitFor(selector, timeoutMs = 3000, stepMs = 100) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const el = q(selector);
        if (el && el.offsetParent !== null) return el;
        await sleep(stepMs);
    }
    return q(selector) || null;
}

// Poll for an element to appear instead of guessing a fixed delay.
async function waitFor(sel, timeoutMs = 4000, intervalMs = 150) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const el = q(sel);
        if (el) return el;
        await sleep(intervalMs);
    }
    return null;
}

// --- Read prompts from the currently-active preset's Prompt Manager list ---
function readPromptList() {
    const list = q(SEL.promptList);
    if (!list) return [];
    return qAll(SEL.promptItem).map((el, idx) => {
        const nameEl = el.querySelector(SEL.promptName) || el;
        return {
            index: idx,
            el,
            name: (nameEl.textContent || "").trim() || `Prompt ${idx + 1}`,
            identifier: el.getAttribute("data-pm-identifier") || el.dataset?.pmIdentifier || "",
        };
    });
}

// Click a prompt row to open its edit popup, grab the content, close popup.
async function readPromptContent(promptEl) {
    promptEl.click();
    const popup = await waitFor(SEL.editPopup, 3000);
    if (!popup) {
        toast("warning", "Couldn't find the prompt edit popup — selectors may need updating.");
        return null;
    }
    const nameInput = q(SEL.editNameInput);
    const contentArea = q(SEL.editContentArea);
    const name = nameInput ? nameInput.value : "";
    const content = contentArea ? contentArea.value : "";
    const closeBtn = q(SEL.editCloseBtn);
    if (closeBtn) closeBtn.click();
    else document.body.click();
    await sleep(150);
    return { name, content };
}

// Attempt to create a new prompt in whatever preset is currently active,
// using ST's own "add prompt" popup form.
async function injectPrompt(promptData) {
    const addBtn = await waitFor(SEL.addPromptBtn, 4000);
    if (!addBtn) {
        toast("error", "Couldn't find the 'Add Prompt' button — falling back to clipboard for this one.");
        await navigator.clipboard.writeText(promptData.content);
        return false;
    }
    addBtn.click();
    const nameInput = await waitFor(SEL.editNameInput, 3000);
    const contentArea = q(SEL.editContentArea);
    if (!nameInput || !contentArea) {
        toast("error", "Couldn't find the new-prompt form fields — copying content to clipboard instead.");
        await navigator.clipboard.writeText(promptData.content);
        return false;
    }
    nameInput.value = promptData.name;
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    contentArea.value = promptData.content;
    contentArea.dispatchEvent(new Event("input", { bubbles: true }));
    const saveBtn = q(SEL.editSaveBtn);
    if (saveBtn) {
        saveBtn.click();
        await sleep(200);
        return true;
    }
    toast("warning", "Filled the form but couldn't find a Save button — please click Save manually.");
    return false;
}

function switchToPreset(presetName) {
    const dropdown = q(SEL.presetDropdown);
    if (!dropdown) {
        toast("error", "Couldn't find the Chat Completion preset dropdown.");
        return false;
    }
    const opt = Array.from(dropdown.options).find((o) => o.textContent.trim() === presetName || o.value === presetName);
    if (!opt) {
        toast("error", `Couldn't find preset "${presetName}" in the dropdown.`);
        return false;
    }
    dropdown.value = opt.value;
    dropdown.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
}

// Switching presets can also swap the linked Connection Profile, since ST's
// Connection Manager binds profiles to presets. Snapshot before, restore after.
// Selector is unverified across ST versions — fails silently if not found.
const CONN_SEL = "#connection_profiles";

function snapshotConnectionProfile() {
    const el = q(CONN_SEL);
    return el ? el.value : null;
}

async function restoreConnectionProfile(saved) {
    if (saved === null) return;
    const el = q(CONN_SEL);
    if (!el || el.value === saved) return;
    el.value = saved;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(200);
}

function currentPresetName() {
    const dropdown = q(SEL.presetDropdown);
    if (!dropdown) return "(unknown)";
    return dropdown.options[dropdown.selectedIndex]?.textContent?.trim() || "(unknown)";
}

// --- Modal UI ---
function buildModal() {
    const overlay = document.createElement("div");
    overlay.className = "pc-overlay";

    const modal = document.createElement("div");
    modal.className = "pc-modal";

    const header = document.createElement("div");
    header.className = "pc-header";
    header.innerHTML = `<b>Prompt Copier</b>`;
    const closeX = document.createElement("div");
    closeX.className = "pc-close";
    closeX.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeX.addEventListener("click", () => overlay.remove());
    header.appendChild(closeX);

    const body = document.createElement("div");
    body.className = "pc-body";

    const sourceLabel = document.createElement("div");
    sourceLabel.className = "pc-source-label";
    sourceLabel.textContent = `Copying from: ${currentPresetName()}`;

    const listWrap = document.createElement("div");
    listWrap.className = "pc-list";

    const prompts = readPromptList();
    if (prompts.length === 0) {
        listWrap.innerHTML = `<div class="pc-empty">No prompts found. Open Chat Completion → Prompts panel first, then reopen this.</div>`;
    } else {
        prompts.forEach((p) => {
            const row = document.createElement("label");
            row.className = "pc-row";
            row.innerHTML = `<input type="checkbox" class="pc-check" /> <span>${p.name}</span>`;
            row.querySelector("input").dataset.idx = p.index;
            listWrap.appendChild(row);
        });
    }

    const selectAllRow = document.createElement("div");
    selectAllRow.className = "pc-selectall";
    selectAllRow.innerHTML = `<a href="#">Select all</a> · <a href="#" class="pc-none">Select none</a>`;
    selectAllRow.querySelector("a").addEventListener("click", (e) => {
        e.preventDefault();
        qAll(".pc-check", listWrap).forEach((c) => (c.checked = true));
    });
    selectAllRow.querySelector(".pc-none").addEventListener("click", (e) => {
        e.preventDefault();
        qAll(".pc-check", listWrap).forEach((c) => (c.checked = false));
    });

    const targetLabel = document.createElement("div");
    targetLabel.className = "pc-target-label";
    targetLabel.textContent = "Copy into preset:";

    const targetSelect = document.createElement("select");
    targetSelect.className = "pc-target-select text_pole";
    const srcDropdown = q(SEL.presetDropdown);
    if (srcDropdown) {
        Array.from(srcDropdown.options).forEach((o) => {
            const opt = document.createElement("option");
            opt.value = o.value;
            opt.textContent = o.textContent;
            targetSelect.appendChild(opt);
        });
    }
    const settings = getSettings();
    if (settings.lastTarget) targetSelect.value = settings.lastTarget;

    const actionRow = document.createElement("div");
    actionRow.className = "pc-actions";
    const copyBtn = document.createElement("button");
    copyBtn.className = "pc-copy-btn menu_button";
    copyBtn.textContent = "Copy Selected →";
    const status = document.createElement("div");
    status.className = "pc-status";

    copyBtn.addEventListener("click", async () => {
        const checked = qAll(".pc-check", listWrap).filter((c) => c.checked);
        if (checked.length === 0) {
            toast("warning", "Select at least one prompt first.");
            return;
        }
        const targetName = targetSelect.options[targetSelect.selectedIndex]?.textContent?.trim();
        const sourceName = currentPresetName();
        if (targetName === sourceName) {
            toast("warning", "Source and target preset are the same.");
            return;
        }
        settings.lastTarget = targetSelect.value;
        saveSettingsDebounced();

        copyBtn.disabled = true;
        status.textContent = "Reading selected prompts...";

        const promptEls = qAll(SEL.promptItem);
        const toCopy = [];
        for (const c of checked) {
            const idx = Number(c.dataset.idx);
            const el = promptEls[idx];
            if (!el) continue;
            const data = await readPromptContent(el);
            if (data) toCopy.push(data);
        }

        if (toCopy.length === 0) {
            status.textContent = "Couldn't read any prompt content. Aborted.";
            copyBtn.disabled = false;
            return;
        }

        const savedProfile = snapshotConnectionProfile();

        status.textContent = `Switching to "${targetName}"...`;
        const switched = switchToPreset(targetName);
        if (!switched) {
            status.textContent = "Failed to switch preset. Copy manually from clipboard instead.";
            copyBtn.disabled = false;
            return;
        }
        await waitFor(SEL.addPromptBtn, 5000);
        await sleep(200);

        let injected = 0;
        for (const p of toCopy) {
            status.textContent = `Adding "${p.name}"...`;
            const ok = await injectPrompt(p);
            if (ok) injected++;
        }

        await restoreConnectionProfile(savedProfile);

        status.textContent = `Done — ${injected}/${toCopy.length} added automatically.` +
            (injected < toCopy.length ? " Remaining ones were copied to your clipboard one at a time; paste manually." : "");
        copyBtn.disabled = false;
        toast("success", `Prompt Copier: ${injected}/${toCopy.length} prompts copied into "${targetName}".`);
    });

    actionRow.appendChild(copyBtn);

    body.append(sourceLabel, listWrap, selectAllRow, targetLabel, targetSelect, actionRow, status);
    modal.append(header, body);
    overlay.appendChild(modal);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
}

function addExtensionSettings() {
    const settingsContainer = document.getElementById("extensions_settings2");
    if (!settingsContainer) return;

    const inlineDrawer = document.createElement("div");
    inlineDrawer.classList.add("inline-drawer");
    settingsContainer.append(inlineDrawer);

    const inlineDrawerToggle = document.createElement("div");
    inlineDrawerToggle.classList.add("inline-drawer-toggle", "inline-drawer-header");

    const title = document.createElement("b");
    title.textContent = "Prompt Copier";

    const inlineDrawerIcon = document.createElement("div");
    inlineDrawerIcon.classList.add("inline-drawer-icon", "fa-solid", "fa-circle-chevron-down", "down");

    inlineDrawerToggle.append(title, inlineDrawerIcon);
    inlineDrawerToggle.addEventListener("click", function () {
        this.classList.toggle("open");
        inlineDrawerIcon.classList.toggle("down");
        inlineDrawerIcon.classList.toggle("up");
        inlineDrawerContent.classList.toggle("open");
    });

    const inlineDrawerContent = document.createElement("div");
    inlineDrawerContent.classList.add("inline-drawer-content");
    inlineDrawerContent.id = "pc_settings";
    inlineDrawerContent.innerHTML = `
        <div class="pc-desc">Copy selected prompts from your current Chat Completion preset into another preset.</div>
        <div class="pc-open-wrap"><button id="pc_open_btn" class="menu_button">Open Prompt Copier</button></div>
    `;

    inlineDrawer.append(inlineDrawerToggle, inlineDrawerContent);

    inlineDrawerContent.querySelector("#pc_open_btn").addEventListener("click", () => {
        try {
            buildModal();
        } catch (e) {
            toast("error", "Failed to open: " + e.message);
            console.error("[Prompt Copier]", e);
        }
    });
}

jQuery(() => {
    try {
        getSettings();
        addExtensionSettings();
        console.log(`[Prompt Copier] loaded. VERSION ${VERSION}`);
    } catch (e) {
        try {
            if (typeof toastr !== "undefined") {
                toastr.error?.("Prompt Copier: initialization error — " + e.message, "Prompt Copier");
            }
        } catch {}
        console.error("[Prompt Copier] init failed:", e);
    }
});
