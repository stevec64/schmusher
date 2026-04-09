# LinkedIn Profile Schmusher

A Chrome extension that extracts LinkedIn profiles and saves concise, structured summaries as Markdown or JSON files. Uses Claude AI to intelligently classify roles, summarise career history, and identify board memberships.

## What it does

Visit any LinkedIn profile, click **Schmush!**, and get a clean summary file like:

```markdown
[LinkedIn Profile](https://linkedin.com/in/someone) | San Francisco, CA
**23 mutual connections** including Jane Smith, John Doe

![Name](photo_url)

*Experienced technology leader with 20 years in enterprise software.*

- **Acme Corp**: CEO (3y current) - Leading Series B AI infrastructure startup
- **BigTech**: VP Engineering (5y 6m) - Managed 120 engineers across 8 teams
- **StartupCo**: Co-Founder (3y) - Built platform engineering from scratch

**Boards:**
- TechFoundation (4y current)
- IEEE (3y)

**Education:** MIT (MS Computer Science)
```

### Features

- **Single profile** or **batch processing** (paste a list of URLs)
- **AI-powered** role classification: separates employment from board/advisory roles
- **Short-form** company names and role titles (CEO not Chief Executive Officer)
- **Mutual connections** count and names extracted
- **Profile photo** included in the summary
- **Merge-safe**: re-processing a profile preserves any sections you added manually
- **DOM-resilient**: uses raw text extraction so it survives LinkedIn layout changes
- **Badge notifications** show progress on the extension icon

## Requirements

- **Google Chrome** (desktop)
- **Python 3.9+** (for the native messaging host)
- **Anthropic API key** (for Claude AI processing — [get one here](https://console.anthropic.com))

Without an API key, profiles are saved with basic formatting (raw text dump). With a key, you get intelligent role classification, summarisation, and formatting at ~$0.001 per profile using Claude Haiku.

## Installation

### Step 1: Load the Chrome extension

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the `extension/` folder
5. Note the **extension ID** shown under the extension name

### Step 2: Install the native messaging host

The native host is a small Python script that handles file saving and Claude API calls.

**macOS / Linux:**
```bash
cd native-host
chmod +x install.sh
./install.sh <your-extension-id>
```

**Windows:**
```cmd
cd native-host
install-windows.bat <your-extension-id>
```

### Step 3: Restart Chrome

Close Chrome completely (Cmd+Q / Alt+F4) and reopen it.

### Step 4: Configure API key

1. Navigate to any LinkedIn profile
2. Click the Schmusher extension icon
3. Expand **Settings** at the bottom
4. Paste your Anthropic API key

Alternatively, create a config file:
```bash
echo '{"anthropic_api_key": "sk-ant-your-key"}' > ~/.schmusher.json
chmod 600 ~/.schmusher.json   # macOS/Linux only
```

## Usage

### Single profile
1. Navigate to a LinkedIn profile in Chrome
2. Click the Schmusher icon
3. Select a folder to save to (browse or type a path)
4. Click **Schmush!**

### Batch processing
1. Click the Schmusher icon
2. Expand **Batch mode**
3. Paste LinkedIn URLs (one per line)
4. Click **Batch Schmush!**

The extension icon badge shows progress:
- `3/10` — processing profile 3 of 10
- `AI` — Claude is processing
- `OK` (green) — done
- `!` (red) — error

### Output formats

- **Markdown (.md)** — structured summary with AI classification (default)
- **JSON** — raw extracted data

Files are saved to the folder you select. Works great with note-taking apps like [Obsidian](https://obsidian.md), or any folder on your system.

## Enrichment (Advanced)

The extension supports an optional enrichment step that can cross-reference new profiles against your existing notes using [Claude Code](https://claude.ai/claude-code). This is disabled by default.

### How enrichment works

After saving a profile, the extension can invoke a Claude Code skill that:
- Reads the saved profile
- Searches your notes/vault for mentions and connections
- Appends a "Connections" section with relevant links

### Setting up enrichment

1. Install [Claude Code](https://claude.ai/claude-code)
2. Create a Claude Code project command file at:
   ```
   ~/.claude/projects/<your-project-key>/commands/enrich-profile.md
   ```
3. The skill should accept a file path and add a `## Connections` section

Example skill structure:
```markdown
# Enrich Contact Profile

Given a contact profile, cross-reference against your knowledge base
and add verifiable connection links.

## Input
The user will provide a path to a profile `.md` file.

## Process
1. Read the profile file
2. Search your vault/notes for mentions of their name, companies, shared connections
3. Add a `## Connections` section with up to 5 verified links

## Rules
- Only verifiable links with evidence
- Do NOT move or rename the file
- Keep formatting concise
```

4. Enable "Enrich with connections" in the Schmusher extension

### Tips for enrichment
- The skill works best when you have existing notes about companies, people, and meetings
- Use `[[wikilinks]]` in the Connections section to link to your notes
- Keep enrichment rules focused — too broad a search adds noise
- The enrichment runs in the background and takes 30-60 seconds per profile

## How it works

### Architecture

```
Chrome Extension          Native Host (Python)       Claude API
─────────────────         ──────────────────────     ───────────
content.js                schmusher_host.py          Haiku 4.5
  → extracts raw            → receives profile         → classifies roles
    page text                 data via native           → summarises bio
  → finds profile              messaging               → extracts structure
    photo URL              → calls Claude API
                           → writes .md/.json file
background.js              → triggers enrichment
  → manages batch             (optional)
    processing
  → badge notifications
```

### DOM resilience

The extension uses a **raw-text-first** approach. Instead of relying on CSS selectors to find specific elements (which break when LinkedIn updates their page), it:

1. Finds the document root (handles iframes and shadow DOM)
2. Extracts the full page text
3. Sends it to Claude to parse names, roles, dates, etc.

The only DOM-dependent parts are:
- **Document root detection** — finding where LinkedIn renders content (direct DOM, iframe, or shadow DOM). Uses a strategy pattern with multiple fallbacks.
- **Profile photo** — finding the profile image URL. Also uses multiple strategies.

Both use ordered fallback chains, so if one approach breaks, the next is tried automatically.

## Cost

Using Claude Haiku 4.5:
- ~$0.001 per profile (classification + summarisation)
- ~$0.01 per profile with enrichment (more context reading)
- 100 profiles ≈ $0.10-1.00

## Troubleshooting

**"Native host not installed"**
- Run the install script with your extension ID
- Restart Chrome completely (not just close the window)

**"Could not extract profile"**
- Refresh the LinkedIn page and try again
- Check the layout health in Settings

**Empty or wrong photo**
- The photo finder picks the largest profile-sized image on the page
- Very new LinkedIn layouts may need a photo strategy update

**Batch processing stops**
- LinkedIn may rate-limit if you process too many profiles too fast
- The extension waits 2 seconds between profiles to avoid this
- If blocked, wait a few minutes and retry

## License

MIT

## Credits

Built with [Claude Code](https://claude.ai/claude-code) by Anthropic.
