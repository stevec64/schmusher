#!/usr/bin/env python3
"""
Native messaging host for LinkedIn Profile Schmusher.
Uses Claude API to intelligently process profiles before saving to Obsidian.
"""

import json
import os
import re
import struct
import subprocess
import sys
import urllib.request
import urllib.error


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    length = struct.unpack("@I", raw_length)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode("utf-8"))


def send_message(msg):
    encoded = json.dumps(msg).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("@I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def load_api_key():
    config_path = os.path.expanduser("~/.schmusher.json")
    if not os.path.exists(config_path):
        return None
    with open(config_path) as f:
        cfg = json.load(f)
    return cfg.get("anthropic_api_key")


def call_claude(api_key, prompt):
    """Call Claude API using only standard library."""
    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")

    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read().decode("utf-8"))

    return result["content"][0]["text"]


def clean_raw_text(raw_text):
    """Aggressively clean LinkedIn raw text to remove duplicates and noise."""
    lines = raw_text.split("\n")
    cleaned = []
    seen = set()
    for line in lines:
        line = line.strip()
        if not line:
            continue
        # Skip exact duplicates (LinkedIn renders everything twice for accessibility)
        if line in seen:
            continue
        seen.add(line)
        # Skip "to" date variants
        if " to " in line and ("·" in line or "Present" in line):
            continue
        # Skip noise
        if line in ("…see more", "see more", "Experience"):
            continue
        if line.startswith("Show all "):
            continue
        # Skip location lines
        if re.match(r"^(Greater |Helsinki|London|Paris|Dublin|Berlin|New York|San Francisco|Montreal)", line, re.I):
            continue
        # Skip employment type labels
        if line in ("Full-time", "Part-time", "Contract", "Freelance", "Self-employed"):
            continue
        # Skip generic skill tags
        if line in ("Board Governance", "Start-up Ventures"):
            continue
        # Truncate long description lines to 100 chars
        if len(line) > 120:
            line = line[:100] + "..."
        cleaned.append(line)

    # Annotate board roles explicitly so LLM doesn't misclassify
    board_keywords = re.compile(
        r'^(Board Member|Board Director|Non-Executive Director|NED|'
        r'Advisory Board|Advisor|Fellow|Trustee|Patron|Mentor|Ambassador|Judge)',
        re.I
    )
    annotated = []
    for line in cleaned:
        if board_keywords.match(line):
            line = f"[BOARD ROLE] {line}"
        # Also catch "Board member at Company..." patterns in title lines
        elif re.match(r'^Board member at ', line, re.I):
            line = f"[BOARD ROLE] {line}"
        annotated.append(line)

    return "\n".join(annotated)


