const extractBtn = document.getElementById("extract-btn");
const statusEl = document.getElementById("status");
const previewEl = document.getElementById("preview");
const notLinkedin = document.getElementById("not-linkedin");
const formatSelect = document.getElementById("format");
const layoutWarning = document.getElementById("layout-warning");
const folderPathEl = document.getElementById("folder-path");
const folderListEl = document.getElementById("folder-list");
const healthBox = document.getElementById("health-box");

let extractedData = null;
let nativeHostAvailable = null;
let currentFolder = "";
let vaultRoot = "";

const NATIVE_HOST = "com.schmusher.host";

// ── Content script injection ──

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "ping" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function sendToTab(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  await ensureContentScript(tab.id);
  return await chrome.tabs.sendMessage(tab.id, { action });
}

// ── Native messaging ──

function sendNativeMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ── Folder browser ──

async function navigateToFolder(path) {
  try {
    const resp = await sendNativeMessage({ action: "listFolders", path });
    if (!resp?.success) {
      showFolderError("Could not read folder");
      return;
    }

    // Use resolved path from native host (handles ~ expansion)
    var resolvedPath = resp.path || path;
    currentFolder = resolvedPath;
    chrome.storage.local.set({ folder: resolvedPath });

    renderBreadcrumbs(resolvedPath);
    renderFolderList(resp.folders, resolvedPath);
  } catch (err) {
    showFolderError("Native host not connected");
  }
}

function showFolderError(msg) {
  folderPathEl.innerHTML = `<span style="color: #c62828;">${msg}</span>`;
  folderListEl.innerHTML = "";
}

function renderBreadcrumbs(path) {
  folderPathEl.innerHTML = "";

  // Show shortened path with clickable segments
  var homePath = path.replace(/^\/Users\/[^/]+/, "~");
  var parts = path.split("/").filter(Boolean);

  // Determine how many segments to show (last 4 max for space)
  var startIdx = Math.max(0, parts.length - 4);

  // If vault root matches, show vault name as the anchor
  if (vaultRoot && path.startsWith(vaultRoot)) {
    var vaultParts = vaultRoot.split("/").filter(Boolean);
    startIdx = vaultParts.length - 1; // start from vault folder name

    // Add vault home icon
    var homeEl = document.createElement("span");
    homeEl.className = "crumb";
    homeEl.textContent = "~";
    homeEl.title = "Home directory";
    homeEl.addEventListener("click", function() {
      var home = path.replace(/^(\/Users\/[^/]+).*/, "$1");
      navigateToFolder(home);
    });
    folderPathEl.appendChild(homeEl);

    var sep0 = document.createElement("span");
    sep0.className = "sep";
    sep0.textContent = " / ... / ";
    folderPathEl.appendChild(sep0);
  }

  for (var i = startIdx; i < parts.length; i++) {
    if (i > startIdx) {
      var sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = " / ";
      folderPathEl.appendChild(sep);
    }

    var accumulated = "/" + parts.slice(0, i + 1).join("/");

    if (i === parts.length - 1) {
      var cur = document.createElement("span");
      cur.className = "current";
      cur.textContent = parts[i];
      folderPathEl.appendChild(cur);
    } else {
      var crumb = document.createElement("span");
      crumb.className = "crumb";
      crumb.textContent = parts[i];
      crumb.addEventListener("click", (function(target) {
        return function() { navigateToFolder(target); };
      })(accumulated));
      folderPathEl.appendChild(crumb);
    }
  }

  // Update manual input
  var manualInput = document.getElementById("folder-manual");
  if (manualInput) manualInput.value = path;
}

function renderFolderList(folders, parentPath) {
  folderListEl.innerHTML = "";

  if (!folders || folders.length === 0) {
    const li = document.createElement("li");
    li.style.color = "#999";
    li.style.fontStyle = "italic";
    li.textContent = "No subfolders";
    folderListEl.appendChild(li);
    return;
  }

  for (const name of folders) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="folder-icon">&#9656;</span> ${escHtml(name)}`;
    const fullPath = parentPath + "/" + name;
    li.addEventListener("click", () => navigateToFolder(fullPath));
    folderListEl.appendChild(li);
  }
}

function shortenPath(path) {
  const home = path.replace(/^\/Users\/[^/]+/, "~");
  return home;
}

// ── Init ──

