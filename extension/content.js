/**
 * LinkedIn Profile Schmusher - Content script
 * Extracts profile data and profile photo from LinkedIn profile pages.
 */

/* eslint-disable no-var */
// Using var so the script can be safely re-injected without "already declared" errors
var SELECTORS = {
  // Name: LinkedIn has dropped text-heading-xlarge; fall back to any h1 in the top card
  name: "h1.text-heading-xlarge, h1[class*='text-heading'], .pv-top-card h1, .ph5 h1, main section:first-of-type h1, h1",
  introCard: ".pv-top-card, .ph5, .mt2",
  headline: "div.text-body-medium, div[class*='text-body-medium']",
  location: "span.text-body-small, span[class*='text-body-small']",
  aboutAnchor: "#about",
  experienceAnchor: "#experience",
  educationAnchor: "#education",
  profilePhoto:
    "img.pv-top-card-profile-picture__image, " +
    "img.profile-photo-edit__preview, " +
    "button.pv-top-card-profile-picture img, " +
    ".pv-top-card--photo img, " +
    "img[data-ghost-url], " +
    // Broader fallbacks: any large-ish profile img near the top
    ".pv-top-card img[src*='profile'], " +
    "main section:first-of-type img[width='200'], " +
    "main section:first-of-type img[class*='profile']",
  ariaText: 'span[aria-hidden="true"]',
  // Section lists: LinkedIn may have changed ul.pvs-list; try multiple patterns
  sectionList: ":scope > div > ul > li, :scope ul.pvs-list > li, :scope ul[class*='pvs-list'] > li, :scope > div > div > ul > li",
  groupedRoles: ":scope > div > div > div > ul > li",
  groupedCompany: ':scope > div > div > div > a span[aria-hidden="true"]',
};

// ── Shadow DOM support ──

// LinkedIn renders profile content in different places depending on version:
// 1. Directly in document (older versions)
// 2. Inside an iframe (linkedin.com/preload/) (2026+ version)
// 3. Inside a shadow DOM
// This function finds the correct root to query
function getDocRoot() {
  // First check if document itself has the content (h1 present)
  if (document.querySelector("h1") && document.body.innerText.length > 500) {
    return document;
  }

  // Check iframes — LinkedIn may render in an iframe
  try {
    var iframes = document.querySelectorAll("iframe");
    for (var i = 0; i < iframes.length; i++) {
      try {
        var iframeDoc = iframes[i].contentDocument;
        if (iframeDoc && iframeDoc.querySelector("h1") && iframeDoc.body.innerText.length > 500) {
          return iframeDoc;
        }
      } catch(e) {
        // Cross-origin iframe, skip
      }
    }
  } catch(e) {}

  // Check shadow DOM
  try {
    var shadowHost = document.querySelector("div.theme--light");
    if (shadowHost && shadowHost.shadowRoot) {
      var sr = shadowHost.shadowRoot;
      if (sr.querySelector("h1")) {
        return sr;
      }
    }
  } catch(e) {}

  return document;
}

// ── Helpers ──