def process_profile_with_llm(api_key, profile):
    """Use Claude to process the profile into a clean structured format.
    Uses raw page text — no dependency on DOM selectors for structured data."""
    # Prefer experience_raw_text (from /details/experience/ subpage) over page_text
    raw_text = profile.get("experience_raw_text") or ""
    page_text = profile.get("page_text") or ""

    if raw_text:
        raw_text = clean_raw_text(raw_text)
    if page_text:
        page_text = clean_raw_text(page_text)

    # Use experience subpage text for roles, main page text for about/location/connections
    experience_text = raw_text or page_text
    profile_text = page_text or raw_text

    prompt = f"""Parse this LinkedIn profile data. Return ONLY valid JSON, no other text.

MAIN PROFILE PAGE TEXT:
{profile_text[:3000]}

EXPERIENCE DETAIL TEXT:
{experience_text[:5000]}

Return this JSON structure:
{{
  "name": "Person's full name",
  "location": "City, Country or region as shown on profile",
  "mutual_connections_count": number or 0,
  "mutual_connections_names": ["Name1", "Name2"] or [],
  "current_company": "SHORT common name of current operational job (not board). 'Rovio' not 'Rovio Entertainment Corporation'.",
  "current_role_short": "shortest standard form. CEO not Chief Executive Officer. Strip Full-time/Part-time/Contract.",
  "about_summary": "1-2 concise sentences summarising the person. Empty string if no About.",
  "employment": [
    {{"company": "Short Company Name", "role": "Short role title", "years": "total time at company", "summary": "1 sentence max 80 chars"}},
    ...
  ],
  "board": [
    {{"company": "Short Org Name", "years": "duration"}},
    ...
  ]
}}

Rules:
- Parse the raw text carefully. LinkedIn groups multiple roles under a company header. The company name appears once, then each role underneath with its own dates and duration. A total tenure line (e.g. "7 yrs 4 mos") often appears right after the company name.
- Company names: ALWAYS use the shortest well-known form. Strip suffixes like "Corporation", "Entertainment", "Inc", "Ltd", "LLC", "Group", "Digital Entertainment", "Interactive", etc. Examples: "Rovio" not "Rovio Entertainment Corporation", "King" not "King Digital Entertainment", "EA" not "Electronic Arts Inc".
- employment: operational jobs (CEO, CTO, VP, Engineer, Manager, Director, Founder, GM, Co-Founder, Partner, EVP, SVP, etc.)
- board: Board Member, NED, Advisory Board, Advisor, Fellow, Trustee, Patron, Mentor, Ambassador, Judge
- If someone has BOTH operational AND board roles at the same company, list the operational role under employment AND the board role under board.
- HOW TO READ THE RAW TEXT: LinkedIn groups roles under a company name. Right after the company name is a TOTAL TENURE line like "4 yrs 10 mos" or "7 yrs 4 mos". Then individual roles follow with their own dates. The same company can appear MULTIPLE TIMES as separate groups if the person had distinct stints there.
- FOR EACH GROUP: Create ONE employment entry. The role title should be the most senior operational title in that group. For "years": if the group contains ONLY operational roles, use the group total tenure line. But if the group mixes operational and board roles, use the operational role's own duration (not the group total, which would be inflated by the board tenure).
- If a company appears in TWO separate groups, create TWO separate employment entries, each with its own group total. Example: if "Gameloft" appears with "4 yrs 10 mos" and again later with "9 yrs 8 mos", output TWO entries for Gameloft.
- You MUST output an employment entry for EVERY company group in the raw text. Do not skip any.
- Board list: include ALL board/advisory roles. No summary, just company and duration.
- Role titles: shortest recognisable form. Strip "Full-time", "Part-time", "Contract", "Permanent".
- Years: ALWAYS include a numeric duration for EVERY entry, no exceptions. Compact form: "14y" or "2y 6m" or "9m". For current/ongoing roles, append " current" e.g. "7y 4m current" or "9m current". If the raw text only shows "Present" with a start date, calculate the approximate duration from the start date to today (April 2026). NEVER output just "current" alone — always include the number first. NEVER leave years empty or omit the duration.
- Summary: 1 short sentence per employment entry. Keep under 80 chars.
- Order: most recent first
- Max 7 employment entries, all board entries"""

    response_text = call_claude(api_key, prompt)

    json_match = re.search(r'\{[\s\S]*\}', response_text)
    if json_match:
        return json.loads(json_match.group())

    raise ValueError("Could not parse LLM response")


def safe_filename(name):
    cleaned = re.sub(r'[<>:"/\\|?*]', '-', name)
    cleaned = cleaned.strip('. ')
    return cleaned[:200]


def short_role(title):
    if not title:
        return "Professional"
    cleaned = re.sub(r"\s*[-\u2013|,].*$", "", title).strip()
    return cleaned[:40]


def calc_years(date_range):
    if not date_range:
        return ""
    m = re.search(r"(\d+)\s*yr", date_range, re.I)
    mo = re.search(r"(\d+)\s*mo", date_range, re.I)
    if m or mo:
        yrs = int(m.group(1)) if m else 0
        mos = int(mo.group(1)) if mo else 0
        if yrs > 0 and mos > 0:
            return f"{yrs}y {mos}m"
        if yrs > 0:
            return f"{yrs}y"
        return f"{mos}m"
    return date_range


def format_role_bullet(exp):
    """Format a role as a single short line: - **Company**: Title, duration"""
    company = exp.get("company", "")
    title = exp.get("title", "")
    # Strip qualifiers from title
    title = re.sub(r'\s*[\(\-]\s*(Full.time|Part.time|Contract|Permanent|Freelance)\s*[\)\-]?\s*', '', title, flags=re.I).strip()
    years = calc_years(exp.get("duration", "") or exp.get("date_range", ""))
    parts = [f"**{company}**"]
    if title:
        parts.append(f": {title}")
    if years:
        parts.append(f" ({years})")
    return "- " + "".join(parts)