async function init() {
  const stored = await chrome.storage.local.get(["folder", "outputFormat", "apiKey", "enrich"]);

  // Enrich toggle
  const enrichToggle = document.getElementById("enrich-toggle");
  enrichToggle.checked = stored.enrich !== false; // default on
  enrichToggle.addEventListener("change", () => {
    chrome.storage.local.set({ enrich: enrichToggle.checked });
  });

  // API key setup
  const apiKeyInput = document.getElementById("api-key");
  const apiKeyStatus = document.getElementById("api-key-status");
  const toggleKeyBtn = document.getElementById("toggle-key-btn");

  if (stored.apiKey) {
    apiKeyInput.value = stored.apiKey;
    apiKeyStatus.textContent = "Key saved";
    apiKeyStatus.style.color = "#2e7d32";
  }
  // Status will be updated after native host ping (see below)

  apiKeyInput.addEventListener("change", () => {
    const key = apiKeyInput.value.trim();
    if (key) {
      chrome.storage.local.set({ apiKey: key });
      apiKeyStatus.textContent = "Key saved";
      apiKeyStatus.style.color = "#2e7d32";
    } else {
      chrome.storage.local.remove("apiKey");
      apiKeyStatus.textContent = "No key - AI features disabled, basic format used";
      apiKeyStatus.style.color = "#e65100";
    }
  });

  document.getElementById("toggle-key-btn").addEventListener("click", () => {
    const input = document.getElementById("api-key");
    const btn = document.getElementById("toggle-key-btn");
    if (input.type === "password") {
      input.type = "text";
      btn.textContent = "Hide";
    } else {
      input.type = "password";
      btn.textContent = "Show";
    }
  });
  formatSelect.value = stored.outputFormat || "obsidian";

  // Check native host and get vault info
  try {
    const resp = await sendNativeMessage({ action: "ping" });
    nativeHostAvailable = resp?.success === true;

    const vaults = resp?.vaults || [];
    if (vaults.length > 1) {
      // Show vault picker
      const vaultPickerRow = document.getElementById("vault-picker-row");
      const vaultSelect = document.getElementById("vault-select");
      vaultPickerRow.classList.remove("hidden");
      vaultSelect.innerHTML = "";
      for (const v of vaults) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v.split("/").pop();
        vaultSelect.appendChild(opt);
      }

      // Restore saved vault or use saved folder's vault
      const savedFolder = stored.folder || "";
      const matchingVault = vaults.find((v) => savedFolder.startsWith(v));
      vaultRoot = matchingVault || vaults[0];
      vaultSelect.value = vaultRoot;

      vaultSelect.addEventListener("change", async () => {
        vaultRoot = vaultSelect.value;
        await navigateToFolder(vaultRoot);
      });

      await navigateToFolder(savedFolder || vaultRoot);
    } else if (vaults.length === 1) {
      vaultRoot = vaults[0];
      const savedFolder = stored.folder || vaultRoot;
      await navigateToFolder(savedFolder);
    } else {
      showFolderError("No Obsidian vault found");
    }
    // Update API key status based on both sources
    if (!stored.apiKey && resp?.hasFileKey) {
      apiKeyStatus.textContent = "Using key from ~/.schmusher.json";
      apiKeyStatus.style.color = "#2e7d32";
      apiKeyInput.placeholder = "Key in ~/.schmusher.json (paste here to use)";
    } else if (!stored.apiKey && !resp?.hasFileKey) {
      apiKeyStatus.textContent = "No key - will use basic formatting (no AI)";
      apiKeyStatus.style.color = "#e65100";
    }
  } catch {
    nativeHostAvailable = false;
    showFolderError("Native host not connected. Run install.sh");
  }

  // Check if on LinkedIn
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tab?.url || "";

  if (!tabUrl.includes("linkedin.com/in/")) {
    extractBtn.disabled = true;
    notLinkedin.classList.remove("hidden");
    return;
  }

  // Manual path input
  document.getElementById("folder-go-btn").addEventListener("click", function() {
    var manualPath = document.getElementById("folder-manual").value.trim();
    if (manualPath) {
      // Expand ~ to home directory
      if (manualPath.startsWith("~/")) {
        // We don't know home dir in JS, but the native host will expand it
        // For display, keep it as-is — navigateToFolder sends it to native host
      }
      navigateToFolder(manualPath);
    }
  });

  document.getElementById("folder-manual").addEventListener("keydown", function(e) {
    if (e.key === "Enter") {
      document.getElementById("folder-go-btn").click();
    }
  });

  // Run health check and update settings panel
  runHealthCheck(tabUrl);
}

