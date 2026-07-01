// scripts/fixtures/electron-stub.mjs
var app = {
  getPath: () => "/tmp",
  isPackaged: false,
  on: () => {
  },
  whenReady: () => ({ then: () => {
  } })
};

// src/main/workspace.ts
import { mkdir, readFile, writeFile, readdir, stat, access, rm, rename } from "fs/promises";
import { join, resolve, dirname, extname, relative, sep } from "path";
import { spawn } from "child_process";
var serverPort = 0;
function workspacesRoot() {
  return join(app.getPath("userData"), "workspaces");
}
function workspaceDir(conversationId) {
  return join(workspacesRoot(), sanitizeId(conversationId));
}
function sanitizeId(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "default";
}
async function ensureWorkspace(conversationId) {
  const dir = workspaceDir(conversationId);
  await mkdir(dir, { recursive: true });
  return dir;
}
function assertInWorkspace(base, target) {
  const resolved = resolve(base, target);
  const rel = relative(base, resolved);
  if (rel.startsWith("..") || rel.startsWith("/") || rel.includes(".." + sep)) {
    throw new Error(`Path escapes workspace: ${target}`);
  }
  return resolved;
}
function previewUrl(conversationId) {
  return `http://127.0.0.1:${serverPort}/${sanitizeId(conversationId)}/`;
}
async function listTree(base, max = 200) {
  const out = [];
  async function walk(dir, prefix) {
    if (out.length >= max) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.name === "node_modules") continue;
      const p = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push({ path: p, kind: "dir" });
        await walk(join(dir, e.name), p);
      } else {
        try {
          const s = await stat(join(dir, e.name));
          out.push({ path: p, kind: "file", size: s.size });
        } catch {
          out.push({ path: p, kind: "file" });
        }
      }
      if (out.length >= max) return;
    }
  }
  await walk(base, "");
  return out;
}
async function wsWriteFile(conversationId, path, content) {
  const base = await ensureWorkspace(conversationId);
  const target = assertInWorkspace(base, path);
  await mkdir(dirname(target), { recursive: true });
  const tmp = target + ".tmp-" + Date.now();
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, target);
  return target;
}
async function wsReadFile(conversationId, path) {
  const base = await ensureWorkspace(conversationId);
  const target = assertInWorkspace(base, path);
  return readFile(target, "utf-8");
}
async function wsEditFile(conversationId, path, oldString, newString, replaceAll = false) {
  const content = await wsReadFile(conversationId, path);
  if (replaceAll) {
    const parts = content.split(oldString);
    if (parts.length === 1) throw new Error(`old_string not found in ${path}`);
    const next2 = parts.join(newString);
    await wsWriteFile(conversationId, path, next2);
    return { occurrences: parts.length - 1 };
  }
  const idx = content.indexOf(oldString);
  if (idx < 0) throw new Error(`old_string not found in ${path}`);
  const second = content.indexOf(oldString, idx + oldString.length);
  if (second >= 0) {
    throw new Error(`old_string appears multiple times in ${path}. Use replace_all or add context.`);
  }
  const next = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
  await wsWriteFile(conversationId, path, next);
  return { occurrences: 1 };
}
async function wsDeleteFile(conversationId, path) {
  const base = await ensureWorkspace(conversationId);
  const target = assertInWorkspace(base, path);
  await rm(target, { recursive: true, force: true });
}
var BASH_DENY = /\b(rm\s+-rf\s+\/|sudo|:\(\)\s*\{|chmod\s+777\s+\/|mkfs|dd\s+if=|shutdown|reboot)/i;
async function wsRunBash(conversationId, command, timeoutMs = 6e4, maxBytes = 16e3) {
  if (BASH_DENY.test(command)) {
    throw new Error("Blocked by safety policy: command contains a denied pattern.");
  }
  const base = await ensureWorkspace(conversationId);
  const start = Date.now();
  return new Promise((resolve2) => {
    const proc = spawn("/bin/bash", ["-lc", command], {
      cwd: base,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    const killTimer = setTimeout(() => {
      proc.kill("SIGKILL");
      truncated = true;
    }, timeoutMs);
    proc.stdout.on("data", (d) => {
      if (stdout.length < maxBytes) {
        stdout += d.toString("utf-8");
        if (stdout.length >= maxBytes) {
          stdout = stdout.slice(0, maxBytes) + "\n[\u2026output truncated]";
          truncated = true;
        }
      }
    });
    proc.stderr.on("data", (d) => {
      if (stderr.length < maxBytes) {
        stderr += d.toString("utf-8");
        if (stderr.length >= maxBytes) {
          stderr = stderr.slice(0, maxBytes) + "\n[\u2026stderr truncated]";
          truncated = true;
        }
      }
    });
    proc.on("close", (code) => {
      clearTimeout(killTimer);
      resolve2({
        exitCode: code,
        stdout,
        stderr,
        truncated,
        durationMs: Date.now() - start
      });
    });
    proc.on("error", (e) => {
      clearTimeout(killTimer);
      resolve2({
        exitCode: -1,
        stdout,
        stderr: (stderr + "\n" + String(e)).trim(),
        truncated,
        durationMs: Date.now() - start
      });
    });
  });
}

// src/main/html-assets.ts
function ensureHtmlAssetReferences(html, refs) {
  let next = html;
  if (refs.stylesheet && !hasHref(next, refs.stylesheet)) {
    const link = `<link rel="stylesheet" href="${refs.stylesheet}">`;
    next = insertBeforeClosingTag(next, "head", link);
  }
  if (refs.script && !hasSrc(next, refs.script)) {
    const script = `<script src="${refs.script}" defer></script>`;
    next = insertBeforeClosingTag(next, "head", script);
  }
  return next;
}
function hasHref(html, href) {
  return new RegExp(`<link\\b[^>]*\\bhref=["']${escapeRegExp(href)}["']`, "i").test(html);
}
function hasSrc(html, src) {
  return new RegExp(`<script\\b[^>]*\\bsrc=["']${escapeRegExp(src)}["']`, "i").test(html);
}
function insertBeforeClosingTag(html, tag, line) {
  const closeRe = new RegExp(`\\n?</${tag}>`, "i");
  if (closeRe.test(html)) {
    return html.replace(closeRe, `
${line}
</${tag}>`);
  }
  return `${html.trimEnd()}
${line}
`;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/main/write-file-args.ts
function getWriteFileContent(args) {
  return typeof args.content === "string" ? args.content : null;
}

// src/main/tools.ts
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
async function webSearch(args) {
  const query = String(args.query ?? "").trim();
  if (!query) return "Error: missing query";
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
  if (!res.ok) return `Search failed: ${res.status} ${res.statusText}`;
  const html = await res.text();
  const results = parseDuckDuckGoResults(html).slice(0, 6);
  if (results.length === 0) return "No results found.";
  return results.map((r, i) => `[${i + 1}] ${r.title}
${r.url}
${r.snippet}`).join("\n\n");
}
function parseDuckDuckGoResults(html) {
  const results = [];
  const blockRe = /<div class="result[^"]*?"[^>]*>([\s\S]*?)<div class="clear"/g;
  const titleRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;
  let m;
  while (m = blockRe.exec(html)) {
    const block = m[1];
    const t = titleRe.exec(block);
    const s = snippetRe.exec(block);
    if (!t) continue;
    const rawUrl = decodeURIComponent(t[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "")).split("&rut=")[0].split("&amp;")[0];
    const cleanUrl = rawUrl.split("&")[0];
    const title = stripTags(t[2]).trim();
    const snippet = s ? stripTags(s[1]).trim() : "";
    if (title && cleanUrl.startsWith("http")) {
      results.push({ title, url: cleanUrl, snippet });
    }
    if (results.length >= 10) break;
  }
  return results;
}
function stripTags(s) {
  return s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
async function fetchUrl(args) {
  const url = String(args.url ?? "").trim();
  if (!url) return "Error: missing url";
  if (!/^https?:\/\//.test(url)) return "Error: url must be http(s)";
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) return `Fetch failed: ${res.status} ${res.statusText}`;
    const ct = res.headers.get("content-type") || "";
    const text = await res.text();
    if (ct.includes("html")) {
      return htmlToText(text).slice(0, 8e3);
    }
    return text.slice(0, 8e3);
  } catch (e) {
    return `Error fetching: ${e.message}`;
  }
}
function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
async function calc(args) {
  const expr = String(args.expression ?? "").trim();
  if (!expr) return "Error: missing expression";
  if (!/^[0-9+\-*/().\s^%,eE]*$/.test(expr)) {
    return "Error: only numeric expressions allowed";
  }
  try {
    const sanitized = expr.replace(/\^/g, "**");
    const result = Function(`"use strict"; return (${sanitized})`)();
    return String(result);
  } catch (e) {
    return `Error: ${e.message}`;
  }
}
async function writeFile2(args, ctx) {
  const path = String(args.path ?? "").trim();
  if (!path) return "Error: missing <path>";
  const raw = getWriteFileContent(args);
  if (raw == null) return "Error: missing <content>";
  const content = cleanFileContent(raw, path);
  await wsWriteFile(ctx.conversationId, path, content);
  await repairIndexAssetReferences(ctx, path);
  ctx.onFileChange?.();
  const lines = content.split("\n").length;
  return `Wrote ${path} (${content.length} bytes, ${lines} lines).`;
}
async function repairIndexAssetReferences(ctx, writtenPath) {
  const normalizedPath = writtenPath.replace(/^\.\/+/, "");
  if (!["index.html", "style.css", "app.js"].includes(normalizedPath)) return;
  try {
    const indexHtml = await wsReadFile(ctx.conversationId, "index.html");
    const refs = {};
    try {
      await wsReadFile(ctx.conversationId, "style.css");
      refs.stylesheet = "style.css";
    } catch {
    }
    try {
      await wsReadFile(ctx.conversationId, "app.js");
      refs.script = "app.js";
    } catch {
    }
    const repaired = ensureHtmlAssetReferences(indexHtml, refs);
    if (repaired !== indexHtml) {
      await wsWriteFile(ctx.conversationId, "index.html", repaired);
    }
  } catch {
  }
}
function cleanFileContent(raw, path) {
  let s = raw;
  const full = s.trim().match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```[\s\S]*$/);
  if (full) {
    s = full[1];
  } else {
    const lead = s.match(/^\s*```[a-zA-Z0-9_-]*\n/);
    if (lead) {
      s = s.slice(lead[0].length);
      const trail = s.search(/\n```(?:\s|$)/);
      if (trail >= 0) s = s.slice(0, trail);
    }
  }
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    const end = s.toLowerCase().lastIndexOf("</html>");
    if (end >= 0) s = s.slice(0, end + "</html>".length) + "\n";
  } else if (lower.endsWith(".svg")) {
    const end = s.toLowerCase().lastIndexOf("</svg>");
    if (end >= 0) s = s.slice(0, end + "</svg>".length) + "\n";
  } else if (lower.endsWith(".json")) {
    const trimmed = s.trim();
    const lastBrace = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (lastBrace >= 0) s = trimmed.slice(0, lastBrace + 1) + "\n";
  } else if (lower.endsWith(".css")) {
    const trimmed = s.trim();
    if (trimmed && !trimmed.endsWith("}")) {
      const lastRuleEnd = trimmed.lastIndexOf("}");
      if (lastRuleEnd >= 0) s = trimmed.slice(0, lastRuleEnd + 1) + "\n";
    }
  }
  return s;
}
async function readFile2(args, ctx) {
  const path = String(args.path ?? "").trim();
  if (!path) return "Error: missing <path>";
  try {
    const content = await wsReadFile(ctx.conversationId, path);
    if (content.length > 2e4) {
      return content.slice(0, 2e4) + "\n[\u2026truncated]";
    }
    return content;
  } catch (e) {
    return `Error reading ${path}: ${e.message}`;
  }
}
async function editFile(args, ctx) {
  const path = String(args.path ?? "").trim();
  const oldStr = typeof args.old_string === "string" ? args.old_string : "";
  const newStr = typeof args.new_string === "string" ? args.new_string : "";
  const replaceAll = args.replace_all === true || args.replace_all === "true";
  if (!path) return "Error: missing <path>";
  if (!oldStr) return "Error: missing <old_string>";
  try {
    const r = await wsEditFile(ctx.conversationId, path, oldStr, newStr, replaceAll);
    ctx.onFileChange?.();
    return `Edited ${path} (${r.occurrences} replacement${r.occurrences === 1 ? "" : "s"}).`;
  } catch (e) {
    return `Error editing ${path}: ${e.message}`;
  }
}
async function listFiles(_args, ctx) {
  const base = await ensureWorkspace(ctx.conversationId);
  const tree = await listTree(base, 200);
  if (tree.length === 0) return "(workspace is empty)";
  return tree.map(
    (e) => e.kind === "dir" ? `${e.path}/` : `${e.path}${e.size != null ? ` (${e.size}B)` : ""}`
  ).join("\n");
}
async function deleteFile(args, ctx) {
  const path = String(args.path ?? "").trim();
  if (!path) return "Error: missing <path>";
  try {
    await wsDeleteFile(ctx.conversationId, path);
    ctx.onFileChange?.();
    return `Deleted ${path}.`;
  } catch (e) {
    return `Error deleting ${path}: ${e.message}`;
  }
}
async function runBash(args, ctx) {
  const command = String(args.command ?? "").trim();
  const timeout = typeof args.timeout_ms === "number" ? args.timeout_ms : 6e4;
  if (!command) return "Error: missing <command>";
  try {
    const r = await wsRunBash(ctx.conversationId, command, timeout);
    ctx.onFileChange?.();
    const parts = [];
    parts.push(`exit=${r.exitCode ?? "killed"} (${r.durationMs}ms)`);
    if (r.stdout) parts.push("stdout:\n" + r.stdout);
    if (r.stderr) parts.push("stderr:\n" + r.stderr);
    if (r.truncated) parts.push("[output was truncated]");
    return parts.join("\n");
  } catch (e) {
    return `Error: ${e.message}`;
  }
}
async function openPreview(_args, ctx) {
  const url = previewUrl(ctx.conversationId);
  return `Preview is live at ${url}. The Canvas pane on the right shows it.`;
}
var TOOLS = {
  web_search: {
    name: "web_search",
    description: "Search the web via DuckDuckGo. Returns a numbered list of results.",
    params: [{ name: "query", description: "what to search for", required: true }],
    example: '<action name="web_search">\n<query>latest tensorflow release notes</query>\n</action>',
    mode: "both",
    run: webSearch
  },
  fetch_url: {
    name: "fetch_url",
    description: "Fetch a web page and return its text content (truncated to ~8KB).",
    params: [{ name: "url", description: "absolute http(s) URL", required: true }],
    example: '<action name="fetch_url">\n<url>https://example.com</url>\n</action>',
    mode: "both",
    run: fetchUrl
  },
  calc: {
    name: "calc",
    description: "Evaluate a numeric expression.",
    params: [{ name: "expression", description: "math expression", required: true }],
    example: '<action name="calc">\n<expression>2 + 2 * 3</expression>\n</action>',
    mode: "both",
    run: calc
  },
  write_file: {
    name: "write_file",
    description: "Create or overwrite a file in the workspace. Use this to generate code, HTML, CSS, JSON, etc.",
    params: [
      { name: "path", description: "path relative to workspace (e.g. index.html)", required: true },
      { name: "content", description: "full file text", required: true, multiline: true }
    ],
    example: '<action name="write_file">\n<path>index.html</path>\n<content>\n<!doctype html>\n<html>\n<body>Hello</body>\n</html>\n</content>\n</action>',
    mode: "code",
    run: writeFile2
  },
  read_file: {
    name: "read_file",
    description: "Read a file from the workspace.",
    params: [{ name: "path", description: "path relative to workspace", required: true }],
    example: '<action name="read_file">\n<path>index.html</path>\n</action>',
    mode: "code",
    run: readFile2
  },
  edit_file: {
    name: "edit_file",
    description: "Replace a snippet in an existing file. old_string must appear exactly once, or pass <replace_all>true</replace_all>.",
    params: [
      { name: "path", description: "file path", required: true },
      { name: "old_string", description: "exact text to find", required: true, multiline: true },
      { name: "new_string", description: "replacement text", required: true, multiline: true },
      { name: "replace_all", description: "true to replace every occurrence" }
    ],
    example: '<action name="edit_file">\n<path>index.html</path>\n<old_string>Hello</old_string>\n<new_string>Hello, world</new_string>\n</action>',
    mode: "code",
    run: editFile
  },
  list_files: {
    name: "list_files",
    description: "List every file in the workspace.",
    params: [],
    example: '<action name="list_files"></action>',
    mode: "code",
    run: listFiles
  },
  delete_file: {
    name: "delete_file",
    description: "Delete a file or directory from the workspace.",
    params: [{ name: "path", description: "path to delete", required: true }],
    example: '<action name="delete_file">\n<path>old.html</path>\n</action>',
    mode: "code",
    run: deleteFile
  },
  run_bash: {
    name: "run_bash",
    description: "Run a bash command inside the workspace directory. Use for npm install, git, formatters, quick checks.",
    params: [
      { name: "command", description: "shell command", required: true, multiline: true }
    ],
    example: '<action name="run_bash">\n<command>ls -la</command>\n</action>',
    mode: "code",
    run: runBash
  },
  open_preview: {
    name: "open_preview",
    description: "Reveal the Canvas preview. Call after creating or updating index.html so the user sees the result.",
    params: [],
    example: '<action name="open_preview"></action>',
    mode: "code",
    run: openPreview
  }
};
function tz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}
function renderToolHelp(mode) {
  const wanted = (t) => t.mode === "both" || t.mode === mode;
  const lines = [];
  for (const t of Object.values(TOOLS)) {
    if (!wanted(t)) continue;
    lines.push(`### ${t.name}`);
    lines.push(t.description);
    if (t.params.length) {
      lines.push("Parameters:");
      for (const p of t.params) {
        const req = p.required ? " (required)" : "";
        const multi = p.multiline ? " \u2014 multi-line OK" : "";
        lines.push(`  <${p.name}>: ${p.description}${req}${multi}`);
      }
    } else {
      lines.push("No parameters.");
    }
    lines.push("Example:");
    lines.push(t.example);
    lines.push("");
  }
  return lines.join("\n");
}
function chatSystemPrompt(enableTools) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const day = (/* @__PURE__ */ new Date()).toLocaleDateString("en-US", { weekday: "long" });
  if (!enableTools) {
    return [
      "You are Gemma, an AI assistant running 100% locally on the user's Mac.",
      `Current date/time: ${now} (${day}). Timezone: ${tz()}.`,
      "Be clear, concise, and helpful. Use markdown for formatting when useful."
    ].join("\n");
  }
  return [
    "You are Gemma, an AI assistant running 100% locally on the user's Mac.",
    `Current date/time: ${now} (${day}). Timezone: ${tz()}.`,
    "",
    "TOOL USE",
    "========",
    "When a tool helps, emit ONE action block and STOP. You will receive the result, then you may continue or call another tool.",
    "",
    "Action format:",
    '<action name="tool_name">',
    "<param_name>value</param_name>",
    "</action>",
    "",
    "Rules:",
    "- One action per response, on its own line.",
    "- Never wrap actions in markdown code fences.",
    "- After writing </action>, STOP. Wait for the result before continuing.",
    "- When finished, write a short plain-text answer and emit no more actions.",
    "",
    "Tools:",
    "",
    renderToolHelp("chat")
  ].join("\n");
}
function codeSystemPrompt(workspacePath, previewHref) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const day = (/* @__PURE__ */ new Date()).toLocaleDateString("en-US", { weekday: "long" });
  return [
    "You are Gemma, a local coding agent running entirely on the user's Mac.",
    `Date: ${now} (${day}). Workspace: ${workspacePath}. Preview: ${previewHref}`,
    "",
    "GOAL: Build a small, polished, fully working web app or widget that matches the user request exactly.",
    "- Use modern, clean design (Tailwind via CDN is OK for single-file, or custom CSS). Dark friendly.",
    '- Real copy and interactions \u2014 no placeholders, no "Coming Soon", no lorem.',
    "- Everything must actually function: buttons click, state updates, no broken handlers.",
    "",
    "OUTPUT RULES (STRICT)",
    '1. In your FIRST response: one short sentence of intent, then IMMEDIATELY one <action name="write_file"> with the first file. Never output only a plan.',
    "2. One action per turn. After the tool result comes back, continue with the next file or open_preview.",
    "3. Final step: call open_preview, then a one-sentence summary. Stop.",
    "",
    "ACTION FORMAT (EXACT \u2014 no fences, no extra text outside tags)",
    '<action name="write_file">',
    "<path>index.html</path>",
    "<content>",
    "<!-- literal file bytes only, nothing else -->",
    "</content>",
    "</action>",
    "",
    "MINIMAL GOOD EXAMPLE (first turn only)",
    "I'll create a working click counter.",
    '<action name="write_file">',
    "<path>index.html</path>",
    "<content>",
    "<!doctype html>",
    '<html><head><meta charset="utf-8"><title>Counter</title><style>body{font:16px system-ui;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0} .card{background:#1a1a1a;padding:40px;border-radius:16px;text-align:center} button{margin-top:16px;padding:12px 28px;font-size:18px;border-radius:999px;border:0;background:#3b82f6;color:white;cursor:pointer}</style></head>',
    '<body><div class="card"><h1 id="n">0</h1><button onclick="inc()">+1</button></div><script>let c=0;function inc(){c++;document.getElementById("n").textContent=c}</script></body>',
    "</html>",
    "</content>",
    "</action>",
    "",
    "HARD RULES",
    '- NEVER emit "Coming Soon", "Under Construction", lorem ipsum, or demo placeholders.',
    "- Never put ``` or explanations inside <content>. Only raw file bytes.",
    "- Paths relative, no leading /. One action, then stop and wait.",
    "- For anything beyond a tiny widget, use 3 files: index.html + style.css + app.js.",
    "- Keep output tight and high-quality. The user sees the Canvas live.",
    "",
    "AVAILABLE TOOLS",
    "",
    renderToolHelp("code")
  ].join("\n");
}
function findNextAction(text, from = 0) {
  const openRe = /<action\s+name\s*=\s*["']?([a-zA-Z_][\w]*)["']?\s*>/gi;
  openRe.lastIndex = from;
  const open = openRe.exec(text);
  if (!open) return null;
  const name = open[1];
  const bodyStart = open.index + open[0].length;
  const closeMatch = text.slice(bodyStart).match(/<\/action\s*>/i);
  if (!closeMatch || closeMatch.index === void 0) return "incomplete";
  const closeIdx = bodyStart + closeMatch.index;
  const body = text.slice(bodyStart, closeIdx);
  const args = parseActionBody(body);
  return {
    name,
    args,
    raw: text.slice(open.index, closeIdx + closeMatch[0].length),
    start: open.index,
    end: closeIdx + closeMatch[0].length
  };
}
function parseActionBody(body) {
  const args = {};
  const contentOpen = body.indexOf("<content>");
  let outside = body;
  if (contentOpen >= 0) {
    const contentCloseRel = body.lastIndexOf("</content>");
    if (contentCloseRel > contentOpen) {
      let content = body.slice(contentOpen + "<content>".length, contentCloseRel);
      content = content.replace(/^\n/, "");
      content = content.replace(/\n[ \t]*$/, "");
      args.content = content;
      outside = body.slice(0, contentOpen) + body.slice(contentCloseRel + "</content>".length);
    }
  }
  const tagRe = /<([a-zA-Z_][\w-]*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = tagRe.exec(outside)) !== null) {
    const key = m[1];
    if (key === "content") continue;
    const raw = m[2];
    const trimmed = raw.trim();
    if (trimmed === "true") args[key] = true;
    else if (trimmed === "false") args[key] = false;
    else if (/^-?\d+$/.test(trimmed)) args[key] = Number(trimmed);
    else args[key] = raw.replace(/^\n/, "").replace(/\n[ \t]*$/, "");
  }
  return args;
}
export {
  TOOLS,
  chatSystemPrompt,
  cleanFileContent,
  codeSystemPrompt,
  findNextAction
};