def build_markdown(profile, llm_result):
    """Build a concise markdown note from LLM-processed data."""
    # Name: prefer LLM-extracted, fall back to content script heuristic
    name = llm_result.get("name") or profile.get("name", "Unknown")
    company = llm_result.get("current_company", "Independent")
    role_short = llm_result.get("current_role_short", "Professional")
    url = profile.get("url", "")

    note_title = f"{name} - {company} - {role_short}"

    # Location: from LLM
    location = llm_result.get("location", "")
    lines = []
    link_line = f"[LinkedIn Profile]({url})" if url else ""
    if link_line and location:
        link_line += f" | {location}"
    elif location:
        link_line = location
    lines.append(link_line)

    # Mutual connections: from LLM
    mc_count = llm_result.get("mutual_connections_count", 0)
    mc_names = llm_result.get("mutual_connections_names", [])
    if mc_count > 0:
        mc_line = f"**{mc_count} mutual connection{'s' if mc_count != 1 else ''}**"
        if mc_names:
            mc_line += f" including {', '.join(mc_names)}"
        lines.append(mc_line)

    lines.append("")

    if profile.get("photo_url"):
        lines.append(f"![{name}]({profile['photo_url']})")
        lines.append("")

    about_summary = llm_result.get("about_summary", "")
    if about_summary:
        lines.append(f"*{about_summary}*")
        lines.append("")

    # Employment bullets
    for emp in llm_result.get("employment", []):
        years = emp.get('years', '')
        line = f"- **{emp['company']}**: {emp['role']}"
        if years:
            line += f" ({years})"
        if emp.get("summary"):
            line += f" - {emp['summary']}"
        lines.append(line)

    if llm_result.get("employment"):
        lines.append("")

    # Board memberships — use raw profile data for duration since LLM often drops it
    board = llm_result.get("board", [])
    if board:
        # Build a lookup of duration/date_range from raw experience data
        raw_exps = profile.get("experiences") or []
        board_durations = {}
        for exp in raw_exps:
            company = exp.get("company", "")
            title = (exp.get("title", "") or "").lower()
            if any(kw in title for kw in ["board", "advisor", "advisory", "fellow", "trustee", "ned", "non-executive", "patron", "mentor"]):
                dur = exp.get("duration", "") or exp.get("date_range", "")
                is_current = "present" in (exp.get("date_range", "") or "").lower()
                board_durations[company] = (dur, is_current)

        lines.append("**Boards:**")
        for b in board:
            company = b.get('company', '')
            years = b.get('years', '')
            # Fall back to raw data if LLM left years empty
            if not years and company in board_durations:
                raw_dur, is_current = board_durations[company]
                years = calc_years(raw_dur)
                if is_current and "current" not in years:
                    years += " current" if years else "current"
            line = f"- {company}"
            if years:
                line += f" ({years})"
            lines.append(line)
        lines.append("")

    # Education
    edus = profile.get("education") or []
    if edus:
        edu_parts = []
        for e in edus:
            s = e.get("school", "")
            if e.get("degree"):
                s += f" ({e['degree']})"
            edu_parts.append(s)
        lines.append(f"**Education:** {'; '.join(edu_parts)}")
        lines.append("")

    return note_title, "\n".join(lines)


def build_markdown_fallback(profile):
    """Fallback without LLM -- raw text dump with basic formatting."""
    name = profile.get("name", "Unknown")
    url = profile.get("url", "")

    note_title = f"{name}"

    lines = []
    if url:
        lines.append(f"[LinkedIn Profile]({url})")
    lines.append("")

    if profile.get("photo_url"):
        lines.append(f"![{name}]({profile['photo_url']})")
        lines.append("")

    # Include raw page text as-is when LLM is unavailable
    page_text = profile.get("page_text", "")
    if page_text:
        lines.append(page_text[:3000])
    else:
        lines.append("*Profile data could not be processed (no API key configured)*")
    lines.append("")

    return note_title, "\n".join(lines)


def find_obsidian_vaults():
    vaults = []
    obsidian_config = os.path.expanduser(
        "~/Library/Application Support/obsidian/obsidian.json"
    )
    if os.path.exists(obsidian_config):
        try:
            with open(obsidian_config) as f:
                config = json.load(f)
            for vault_info in config.get("vaults", {}).values():
                path = vault_info.get("path", "")
                if path and os.path.isdir(path):
                    vaults.append(path)
        except Exception:
            pass

    if not vaults:
        search_paths = [
            os.path.expanduser("~/Documents"),
            os.path.expanduser("~/Dropbox"),
            os.path.expanduser("~/Library/Mobile Documents/iCloud~md~obsidian/Documents"),
            os.path.expanduser("~/OneDrive"),
        ]
        for base in search_paths:
            if not os.path.isdir(base):
                continue
            for entry in os.scandir(base):
                if entry.is_dir() and os.path.isdir(os.path.join(entry.path, ".obsidian")):
                    vaults.append(entry.path)

    return sorted(set(vaults))