async function runHealthCheck(tabUrl) {
  if (!tabUrl || !tabUrl.includes("linkedin.com/in/")) {
    healthBox.className = "health-box unknown";
    healthBox.textContent = "Not on a LinkedIn profile page";
    return;
  }

  try {
    await new Promise((r) => setTimeout(r, 1500));
    const resp = await sendToTab("checkLayout");
    if (!resp?.success) {
      healthBox.className = "health-box unknown";
      healthBox.textContent = "Could not check page";
      return;
    }

    const r = resp.data;
    if (r.healthy) {
      healthBox.className = "health-box good";
      healthBox.innerHTML = `Page health: ${r.score}% - All checks passed`;
    } else {
      healthBox.className = "health-box bad";
      var msg = `Page health: ${r.score}%`;
      if (r.failures.length > 0) msg += ` - Missing: ${r.failures.join(", ")}`;
      if (r.warnings.length > 0) msg += ` - Optional: ${r.warnings.join(", ")}`;
      healthBox.innerHTML = msg;

      // Also show warning banner for critical failures
      layoutWarning.innerHTML =
        `<b>Layout issue:</b> ${r.failures.length} required element(s) not found. ` +
        `Check Settings for details.`;
      layoutWarning.classList.remove("hidden");
    }
  } catch {
    healthBox.className = "health-box unknown";
    healthBox.textContent = "Could not connect to page";
  }

  // Update when settings panel is opened
  document.getElementById("settings-panel").addEventListener("toggle", function() {
    if (this.open && tabUrl) {
      runHealthCheck(tabUrl);
    }
  });
}

// ── Settings ──

formatSelect.addEventListener("change", () => {
  chrome.storage.local.set({ outputFormat: formatSelect.value });
});

// ── Extract + Export ──

extractBtn.addEventListener("click", async () => {
  if (!currentFolder) {
    showStatus("error", "Please select a folder in your Obsidian vault.");
    return;
  }

  if (nativeHostAvailable === false) {
    showStatus("error",
      "Native host not installed. Run:\n" +
      "./native-host/install.sh <extension-id>\nThen restart Chrome."
    );
    return;
  }

  extractBtn.disabled = true;
  extractBtn.textContent = "Schmushing...";
  showStatus("info", "Processing profile...");

  try {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const profileUrl = currentTab.url.split("?")[0].replace(/\/$/, "");
    const outputType = formatSelect.value;
    const ext = outputType === "json" ? "json" : "md";
    const { apiKey, enrich } = await chrome.storage.local.get(["apiKey", "enrich"]);

    // Delegate to background worker so it survives popup closing
    chrome.runtime.sendMessage({
      action: "startSingle",
      tabId: currentTab.id,
      profileUrl,
      folder: currentFolder,
      ext,
      apiKey: apiKey || "",
      enrich: enrich !== false,
    });

    // Poll for completion
    const pollTimer = setInterval(async () => {
      try {
        const resp = await chrome.runtime.sendMessage({ action: "getSingleStatus" });
        const s = resp?.state;
        if (!s) return;

        if (s.status === "extracting") showStatus("info", "Extracting profile...");
        else if (s.status === "loading_experience") showStatus("info", "Loading full experience...");
        else if (s.status === "processing") showStatus("info", "Processing with Claude Haiku 4.5...");

        if (s.done) {
          clearInterval(pollTimer);
          if (s.status === "success") {
            showStatus("success", `Saved: ${s.filename}`);
            // Poll for enrichment status if enabled
            if (enrichToggle.checked) {
              showStatus("success", `Saved: ${s.filename}\nEnriching with connections...`);
              pollEnrichStatus();
            }
          } else {
            showStatus("error", s.error || "Failed");
          }
          resetButton();
        }
      } catch {
        // Popup may have lost connection — that's ok, background continues
      }
    }, 500);
  } catch (err) {
    showStatus("error", `Error: ${err.message}`);
    resetButton();
  }
});


// ── Enrichment polling ──

function pollEnrichStatus() {
  var enrichTimer = setInterval(async () => {
    try {
      const resp = await sendNativeMessage({ action: "checkEnrich", folder: currentFolder });
      if (!resp?.success) return;
      const es = resp.enrich;
      if (es.status === "done") {
        clearInterval(enrichTimer);
        showStatus("success", `Saved and enriched with connections.`);
      } else if (es.status === "failed") {
        clearInterval(enrichTimer);
        showStatus("warning", `Saved. Enrichment failed.`);
      }
      // "running" — keep polling
    } catch {
      // ignore
    }
  }, 3000);
  // Stop polling after 2 minutes
  setTimeout(() => clearInterval(enrichTimer), 120000);
}

// ── Helpers ──

function resetButton() {
  extractBtn.disabled = false;
  extractBtn.textContent = "Schmush!";
}

function showStatus(type, message) {
  statusEl.className = `status ${type}`;
  statusEl.textContent = message;
  statusEl.classList.remove("hidden");
}

function showPreview(data, format) {
  const title = buildNoteTitle(data, format);
  const expCount = Math.min(data.experiences?.length || 0, format.max_roles || 5);

  previewEl.innerHTML = `
    <p><b>${title}</b></p>
    <p>${data.location || ""}</p>
    <p>${expCount} role(s) included</p>
    ${data.photo_url ? "<p>Photo: included</p>" : "<p>Photo: not found</p>"}
  `;
  previewEl.classList.remove("hidden");
}

