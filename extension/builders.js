/**
 * Output builders - generates Obsidian Markdown or JSON from profile data.
 */

const DEFAULT_FORMAT = {
  note_title: "{{name}} - {{company}} - {{role}}",
  max_roles: 5,
  photo_width: 300,
};

function shortRole(title) {
  if (!title) return "Professional";
  return title
    .replace(/\s*[-\u2013|,].*$/, "")
    .trim()
    .substring(0, 40);
}

function calcYears(dateRange) {
  if (!dateRange) return "";
  const yrsMatch = dateRange.match(/(\d+)\s*yr/i);
  const mosMatch = dateRange.match(/(\d+)\s*mo/i);
  if (yrsMatch || mosMatch) {
    const yrs = yrsMatch ? parseInt(yrsMatch[1]) : 0;
    const mos = mosMatch ? parseInt(mosMatch[1]) : 0;
    if (yrs > 0 && mos > 0) return `${yrs}y ${mos}m`;
    if (yrs > 0) return `${yrs}y`;
    return `${mos}m`;
  }
  return dateRange;
}

function buildNoteTitle(profile, format) {
  const currentCompany = profile.experiences?.[0]?.company || "Independent";
  const currentRole = shortRole(profile.experiences?.[0]?.title);

  return (format?.note_title || DEFAULT_FORMAT.note_title)
    .replace("{{name}}", profile.name || "Unknown")
    .replace("{{company}}", currentCompany)
    .replace("{{role}}", currentRole)
    .replace("{{headline}}", profile.headline || "");
}

function buildMarkdown(profile, format) {
  const max = format?.max_roles || 5;
  const currentCompany = profile.experiences?.[0]?.company || "Independent";
  const currentRole = shortRole(profile.experiences?.[0]?.title);
  const title = `${profile.name} - ${currentCompany} - ${currentRole}`;

  const lines = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(profile.url);
  lines.push("");

  if (profile.photo_url) {
    lines.push(`![${profile.name}](${profile.photo_url})`);
    lines.push("");
  }

  if (profile.headline) {
    lines.push(`**${profile.headline}**`);
    if (profile.location) lines.push(`${profile.location}`);
    lines.push("");
  }

  if (profile.about) {
    lines.push("## About");
    lines.push(profile.about);
    lines.push("");
  }

  const roles = (profile.experiences || []).slice(0, max);
  if (roles.length > 0) {
    lines.push("## Experience");
    lines.push("");
    for (const exp of roles) {
      const years = calcYears(exp.duration || exp.date_range);
      let desc = (exp.description || "").split("\n")[0].substring(0, 120);
      if (!desc) desc = exp.title;
      lines.push(`- **${exp.company}**: ${exp.title}, ${years}, ${desc}`);
    }
    lines.push("");
  }

  const edus = profile.education || [];
  if (edus.length > 0) {
    const eduStr = edus
      .map((e) => {
        let s = e.school || "";
        if (e.degree) s += ` (${e.degree})`;
        return s;
      })
      .join("; ");
    lines.push(`**Education:** ${eduStr}`);
    lines.push("");
  }

  return lines.join("\n");
}

function buildJson(profile, format) {
  const max = format?.max_roles || 5;
  const currentCompany = profile.experiences?.[0]?.company || "Independent";
  const currentRole = shortRole(profile.experiences?.[0]?.title);

  return JSON.stringify(
    {
      name: profile.name,
      title: `${profile.name} - ${currentCompany} - ${currentRole}`,
      url: profile.url,
      headline: profile.headline,
      location: profile.location,
      about: profile.about,
      experience: (profile.experiences || []).slice(0, max).map((exp) => ({
        company: exp.company,
        title: exp.title,
        duration: calcYears(exp.duration || exp.date_range),
        date_range: exp.date_range,
        description: (exp.description || "").split("\n")[0].substring(0, 120) || exp.title,
      })),
      education: (profile.education || []).map((e) => ({
        school: e.school,
        degree: e.degree,
        date_range: e.date_range,
      })),
      extracted_at: profile.extracted_at,
    },
    null,
    2
  );
}