def run_enrich_skill(filepath):
    """Run the enrich-profile Claude Code skill on a saved note.
    Reads the skill definition and passes it as a prompt to claude CLI.
    Runs in the background (non-blocking)."""
    # Find the vault root (.obsidian directory) and its parent for Claude cwd
    vault_root = None
    check = os.path.dirname(filepath)
    while check and check != "/":
        if os.path.isdir(os.path.join(check, ".obsidian")):
            vault_root = check
            break
        check = os.path.dirname(check)
    if not vault_root:
        vault_root = os.path.dirname(filepath)
    # Claude project is mapped to the parent of the vault (e.g. /Users/steve/Dropbox/obsidian)
    claude_cwd = os.path.dirname(vault_root)
    if not os.path.isdir(claude_cwd):
        claude_cwd = vault_root

    # Find the skill definition file
    skill_path = os.path.expanduser(
        "~/.claude/projects/-Users-steve-Dropbox-obsidian/commands/enrich-profile.md"
    )
    if not os.path.exists(skill_path):
        return "Skill file not found"

    claude_path = os.path.expanduser("~/.local/bin/claude")
    if not os.path.exists(claude_path):
        claude_path = "claude"

    status_file = os.path.join(vault_root, ".schmusher_enrich_status")
    log_file = os.path.join(vault_root, ".schmusher_enrich_log")

    # Delete old status first so poll doesn't see stale "done"
    if os.path.exists(status_file):
        os.unlink(status_file)

    # Prompt that tells claude to read the skill file and execute it
    prompt = (
        f"Read the instructions in {skill_path} and execute them "
        f"on this profile file: {filepath}. "
        f"IMPORTANT: Do NOT move or rename the file. Edit it in its current location only. "
        f"Skip Step 4 (Determine File Location) and Step 6 (Update Index) entirely. "
        f"FORMATTING: In the Connections section, do NOT add blank lines between bullet points. "
        f"Keep each bullet to a maximum of 2 lines. Be concise."
    )

    # Write a small monitor script that runs claude then updates status
    monitor_script = os.path.join(vault_root, ".schmusher_enrich_run.sh")
    with open(monitor_script, "w") as ms:
        ms.write(f'''#!/bin/bash
export HOME="{os.path.expanduser("~")}"
export PATH="/usr/local/bin:/usr/bin:/bin:{os.path.expanduser("~/.local/bin")}"
cd "{claude_cwd}"
"{claude_path}" -p "Read the instructions in {skill_path} and execute them on this profile file: {filepath}" --dangerously-skip-permissions > "{log_file}" 2>&1
RC=$?
if [ $RC -eq 0 ]; then
    printf '{{"status":"done","file":"%s"}}' "{filepath}" > "{status_file}"
else
    printf '{{"status":"failed","file":"%s","rc":%d}}' "{filepath}" "$RC" > "{status_file}"
fi
rm -f "{monitor_script}"
''')
    os.chmod(monitor_script, 0o755)

    proc = subprocess.Popen(
        [monitor_script],
        cwd=claude_cwd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )

    with open(status_file, "w") as sf:
        sf.write(json.dumps({"status": "running", "file": filepath, "pid": proc.pid}))

    return f"Enrichment started (pid {proc.pid})"


def list_folders(path):
    path = os.path.expanduser(path)
    if not os.path.isdir(path):
        return []
    folders = []
    try:
        for entry in sorted(os.scandir(path), key=lambda e: e.name.lower()):
            if entry.is_dir() and not entry.name.startswith("."):
                folders.append(entry.name)
    except PermissionError:
        pass
    return folders


def extract_custom_sections(existing_content):
    """Extract manually-added sections from an existing note.
    Returns content after the auto-generated profile data that should be preserved."""
    # The auto-generated content ends at **Education:** line or the last bullet point
    # Everything after that (## Connections, ## Questions, custom notes, etc.) is preserved
    lines = existing_content.split("\n")
    preserve_from = None

    # Known auto-generated markers — find where they end
    auto_markers = ["**Education:**", "**Boards:**"]
    last_auto_line = 0

    for i, line in enumerate(lines):
        for marker in auto_markers:
            if line.startswith(marker):
                last_auto_line = i

    # Look for the first ## heading after auto content, or any content after Education
    for i in range(last_auto_line + 1, len(lines)):
        line = lines[i].strip()
        if line.startswith("## ") or (line and not line.startswith("-") and line != ""):
            # Skip blank lines between auto content and custom sections
            if line:
                preserve_from = i
                break

    if preserve_from is not None:
        preserved = "\n".join(lines[preserve_from:]).strip()
        if preserved:
            return preserved
    return ""