// ── Batch mode ──

const batchBtn = document.getElementById("batch-btn");
const batchCancelBtn = document.getElementById("batch-cancel-btn");
const batchUrls = document.getElementById("batch-urls");
const batchProgress = document.getElementById("batch-progress");
const batchLog = document.getElementById("batch-log");
let batchPollTimer = null;

batchCancelBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "cancelBatch" });
  batchCancelBtn.classList.add("hidden");
  batchProgress.className = "status warning";
  batchProgress.textContent = "Cancelling...";
});

batchBtn.addEventListener("click", async () => {
  const text = batchUrls.value.trim();
  if (!text) {
    batchProgress.className = "status error";
    batchProgress.textContent = "Paste LinkedIn URLs first.";
    batchProgress.classList.remove("hidden");
    return;
  }

  if (!currentFolder) {
    batchProgress.className = "status error";
    batchProgress.textContent = "Select a folder first.";
    batchProgress.classList.remove("hidden");
    return;
  }

  const urls = text.split("\n").map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) return;

  const { apiKey, enrich } = await chrome.storage.local.get(["apiKey", "enrich"]);
  const ext = formatSelect.value === "json" ? "json" : "md";

  batchBtn.disabled = true;
  batchBtn.textContent = "Processing...";
  batchCancelBtn.classList.remove("hidden");
  batchLog.innerHTML = "";
  batchLog.classList.remove("hidden");
  batchProgress.className = "status info";
  batchProgress.textContent = `Starting batch: ${urls.length} profile(s)...`;
  batchProgress.classList.remove("hidden");

  // Start batch in background service worker
  chrome.runtime.sendMessage({
    action: "startBatch",
    urls,
    folder: currentFolder,
    ext,
    apiKey: apiKey || "",
    enrich: enrich !== false,
  });

  // Poll for progress
  batchPollTimer = setInterval(async () => {
    const resp = await chrome.runtime.sendMessage({ action: "getBatchStatus" });
    const state = resp?.state;
    if (!state) return;

    batchProgress.textContent = `Processing ${state.current}/${state.total}... (${state.completed} saved, ${state.failed} failed)`;

    // Update log — only auto-scroll if user is near the bottom
    const wasAtBottom = batchLog.scrollHeight - batchLog.scrollTop - batchLog.clientHeight < 30;
    batchLog.innerHTML = state.log
      .map((l) => `<div>${escHtml(l)}</div>`)
      .join("");
    if (wasAtBottom) {
      batchLog.scrollTop = batchLog.scrollHeight;
    }

    if (state.done) {
      clearInterval(batchPollTimer);
      batchPollTimer = null;
      batchBtn.disabled = false;
      batchBtn.textContent = "Batch Schmush!";
      batchCancelBtn.classList.add("hidden");
      batchProgress.className = state.cancelled ? "status warning" : "status success";
      batchProgress.textContent = `Done: ${state.completed} saved, ${state.failed} failed out of ${state.total}.`;
    }
  }, 1000);
});

function escHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

// ── Resume batch status display on popup reopen ──
async function checkBatchOnOpen() {
  try {
    const resp = await chrome.runtime.sendMessage({ action: "getBatchStatus" });
    const state = resp?.state;
    if (!state || state.done) return;

    // Batch is running — show progress
    const panel = document.getElementById("batch-panel");
    panel.open = true;
    batchBtn.disabled = true;
    batchBtn.textContent = "Processing...";
    batchCancelBtn.classList.remove("hidden");
    batchLog.classList.remove("hidden");
    batchProgress.classList.remove("hidden");

    // Start polling
    batchPollTimer = setInterval(async () => {
      const r = await chrome.runtime.sendMessage({ action: "getBatchStatus" });
      const s = r?.state;
      if (!s) return;

      batchProgress.className = "status info";
      batchProgress.textContent = `Processing ${s.current}/${s.total}... (${s.completed} saved, ${s.failed} failed)`;
      const atBottom = batchLog.scrollHeight - batchLog.scrollTop - batchLog.clientHeight < 30;
      batchLog.innerHTML = s.log.map((l) => `<div>${escHtml(l)}</div>`).join("");
      if (atBottom) batchLog.scrollTop = batchLog.scrollHeight;

      if (s.done) {
        clearInterval(batchPollTimer);
        batchBtn.disabled = false;
        batchBtn.textContent = "Batch Schmush!";
        batchCancelBtn.classList.add("hidden");
        batchProgress.className = s.cancelled ? "status warning" : "status success";
        batchProgress.textContent = `Done: ${s.completed} saved, ${s.failed} failed out of ${s.total}.`;
      }
    }, 1000);
  } catch {
    // No batch running
  }
}

// ── Start ──
init();
checkBatchOnOpen();