function waitForContent(timeout) {
  return new Promise(function(resolve) {
    var elapsed = 0;
    var interval = 300;
    function check() {
      var root = getDocRoot();
      // Check if root has actual content (not just the shell)
      var hasH1 = false;
      var hasText = false;
      try {
        hasH1 = !!root.querySelector("h1");
        hasText = root.body ? root.body.innerText.length > 500 : (root.textContent && root.textContent.length > 500);
      } catch(e) {}

      if (hasH1 || hasText) {
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

function extractText(el) {
  if (!el) return "";
  const hidden = el.querySelector(SELECTORS.ariaText);
  return (hidden || el).innerText.trim();
}

function getSection(sectionId) {
  var root = getDocRoot();
  var anchor = root.getElementById ? root.getElementById(sectionId) : root.querySelector("#" + sectionId);
  if (!anchor) return null;
  return anchor.closest("section") || anchor.parentElement?.closest("section");
}

// ── Layout health check ──

function checkLayout() {
  const checks = {
    name: { sel: SELECTORS.name, required: true },
    headline: { sel: SELECTORS.headline, required: true },
    experience: { sel: SELECTORS.experienceAnchor, required: true },
    sectionList: { sel: "#experience ~ ul, #experience ~ div ul, section:has(#experience) ul, ul.pvs-list", required: true },
    ariaSpans: { sel: SELECTORS.ariaText, required: true },
    location: { sel: SELECTORS.location, required: false },
    about: { sel: SELECTORS.aboutAnchor, required: false },
    education: { sel: SELECTORS.educationAnchor, required: false },
    photo: { sel: SELECTORS.profilePhoto + ", main img[src*='licdn']", required: false },
  };

  const failures = [];
  const warnings = [];
  let found = 0;
  const total = Object.keys(checks).length;

  var checkRoot = getDocRoot();
  for (const [key, c] of Object.entries(checks)) {
    if (checkRoot.querySelector(c.sel)) {
      found++;
    } else if (c.required) {
      failures.push(key);
    } else {
      warnings.push(key);
    }
  }

  return {
    healthy: failures.length === 0,
    score: Math.round((found / total) * 100),
    failures,
    warnings,
  };
}

// ── Profile extraction ──

function extractProfile() {
  var doc = getDocRoot();
  const profile = {
    url: window.location.href.split("?")[0],
    extracted_at: new Date().toISOString(),
    name: "",
    headline: "",
    location: "",
    about: "",
    photo_url: "",
    experiences: [],
    education: [],
  };

  // Name
  const nameEl = doc.querySelector(SELECTORS.name);
  profile.name = nameEl?.innerText.trim() || "";

  // Intro card: headline + location — walk up from the h1 to find the card container
  const introCard =
    nameEl?.closest(".pv-top-card") ||
    nameEl?.closest(".ph5") ||
    nameEl?.closest(".mt2")?.parentElement ||
    nameEl?.closest("section") ||
    nameEl?.parentElement?.parentElement;

  if (introCard) {
    const headlineEl = introCard.querySelector(SELECTORS.headline);
    profile.headline = headlineEl?.innerText.trim() || "";

    // Location: look for text-body-small spans that contain a geographic location
    // Skip company names, connection counts, follower counts
    const locationEls = introCard.querySelectorAll(SELECTORS.location);
    for (const el of locationEls) {
      const text = el.innerText.trim();
      if (!text) continue;
      if (text.includes("connection") || text.includes("follower")) continue;
      // Location text typically contains a comma (City, Country) or known geo terms
      if (/,/.test(text) || /Area|Region|County|Metropolitan|United|Ireland|Kingdom|States|Finland|Germany|France|Sweden|Norway|Denmark|Netherlands|Spain|Italy|Australia|Canada|India|Japan|Singapore/i.test(text)) {
        profile.location = text;
        break;
      }
    }
    // Fallback: if no geo-like text found, try the last text-body-small (location is usually last)
    if (!profile.location && locationEls.length > 0) {
      for (let i = locationEls.length - 1; i >= 0; i--) {
        const text = locationEls[i].innerText.trim();
        if (text && !text.includes("connection") && !text.includes("follower")) {
          profile.location = text;
          break;
        }
      }
    }
  }

  // Profile photo — find the circular profile picture, not the background banner
  // Profile photos are typically 200x200 or similar square dimensions
  // Banner images are wide (1400x350 etc) and usually in a different container
  let photoUrl = "";
  const photoCandidates = doc.querySelectorAll(SELECTORS.profilePhoto);
  for (const img of photoCandidates) {
    const src = img.src || "";
    if (!src || src.includes("ghost-person") || src.includes("data:")) continue;
    // Skip banner images: they contain "background" or "cover" in the URL or are very wide
    if (src.includes("background") || src.includes("cover-photo")) continue;
    // Profile photos on LinkedIn CDN contain "profile-displayphoto" or similar
    // and are typically square (100-400px)
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w > 0 && h > 0 && w / h > 2) continue; // too wide = banner
    photoUrl = src;
    break;
  }
  if (!photoUrl) {
    // Broader fallback: any img in the top card area that links to licdn
    const topCardImgs = (introCard || doc).querySelectorAll("img[src*='licdn']");
    for (const img of topCardImgs) {
      const src = img.src || "";
      if (src.includes("background") || src.includes("cover")) continue;
      photoUrl = src;
      break;
    }
  }
  profile.photo_url = photoUrl;

  // Mutual connections — handle all formats:
  // "Name1, Name2, and 16 other mutual connections"
  // "23 mutual connections"
  // "Name is a mutual connection"
  // "Name1 and Name2 are mutual connections"
  // "1 mutual connection"
  profile.mutual_connections = { count: 0, names: [], text: "" };
  var allLinks = doc.querySelectorAll("a");
  for (var li2 = 0; li2 < allLinks.length; li2++) {
    var mcText = allLinks[li2].innerText.trim();
    if (!/mutual\s+connection/i.test(mcText)) continue;

    // Clean up duplicated lines (LinkedIn accessibility duplication)
    var mcLines = mcText.split("\n").map(function(l) { return l.trim(); });
    var mcSeen = {};
    var mcClean = [];
    for (var ml = 0; ml < mcLines.length; ml++) {
      if (!mcSeen[mcLines[ml]] && mcLines[ml]) {
        mcSeen[mcLines[ml]] = true;
        mcClean.push(mcLines[ml]);
      }
    }
    mcText = mcClean.join(" ");
    profile.mutual_connections.text = mcText;

    // Pattern: "Name1, Name2, and 16 other mutual connections"
    var otherMatch = mcText.match(/(.+?),?\s+and\s+(\d+)\s+other\s+mutual/i);
    if (otherMatch) {
      profile.mutual_connections.names = otherMatch[1].split(/,\s*/).map(function(n) { return n.trim(); }).filter(Boolean);
      profile.mutual_connections.count = parseInt(otherMatch[2]) + profile.mutual_connections.names.length;
      break;
    }

    // Pattern: "23 mutual connections"
    var numMatch = mcText.match(/^(\d+)\s+mutual\s+connection/i);
    if (numMatch) {
      profile.mutual_connections.count = parseInt(numMatch[1]);
      break;
    }

    // Pattern: "Name1 and Name2 are mutual connections"
    var twoMatch = mcText.match(/^(.+?)\s+and\s+(.+?)\s+are\s+mutual/i);
    if (twoMatch) {
      profile.mutual_connections.names = [twoMatch[1].trim(), twoMatch[2].trim()];
      profile.mutual_connections.count = 2;
      break;
    }

    // Pattern: "Name is a mutual connection"
    var oneMatch = mcText.match(/^(.+?)\s+is\s+a\s+mutual/i);
    if (oneMatch) {
      profile.mutual_connections.names = [oneMatch[1].trim()];
      profile.mutual_connections.count = 1;
      break;
    }

    // Fallback: just note that mutual connections exist
    profile.mutual_connections.count = 1;
    break;
  }

  // About
  const aboutSection = getSection("about");
  if (aboutSection) {
    const spans = aboutSection.querySelectorAll(SELECTORS.ariaText);
    const texts = Array.from(spans)
      .map((s) => s.innerText.trim())
      .filter((t) => t.length > 20);
    profile.about = texts.join("\n") || "";
  }

  // Experience — extract both structured data and raw text
  const expSection = getSection("experience");
  if (expSection) {
    const items = expSection.querySelectorAll(SELECTORS.sectionList);
    for (const item of items) {
      const exp = parseExperienceItem(item);
      if (exp) profile.experiences.push(...exp);
    }
    // Capture raw text for LLM parsing — deduplicate the doubled lines LinkedIn renders
    const rawLines = expSection.innerText.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    const dedupedLines = [];
    for (let i = 0; i < rawLines.length; i++) {
      // Skip if this line is identical to the previous one
      if (i > 0 && rawLines[i] === rawLines[i - 1]) continue;
      // Skip "…see more" links
      if (rawLines[i] === "…see more" || rawLines[i] === "see more") continue;
      dedupedLines.push(rawLines[i]);
    }
    profile.experience_raw_text = dedupedLines.join("\n").substring(0, 8000);
  }

  // Education
  const eduSection = getSection("education");
  if (eduSection) {
    const items = eduSection.querySelectorAll(SELECTORS.sectionList);
    for (const item of items) {
      const edu = parseEducationItem(item);
      if (edu) profile.education.push(edu);
    }
  }

  return profile;
}

function parseExperienceItem(li) {
  const subItems = li.querySelectorAll(SELECTORS.groupedRoles);

  if (subItems.length > 0) {
    // Grouped roles: company name is in the group header
    // Try multiple selectors for the company name
    let company = "";
    const companySelectors = [
      ':scope > div > div > div > a span[aria-hidden="true"]',
      ':scope > div > div > a span[aria-hidden="true"]',
      ':scope > div a[data-field="experience_company_logo"] span[aria-hidden="true"]',
    ];
    for (const sel of companySelectors) {
      const el = li.querySelector(sel);
      if (el) {
        company = el.innerText.trim();
        break;
      }
    }
    // Fallback: first span with aria-hidden in the top-level div (before the sub-list)
    if (!company) {
      const topSpans = li.querySelectorAll(':scope > div > div > div > span[aria-hidden="true"]');
      for (const span of topSpans) {
        const text = span.innerText.trim();
        if (text && text.length < 100 && !text.includes("\n") && !/\d{4}/.test(text)) {
          company = text;
          break;
        }
      }
    }

    // Also try to get total duration from group header
    let groupDuration = "";
    const allSpans = li.querySelectorAll(':scope > div > div > div > span[aria-hidden="true"]');
    for (const span of allSpans) {
      const text = span.innerText.trim();
      if (/\d+\s*(yr|mo)/i.test(text)) {
        groupDuration = text;
        break;
      }
    }

    const roles = [];
    for (const sub of subItems) {
      const role = parseSingleRole(sub);
      if (role) {
        // Sub-roles inherit the group company name
        role.company = company;
        // Mark as part of a group so we can track total company tenure
        role.group_company = company;
        role.group_duration = groupDuration;
        roles.push(role);
      }
    }
    return roles;
  }

  const role = parseSingleRole(li);
  return role ? [role] : null;
}

function parseSingleRole(el) {
  const spans = el.querySelectorAll(SELECTORS.ariaText);
  const texts = Array.from(spans).map((s) => s.innerText.trim());
  if (texts.length === 0) return null;

  const role = { title: texts[0] || "", company: "", date_range: "", duration: "", description: "" };

  // Patterns that indicate a location, not a company name
  const locationPatterns = /^(Greater |Metro |San |Los |New |United |London|Paris|Berlin|Helsinki|Dublin|Amsterdam|Sydney|Toronto|Montreal|Area$|Region$|County$)/i;

  for (let i = 1; i < texts.length; i++) {
    const t = texts[i];
    if (!t) continue;
    // Duration: "3 yrs 6 mos", "9 mos", "1 yr" etc — can appear standalone or within date text
    if (/^\d+\s*(yr|mo|year|month)/i.test(t)) {
      role.duration = t;
    } else if (/\d{4}\s*[-–]/.test(t) || /present/i.test(t)) {
      role.date_range = t;
      // Extract embedded duration from strings like "Jul 2024 - Present · 9 mos"
      const durMatch = t.match(/(\d+\s*yrs?\s*(?:\d+\s*mos?)?|\d+\s*mos?)/i);
      if (durMatch && !role.duration) {
        role.duration = durMatch[0].trim();
      }
    } else if (!role.company && t.length < 100 && !t.includes("\n")) {
      // Check if this looks like a location rather than a company
      if (locationPatterns.test(t) || /Metropolitan|Region|Area/i.test(t)) {
        role.location = t;
      } else if (/^(Full-time|Part-time|Contract|Freelance|Self-employed|Internship)$/i.test(t)) {
        // Skip employment type labels
      } else {
        role.company = t;
      }
    } else if (t.length > 30) {
      role.description = t;
    }
  }

  return role;
}

function parseEducationItem(li) {
  const spans = li.querySelectorAll(SELECTORS.ariaText);
  const texts = Array.from(spans).map((s) => s.innerText.trim());
  if (texts.length === 0) return null;

  const edu = { school: texts[0] || "", degree: "", date_range: "" };
  for (let i = 1; i < texts.length; i++) {
    const t = texts[i];
    if (!t) continue;
    if (/\d{4}\s*[-–]/.test(t)) {
      edu.date_range = t;
    } else if (!edu.degree) {
      edu.degree = t;
    }
  }
  return edu;
}

// ── Message handler (remove previous listener if re-injected) ──

if (window.__schmusherListener) {
  chrome.runtime.onMessage.removeListener(window.__schmusherListener);
}
window.__schmusherListener = (msg, sender, sendResponse) => {
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
        const data = extractProfile();
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    });
    return true; // keep channel open for async
  } else if (msg.action === "extractExperienceRaw") {
    waitForContent(10000).then(function() {
      try {
        var expRoot = getDocRoot();
        var expContainer = expRoot.querySelector("main") || document.body;
        var rawText = expContainer.innerText.trim();

        var expLines = rawText.split("\n").map(function(l) { return l.trim(); }).filter(Boolean);
        var expSeen = {};
        var expClean = [];
        for (var ei = 0; ei < expLines.length; ei++) {
          if (!expSeen[expLines[ei]]) {
            expSeen[expLines[ei]] = true;
            expClean.push(expLines[ei]);
          }
        }
        sendResponse({ success: true, data: expClean.join("\n").substring(0, 8000) });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  } else if (msg.action === "diagnose") {
    setTimeout(function() {
      var diag = {};
      try { diag.url = window.location.href; } catch(e) { diag.url = "err"; }
      try { diag.bodyText = document.body.innerText.length; } catch(e) {}

      // Find shadow host
      try {
        var sh = document.querySelector("div.theme--light");
        diag.shadowHost = !!sh;
        if (sh && sh.shadowRoot) {
          diag.hasSR = true;
          var sr = sh.shadowRoot;
          diag.srChildCount = sr.childElementCount;

          // List first 10 direct children (tag only)
          var tags = [];
          for (var i = 0; i < Math.min(sr.childElementCount, 10); i++) {
            tags.push(sr.children[i].tagName);
          }
          diag.srChildTags = tags;

          // Check if h1 exists in shadow root
          try { diag.srH1 = sr.querySelectorAll("h1").length; } catch(e) { diag.srH1err = e.message; }

          // Maybe content is inside #root inside shadow root?
          try {
            var srRoot = sr.querySelector("#root");
            diag.srHasRoot = !!srRoot;
            if (srRoot) {
              diag.srRootText = srRoot.innerText.length;
              diag.srRootH1 = srRoot.querySelectorAll("h1").length;
            }
          } catch(e) { diag.srRootErr = e.message; }

          // Check for main
          try {
            var srMain = sr.querySelector("main");
            diag.srHasMain = !!srMain;
            if (srMain) {
              diag.srMainH1 = srMain.querySelectorAll("h1").length;
              diag.srMainText = srMain.innerText.substring(0, 200);
            }
          } catch(e) { diag.srMainErr = e.message; }

          // Dig into the DIV child
          try {
            var contentDiv = sr.querySelector("div");
            if (contentDiv) {
              diag.divChildren = [];
              for (var j = 0; j < Math.min(contentDiv.childElementCount, 10); j++) {
                var kid = contentDiv.children[j];
                diag.divChildren.push({
                  tag: kid.tagName,
                  id: kid.id || "",
                  cls: (kid.className || "").substring(0, 40),
                  children: kid.childElementCount,
                  hasShadow: !!kid.shadowRoot,
                  text: (kid.innerText || "").substring(0, 50),
                });
              }
              // Check for nested shadow roots
              var nested = contentDiv.querySelectorAll("*");
              var nestedShadows = [];
              for (var k = 0; k < Math.min(nested.length, 500); k++) {
                if (nested[k].shadowRoot) {
                  var nsr = nested[k].shadowRoot;
                  nestedShadows.push({
                    tag: nested[k].tagName,
                    cls: (nested[k].className || "").substring(0, 30),
                    h1s: nsr.querySelectorAll("h1").length,
                    textLen: (nsr.textContent || "").length,
                    snippet: (nsr.textContent || "").replace(/[\s:;{}]+/g, " ").trim().substring(0, 100),
                  });
                }
              }
              diag.nestedShadows = nestedShadows.slice(0, 5);
            }
          } catch(e) { diag.divErr = e.message; }
        } else {
          diag.hasSR = false;
        }
      } catch(e) { diag.shadowErr = e.message; }

      // Check the #root div directly on document
      try {
        var docRoot = document.getElementById("root");
        diag.docRootExists = !!docRoot;
        if (docRoot) {
          diag.docRootText = (docRoot.innerText || "").substring(0, 200);
          diag.docRootChildren = docRoot.childElementCount;
          diag.docRootH1 = docRoot.querySelectorAll("h1").length;
        }
      } catch(e) { diag.docRootErr = e.message; }

      // Check iframes more carefully - maybe content is in an iframe
      try {
        var iframes = document.querySelectorAll("iframe");
        diag.iframeCount = iframes.length;
        diag.iframeSrcs = [];
        for (var fi = 0; fi < Math.min(iframes.length, 5); fi++) {
          var f = iframes[fi];
          var finfo = { src: (f.src || "").substring(0, 80) };
          try {
            if (f.contentDocument) {
              finfo.hasDoc = true;
              finfo.h1s = f.contentDocument.querySelectorAll("h1").length;
              finfo.textLen = f.contentDocument.body.innerText.length;
            } else {
              finfo.hasDoc = false;
            }
          } catch(e) { finfo.crossOrigin = true; }
          diag.iframeSrcs.push(finfo);
        }
      } catch(e) {}

      // Check all direct body children more carefully
      try {
        var allBodyKids = document.body.children;
        diag.bodyKids = [];
        for (var bi = 0; bi < Math.min(allBodyKids.length, 5); bi++) {
          var bk = allBodyKids[bi];
          if (bk.tagName === "SCRIPT") continue;
          diag.bodyKids.push({
            tag: bk.tagName,
            id: bk.id || "",
            children: bk.childElementCount,
            text: (bk.innerText || "").substring(0, 100),
            display: window.getComputedStyle(bk).display,
          });
        }
      } catch(e) {}

      // Total elements in document
      try { diag.totalElements = document.querySelectorAll("*").length; } catch(e) {}

      sendResponse({ success: true, data: diag });
    }, 3000);
    return true;
  } else if (msg.action === "checkLayout") {
    waitForContent(10000).then(function() {
      try {
        const result = checkLayout();
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

