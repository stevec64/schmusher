/**
 * Background service worker for batch processing.
 * Handles navigating to LinkedIn URLs, extracting profiles, and saving notes.
 */

let batchState = null;

let singleState = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "startBatch") {
    startBatch(msg.urls, msg.folder, msg.ext, msg.apiKey, msg.enrich);
    sendResponse({ success: true });
  } else if (msg.action === "getBatchStatus") {
    sendResponse({ state: batchState });
  } else if (msg.action === "cancelBatch") {
    if (batchState) batchState.cancelled = true;
    sendResponse({ success: true });
  } else if (msg.action === "startSingle") {
    processSingleProfile(msg.tabId, msg.profileUrl, msg.folder, msg.ext, msg.apiKey, msg.enrich);
    sendResponse({ success: true });
  } else if (msg.action === "getSingleStatus") {
    sendResponse({ state: singleState });
  }
  return true;
});

async function processSingleProfile(tabId, profileUrl, folder, ext, apiKey, enrich) {
  singleState = { status: "extracting", error: null, done: false, filename: "" };

  // Badge: extracting
  chrome.action.setBadgeText({ text: "1/1" });
  chrome.action.setBadgeBackgroundColor({ color: "#7c3aed" });

  try {
    // Extract main profile data (content script should already be injected)
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await sleep(500);

    const response = await chrome.tabs.sendMessage(tabId, { action: "extract" });
    if (!response?.success || !response.data?.name) {
      singleState = { status: "error", error: "Could not extract profile", done: true, filename: "" };
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#c62828" });
      setTimeout(() => chrome.action.setBadgeText({ text: "" }), 10000);
      return;
    }

    const profile = response.data;
    singleState.status = "loading_experience";

    // Badge: loading experience
    chrome.action.setBadgeText({ text: "Exp" });

    // Navigate to experience subpage
    const expUrl = profileUrl.replace(/\/$/, "") + "/details/experience/";
    await chrome.tabs.update(tabId, { url: expUrl });
    await waitForTabLoad(tabId);
    await sleep(3000);

    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await sleep(500);

    const expResp = await chrome.tabs.sendMessage(tabId, { action: "extractExperienceRaw" });
    if (expResp?.success && expResp.data) {
      profile.experience_raw_text = expResp.data;
    }

    singleState.status = "processing";

    // Badge: processing with AI
    chrome.action.setBadgeText({ text: "AI" });

    // Save via native host
    const saveResp = await sendNativeMessage({
      action: "saveNote",
      folder,
      profile,
      ext,
      apiKey: apiKey || "",
      enrich: !!enrich,
    });

    if (saveResp?.success) {
      singleState = { status: "success", error: null, done: true, filename: saveResp.filename };
      // Monitor enrichment if it was triggered
      if (enrich && saveResp.enrich) {
        pollEnrichBadge(folder);
      } else {
        // No enrichment — show saved badge
        chrome.action.setBadgeText({ text: "OK" });
        chrome.action.setBadgeBackgroundColor({ color: "#2e7d32" });
        setTimeout(() => chrome.action.setBadgeText({ text: "" }), 10000);
      }
    } else {
      singleState = { status: "error", error: saveResp?.error || "Save failed", done: true, filename: "" };
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#c62828" });
      setTimeout(() => chrome.action.setBadgeText({ text: "" }), 10000);
    }

    // Navigate back to profile
    await chrome.tabs.update(tabId, { url: profileUrl });

  } catch (err) {
    singleState = { status: "error", error: err.message, done: true, filename: "" };
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#c62828" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 10000);
  }
}