def save_note(folder, title, content, ext):
    folder = os.path.expanduser(folder)
    if not os.path.isdir(folder):
        raise ValueError(f"Folder does not exist: {folder}")

    filename = f"{safe_filename(title)}.{ext}"
    filepath = os.path.join(folder, filename)

    if os.path.exists(filepath):
        # Read existing file and preserve custom sections
        with open(filepath, "r", encoding="utf-8") as f:
            existing = f.read()

        custom = extract_custom_sections(existing)
        if custom:
            # Merge: new profile data + preserved custom sections
            content = content.rstrip("\n") + "\n\n" + custom + "\n"

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)

    return filename


def main():
    msg = read_message()
    if not msg:
        return

    action = msg.get("action")

    if action == "ping":
        vaults = find_obsidian_vaults()
        file_key = load_api_key()
        send_message({
            "success": True,
            "version": "3.0.0",
            "vaults": vaults,
            "defaultVault": vaults[0] if vaults else "",
            "hasFileKey": bool(file_key),
        })

    elif action == "checkEnrich":
        try:
            folder = msg.get("folder", "")
            vault_root = None
            check = os.path.expanduser(folder)
            while check and check != "/":
                if os.path.isdir(os.path.join(check, ".obsidian")):
                    vault_root = check
                    break
                check = os.path.dirname(check)
            status_file = os.path.join(vault_root or folder, ".schmusher_enrich_status")
            if os.path.exists(status_file):
                with open(status_file) as sf:
                    status = json.load(sf)
                send_message({"success": True, "enrich": status})
            else:
                send_message({"success": True, "enrich": {"status": "none"}})
        except Exception as e:
            send_message({"success": False, "error": str(e)})

    elif action == "triggerEnrich":
        try:
            filepath = msg.get("filepath", "")
            folder = msg.get("folder", "")
            if not filepath or not os.path.exists(filepath):
                send_message({"success": False, "error": f"File not found: {filepath}"})
            else:
                result = run_enrich_skill(filepath)
                send_message({"success": True, "enrich": result})
        except Exception as e:
            send_message({"success": False, "error": str(e)})

    elif action == "listFolders":
        try:
            path = msg.get("path", "")
            folders = list_folders(path)
            send_message({"success": True, "folders": folders, "path": path})
        except Exception as e:
            send_message({"success": False, "error": str(e)})

    elif action == "saveNote":
        try:
            folder = msg.get("folder", "")
            profile = msg.get("profile", {})
            ext = msg.get("ext", "md")

            # API key: prefer from message (Chrome sync), fall back to config file
            api_key = msg.get("apiKey") or load_api_key()

            if ext == "json":
                # JSON format — no LLM processing needed
                from datetime import datetime
                title = f"{profile.get('name', 'Unknown')}"
                content = json.dumps(profile, indent=2)
                filename = save_note(folder, title, content, ext)
                send_message({"success": True, "filename": filename})
                return

            # Markdown format — use LLM if available
            if api_key and (profile.get("page_text") or profile.get("experience_raw_text") or profile.get("experiences")):
                try:
                    llm_result = process_profile_with_llm(api_key, profile)
                    title, content = build_markdown(profile, llm_result)
                except Exception as llm_err:
                    llm_result = None
                    title, content = build_markdown_fallback(profile)
            else:
                llm_result = None
                title, content = build_markdown_fallback(profile)

            filename = save_note(folder, title, content, ext)
            filepath = os.path.join(os.path.expanduser(folder), filename)

            # Trigger enrich-profile skill if enabled
            enrich = msg.get("enrich", False)
            enrich_status = ""
            if enrich:
                try:
                    enrich_status = run_enrich_skill(filepath)
                except Exception as e:
                    enrich_status = f"Enrich failed: {e}"

            resp = {"success": True, "filename": filename, "title": title}
            if enrich_status:
                resp["enrich"] = enrich_status
            send_message(resp)
        except Exception as e:
            send_message({"success": False, "error": str(e)})

    else:
        send_message({"success": False, "error": f"Unknown action: {action}"})


if __name__ == "__main__":
    main()
