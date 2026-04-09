/**
 * LinkedIn Profile Schmusher - Content script v4
 *
 * Raw-text-first approach: extracts page text and photo URL,
 * delegates all parsing to the LLM. DOM-structure independent
 * except for document root detection and photo finding.
 */

/* eslint-disable no-var */

// ── Document root detection ──
// LinkedIn renders content in different containers depending on version.
// This is the ONLY part that depends on DOM structure.

var DOC_ROOT_STRATEGIES = [
  // Strategy 1: Content directly in document
  function() {
    if (document.querySelector("h1") && document.body.innerText.length > 500) {
      return document;
    }
    return null;
  },
  // Strategy 2: Content in an iframe
  function() {
    try {
      var iframes = document.querySelectorAll("iframe");
      for (var i = 0; i < iframes.length; i++) {
        try {
          var doc = iframes[i].contentDocument;
          if (doc && doc.body && doc.body.innerText.length > 500) {
            return doc;
          }
        } catch(e) {}
      }
    } catch(e) {}
    return null;
  },
  // Strategy 3: Content in shadow DOM
  function() {
    try {
      var hosts = document.querySelectorAll("div");
      for (var i = 0; i < hosts.length; i++) {
        if (hosts[i].shadowRoot) {
          var sr = hosts[i].shadowRoot;
          if (sr.querySelector && sr.querySelector("h1")) {
            return sr;
          }
        }
      }
    } catch(e) {}
    return null;
  },
];

function getDocRoot() {
  for (var i = 0; i < DOC_ROOT_STRATEGIES.length; i++) {
    try {
      var root = DOC_ROOT_STRATEGIES[i]();
      if (root) return root;
    } catch(e) {}
  }
  return document;
}

// ── Wait for content to render ──

function waitForContent(timeout) {
  return new Promise(function(resolve) {
    var elapsed = 0;
    var interval = 300;
    function check() {
      var root = getDocRoot();
      var hasContent = false;
      try {
        if (root === document) {
          hasContent = document.body.innerText.length > 500;
        } else if (root.body) {
          hasContent = root.body.innerText.length > 500;
        } else if (root.textContent) {
          // Shadow root — check for non-CSS content
          var text = root.textContent.replace(/[\s:;{}#.,%\-\d]+/g, "").trim();
          hasContent = text.length > 200;
        }
        if (!hasContent) hasContent = !!root.querySelector && !!root.querySelector("h1");
      } catch(e) {}

      if (hasContent) {
        resolve(true);
        return;
      }
      elapsed += interval;
      if (elapsed >= (timeout || 10000)) {
        resolve(false);
        return;
      }
      setTimeout(check, interval);
    }
    check();
  });
}

// ── Dedup helper ──

function dedupLines(text) {
  var lines = text.split("\n");
  var seen = {};
  var result = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    if (seen[line]) continue;
    seen[line] = true;
    // Skip noise
    if (line === "…see more" || line === "see more") continue;
    if (/^Show all \d+/.test(line)) continue;
    result.push(line);
  }
  return result.join("\n");
}

// ── Photo extraction ──
// This is the only part that uses CSS-like heuristics.
// If it fails, we just don't get a photo — not a critical failure.

var PHOTO_STRATEGIES = [
  // Strategy 1: Known LinkedIn profile photo selectors
  function(doc) {
    var selectors = [
      "img.pv-top-card-profile-picture__image",
      "img.profile-photo-edit__preview",
      "button.pv-top-card-profile-picture img",
      ".pv-top-card--photo img",
    ];
    for (var s = 0; s < selectors.length; s++) {
      var img = doc.querySelector(selectors[s]);
      if (img && img.src && !img.src.includes("ghost-person")) return img.src;
    }
    return null;
  },
  // Strategy 2: Find profile-displayphoto in any img src
  function(doc) {
    var imgs = doc.querySelectorAll("img[src*='profile-displayphoto']");
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].src && !imgs[i].src.includes("ghost-person")) return imgs[i].src;
    }
    return null;
  },
  // Strategy 3: Find square-ish images on LinkedIn CDN near the top
  function(doc) {
    var imgs = doc.querySelectorAll("img[src*='licdn']");
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].src || "";
      if (src.includes("background") || src.includes("cover") || src.includes("ghost")) continue;
      var w = imgs[i].naturalWidth || imgs[i].width;
      var h = imgs[i].naturalHeight || imgs[i].height;
      if (w > 0 && h > 0 && w / h > 2) continue; // too wide = banner
      return src;
    }
    return null;
  },
];