async function startBatch(urls, folder, ext, apiKey, enrich) {
  batchState = {
    total: urls.length,
    current: 0,
    completed: 0,
    failed: 0,
    cancelled: false,
    log: [],
    done: false,
    currentUrl: "",
  };

  batchState.savedFiles = [];
  batchState.log.push(`Folder: ${folder || "EMPTY!"}`);
  batchState.log.push(`API key: ${apiKey ? "set" : "using file fallback"}`);
  batchState.log.push(`Format: ${ext}`);
  batchState.log.push(`Profiles: ${urls.length}`);
  batchState.log.push("---");

  for (let i = 0; i < urls.length; i++) {
    if (batchState.cancelled) {
      batchState.log.push("Cancelled by user.");
      break;
    }

    const url = urls[i].trim();
    if (!url || !url.includes("linkedin.com/in/")) {
      batchState.log.push(`Skip: ${url} (not a LinkedIn profile URL)`);
      batchState.failed++;
      batchState.current = i + 1;
      continue;
    }

    batchState.current = i + 1;
    batchState.currentUrl = url;
    batchState.log.push(`[${i + 1}/${urls.length}] Loading: ${url}`);

    // Update badge on extension icon
    chrome.action.setBadgeText({ text: `${i + 1}/${urls.length}` });
    chrome.action.setBadgeBackgroundColor({ color: "#7c3aed" });

    try {
      // Navigate the current tab to the URL
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.update(tab.id, { url });

      // Wait for page to fully load
      await waitForTabLoad(tab.id);

      // Extra wait for LinkedIn's dynamic content to render
      await sleep(3000);

      // Inject content script and extract main profile data
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await sleep(500);

      const response = await chrome.tabs.sendMessage(tab.id, { action: "extract" });

      if (!response?.success || !response.data?.name) {
        batchState.log.push(`  FAIL: Could not extract profile`);
        batchState.failed++;
        continue;
      }

      const profile = response.data;
      batchState.log.push(`  Extracted: ${profile.name}`);

      // Navigate to experience subpage for full role history
      const expUrl = url.replace(/\/$/, "") + "/details/experience/";
      await chrome.tabs.update(tab.id, { url: expUrl });
      await waitForTabLoad(tab.id);
      await sleep(3000);

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await sleep(500);

      const expResponse = await chrome.tabs.sendMessage(tab.id, { action: "extractExperienceRaw" });
      if (expResponse?.success && expResponse.data) {
        profile.experience_raw_text = expResponse.data;
        batchState.log.push(`  Full experience loaded`);
      }

      // Save via native host — don't enrich during batch scraping
      const saveResp = await sendNativeMessage({
        action: "saveNote",
        folder,
        profile,
        ext,
        apiKey: apiKey || "",
        enrich: false,
      });

      if (saveResp?.success) {
        batchState.log.push(`  Saved: ${saveResp.filename}`);
        batchState.savedFiles.push(folder + "/" + saveResp.filename);
        batchState.completed++;
      } else {
        batchState.log.push(`  FAIL: ${saveResp?.error || "Save failed"}`);
        batchState.failed++;
      }
    } catch (err) {
      batchState.log.push(`  ERROR: ${err.message} | folder="${folder}" | apiKey=${apiKey ? "set" : "empty"}`);
      batchState.failed++;
    }

    // Pause between profiles to avoid LinkedIn rate limiting
    if (i < urls.length - 1 && !batchState.cancelled) {
      await sleep(2000);
    }
  }

  // Enrichment phase — run sequentially after all scraping
  if (enrich && batchState.savedFiles && batchState.savedFiles.length > 0 && !batchState.cancelled) {
    batchState.log.push("---");
    batchState.log.push(`Enriching ${batchState.savedFiles.length} profile(s)...`);

    for (let ei = 0; ei < batchState.savedFiles.length; ei++) {
      if (batchState.cancelled) break;

      const file = batchState.savedFiles[ei];
      batchState.log.push(`  Enriching [${ei + 1}/${batchState.savedFiles.length}]: ${file}`);
      chrome.action.setBadgeText({ text: `E${ei + 1}/${batchState.savedFiles.length}` });
      chrome.action.setBadgeBackgroundColor({ color: "#7c3aed" });

      try {
        // Trigger enrichment
        await sendNativeMessage({
          action: "triggerEnrich",
          folder,
          filepath: file,
        });

        // Poll until done
        let enrichElapsed = 0;
        while (enrichElapsed < 180000) {
          await sleep(3000);
          enrichElapsed += 3000;
          if (batchState.cancelled) break;
          try {
            const resp = await sendNativeMessage({ action: "checkEnrich", folder });
            if (resp?.success) {
              if (resp.enrich.status === "done") {
                batchState.log.push(`  Enriched OK`);
                break;
              } else if (resp.enrich.status === "failed") {
                batchState.log.push(`  Enrich failed`);
                break;
              }
            }
          } catch { break; }
        }
      } catch (err) {
        batchState.log.push(`  Enrich error: ${err.message}`);
      }
    }
  }

  batchState.done = true;
  batchState.log.push(
    `Done: ${batchState.completed} saved, ${batchState.failed} failed out of ${batchState.total}.`
  );

  chrome.action.setBadgeText({ text: "Done" });
  chrome.action.setBadgeBackgroundColor({ color: "#2e7d32" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 15000);
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    // Timeout after 15 seconds
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sendNativeMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage("com.schmusher.host", msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function pollEnrichBadge(folder) {
  // Show enriching badge
  chrome.action.setBadgeText({ text: "..." });
  chrome.action.setBadgeBackgroundColor({ color: "#7c3aed" });

  // Record when we started so we can ignore stale "done" from a previous run
  const startTime = Date.now();
  let elapsed = 0;
  const interval = 2000;
  const maxWait = 180000;

  const timer = setInterval(async () => {
    elapsed += interval;

    try {
      const resp = await sendNativeMessage({ action: "checkEnrich", folder });
      if (resp?.success) {
        const es = resp.enrich;
        // "none" = status file deleted (still starting), "running" = in progress
        if (es.status === "done") {
          clearInterval(timer);
          chrome.action.setBadgeText({ text: "OK" });
          chrome.action.setBadgeBackgroundColor({ color: "#2e7d32" });
          setTimeout(() => chrome.action.setBadgeText({ text: "" }), 15000);
        } else if (es.status === "failed") {
          clearInterval(timer);
          chrome.action.setBadgeText({ text: "!" });
          chrome.action.setBadgeBackgroundColor({ color: "#c62828" });
          setTimeout(() => chrome.action.setBadgeText({ text: "" }), 15000);
        }
        // "none" or "running" — keep polling
      }
    } catch {
      // ignore
    }
    if (elapsed >= maxWait) {
      clearInterval(timer);
      chrome.action.setBadgeText({ text: "" });
    }
  }, interval);
}