function findProfilePhoto(doc) {
  for (var i = 0; i < PHOTO_STRATEGIES.length; i++) {
    try {
      var url = PHOTO_STRATEGIES[i](doc);
      if (url) return url;
    } catch(e) {}
  }
  return "";
}

// ── Main extraction: raw text approach ──

function extractProfile() {
  var doc = getDocRoot();
  var container = doc;
  // For iframes, use body; for shadow roots, use the root itself
  if (doc.body) container = doc.body;

  // Get ALL visible text from the page
  var fullText = container.innerText || "";
  var cleanText = dedupLines(fullText);

  // Find the profile photo
  var photoUrl = findProfilePhoto(doc);

  // Get the page URL
  var pageUrl = window.location.href.split("?")[0];

  // Return raw data — the LLM will parse everything
  return {
    url: pageUrl,
    extracted_at: new Date().toISOString(),
    photo_url: photoUrl,
    page_text: cleanText.substring(0, 10000),
    // Keep name for the "could not extract" check
    name: extractNameHeuristic(doc, cleanText),
  };
}

function extractNameHeuristic(doc, cleanText) {
  // Try to find the name from an h1 element
  try {
    var h1 = doc.querySelector("h1");
    if (h1 && h1.innerText.trim().length > 0 && h1.innerText.trim().length < 100) {
      return h1.innerText.trim();
    }
  } catch(e) {}
  // Fallback: first line of clean text that looks like a name
  var lines = cleanText.split("\n");
  for (var i = 0; i < Math.min(lines.length, 10); i++) {
    var line = lines[i].trim();
    // A name is typically 2-4 words, all starting with uppercase
    if (/^[A-Z][a-z]+ [A-Z]/.test(line) && line.length < 60 && line.split(" ").length <= 5) {
      return line;
    }
  }
  return "";
}

// ── Layout health check (simplified) ──

function checkLayout() {
  var root = getDocRoot();
  var checks = {
    docRoot: { test: root !== document || document.body.innerText.length > 500, required: true },
    hasH1: { test: !!root.querySelector && !!root.querySelector("h1"), required: true },
    hasContent: { test: (root.body ? root.body.innerText.length : (root.textContent || "").length) > 500, required: true },
    photo: { test: !!findProfilePhoto(root), required: false },
  };

  var failures = [];
  var warnings = [];
  var found = 0;
  var total = Object.keys(checks).length;

  for (var key in checks) {
    if (checks[key].test) {
      found++;
    } else if (checks[key].required) {
      failures.push(key);
    } else {
      warnings.push(key);
    }
  }

  return {
    healthy: failures.length === 0,
    score: Math.round((found / total) * 100),
    failures: failures,
    warnings: warnings,
  };
}

// ── Message handler ──

if (window.__schmusherListener) {
  chrome.runtime.onMessage.removeListener(window.__schmusherListener);
}
window.__schmusherListener = function(msg, sender, sendResponse) {
  if (msg.action === "ping") {
    sendResponse({ success: true });
    return;
  }
  if (msg.action === "extract") {
    waitForContent(10000).then(function(ready) {
      try {
        if (!ready) {
          sendResponse({ success: false, error: "Page did not finish loading" });
          return;
        }
        var data = extractProfile();
        sendResponse({ success: true, data: data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  } else if (msg.action === "extractExperienceRaw") {
    waitForContent(10000).then(function() {
      try {
        var expRoot = getDocRoot();
        var expContainer = expRoot.body || expRoot;
        var rawText = expContainer.innerText || "";
        sendResponse({ success: true, data: dedupLines(rawText).substring(0, 10000) });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  } else if (msg.action === "checkLayout") {
    waitForContent(10000).then(function() {
      try {
        var result = checkLayout();
        sendResponse({ success: true, data: result });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  }
  return true;
};
chrome.runtime.onMessage.addListener(window.__schmusherListener);
