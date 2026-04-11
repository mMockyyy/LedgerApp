import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { env } from "../config/env";
import { Expense } from "../models/Expense";
import { FeatureFlag } from "../models/FeatureFlag";
import { Receipt } from "../models/Receipt";
import { User } from "../models/User";
import { ChatMessage } from "../models/ChatMessage";
import { asyncHandler } from "../utils/asyncHandler";

export const adminRouter = Router();

// ---------------------------------------------------------------------------
// Admin JWT helpers
// ---------------------------------------------------------------------------

const ADMIN_TOKEN_EXPIRY = "8h";

function signAdminToken() {
  return jwt.sign({ admin: true }, env.ADMIN_SECRET, { expiresIn: ADMIN_TOKEN_EXPIRY });
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Admin token required" });
  }
  try {
    const payload = jwt.verify(auth.slice(7), env.ADMIN_SECRET) as { admin?: boolean };
    if (!payload.admin) throw new Error();
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired admin token" });
  }
}

// ---------------------------------------------------------------------------
// POST /admin/login
// ---------------------------------------------------------------------------

adminRouter.post("/login", asyncHandler(async (req, res) => {
  const { password } = req.body as { password?: string };
  if (!password || password !== env.ADMIN_SECRET) {
    return res.status(401).json({ message: "Invalid admin password" });
  }
  return res.json({ token: signAdminToken() });
}));

// ---------------------------------------------------------------------------
// GET /admin/api/stats
// ---------------------------------------------------------------------------

adminRouter.get("/api/stats", requireAdmin, asyncHandler(async (_req, res) => {
  const [users, expenses, receipts, chatMessages] = await Promise.all([
    User.countDocuments(),
    Expense.countDocuments(),
    Receipt.countDocuments(),
    ChatMessage.countDocuments()
  ]);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [newUsers, newExpenses] = await Promise.all([
    User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    Expense.countDocuments({ createdAt: { $gte: thirtyDaysAgo } })
  ]);

  return res.json({ users, expenses, receipts, chatMessages, newUsers, newExpenses });
}));

// ---------------------------------------------------------------------------
// GET /admin/api/users
// ---------------------------------------------------------------------------

adminRouter.get("/api/users", requireAdmin, asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = 20;
  const skip = (page - 1) * limit;
  const search = req.query.search as string | undefined;

  const filter = search
    ? { email: { $regex: search, $options: "i" } }
    : {};

  const [users, total] = await Promise.all([
    User.find(filter, { passwordHash: 0, emailVerificationToken: 0 })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter)
  ]);

  return res.json({ users, total, page, pages: Math.ceil(total / limit) });
}));

// ---------------------------------------------------------------------------
// DELETE /admin/api/users/:id
// ---------------------------------------------------------------------------

adminRouter.delete("/api/users/:id", requireAdmin, asyncHandler(async (req, res) => {
  const uid = new mongoose.Types.ObjectId(req.params.id);
  await Promise.all([
    User.deleteOne({ _id: uid }),
    Expense.deleteMany({ userId: uid }),
    Receipt.deleteMany({ userId: uid }),
    ChatMessage.deleteMany({ userId: uid })
  ]);
  return res.json({ message: "User and all associated data deleted." });
}));

// ---------------------------------------------------------------------------
// GET /admin/api/flags
// ---------------------------------------------------------------------------

adminRouter.get("/api/flags", requireAdmin, asyncHandler(async (_req, res) => {
  const flags = await FeatureFlag.find().lean();
  return res.json({ flags });
}));

// ---------------------------------------------------------------------------
// PATCH /admin/api/flags/:key  — toggle enabled or update userIds
// ---------------------------------------------------------------------------

adminRouter.patch("/api/flags/:key", requireAdmin, asyncHandler(async (req, res) => {
  const { enabled, userIds } = req.body as { enabled?: boolean; userIds?: string[] };

  const update: Record<string, unknown> = {};
  if (typeof enabled === "boolean") update.enabled = enabled;
  if (Array.isArray(userIds)) update.userIds = userIds;

  const flag = await FeatureFlag.findOneAndUpdate(
    { key: req.params.key },
    { $set: update },
    { new: true, upsert: true }
  ).lean();

  return res.json({ flag });
}));

// ---------------------------------------------------------------------------
// GET /admin  — serve the HTML admin panel
// ---------------------------------------------------------------------------

adminRouter.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(ADMIN_HTML);
});

// ---------------------------------------------------------------------------
// Admin HTML (single-page, vanilla JS)
// ---------------------------------------------------------------------------

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>LedgerApp Admin</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f1f5f9;color:#1e293b;min-height:100vh}
  #login{display:flex;align-items:center;justify-content:center;min-height:100vh}
  .login-card{background:#fff;border-radius:12px;padding:40px;width:340px;box-shadow:0 4px 24px rgba(0,0,0,.1)}
  .login-card h1{font-size:22px;margin-bottom:6px}
  .login-card p{color:#64748b;font-size:14px;margin-bottom:24px}
  input{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:15px;margin-bottom:14px;outline:none}
  input:focus{border-color:#6366f1}
  button{width:100%;padding:11px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer;font-weight:600}
  button:hover{background:#4f46e5}
  button.danger{background:#ef4444}
  button.danger:hover{background:#dc2626}
  button.sm{width:auto;padding:5px 12px;font-size:13px;border-radius:6px}
  button.ghost{background:transparent;color:#6366f1;border:1px solid #6366f1}
  button.ghost:hover{background:#eef2ff}
  .error{color:#ef4444;font-size:13px;margin-top:8px}
  #app{display:none}
  header{background:#fff;border-bottom:1px solid #e2e8f0;padding:0 24px;display:flex;align-items:center;justify-content:space-between;height:56px}
  header h1{font-size:18px;font-weight:700;color:#6366f1}
  nav{display:flex;gap:4px}
  nav button{background:transparent;color:#64748b;border:none;padding:6px 14px;border-radius:6px;font-size:14px;cursor:pointer;width:auto;font-weight:500}
  nav button.active,nav button:hover{background:#eef2ff;color:#6366f1}
  .logout{background:transparent;color:#ef4444;border:1px solid #fecaca;padding:6px 14px;font-size:13px;border-radius:6px;cursor:pointer;width:auto}
  main{padding:24px;max-width:1100px;margin:0 auto}
  .tab{display:none}
  .tab.active{display:block}
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:28px}
  .stat-card{background:#fff;border-radius:10px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
  .stat-card .label{font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
  .stat-card .value{font-size:28px;font-weight:700;color:#1e293b}
  .stat-card .sub{font-size:12px;color:#64748b;margin-top:4px}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)}
  th{background:#f8fafc;text-align:left;padding:12px 16px;font-size:12px;text-transform:uppercase;color:#64748b;letter-spacing:.5px}
  td{padding:12px 16px;border-top:1px solid #f1f5f9;font-size:14px;vertical-align:middle}
  tr:hover td{background:#fafbff}
  .badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:12px;font-weight:600}
  .badge.green{background:#dcfce7;color:#16a34a}
  .badge.gray{background:#f1f5f9;color:#64748b}
  .badge.blue{background:#dbeafe;color:#2563eb}
  .badge.orange{background:#ffedd5;color:#ea580c}
  .toolbar{display:flex;gap:10px;margin-bottom:16px;align-items:center}
  .toolbar input{margin:0;width:260px}
  .section-title{font-size:18px;font-weight:700;margin-bottom:16px}
  .flag-row{background:#fff;border-radius:10px;padding:16px 20px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 1px 4px rgba(0,0,0,.06)}
  .flag-row .name{font-weight:600}
  .flag-row .meta{font-size:13px;color:#64748b;margin-top:2px}
  .toggle{position:relative;display:inline-block;width:44px;height:24px}
  .toggle input{opacity:0;width:0;height:0}
  .slider{position:absolute;cursor:pointer;inset:0;background:#cbd5e1;border-radius:24px;transition:.2s}
  .slider:before{content:"";position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.2s}
  input:checked+.slider{background:#6366f1}
  input:checked+.slider:before{transform:translateX(20px)}
  .pagination{display:flex;gap:8px;margin-top:16px;align-items:center;justify-content:flex-end;font-size:14px;color:#64748b}
  .pagination button{width:auto;padding:5px 12px;background:#fff;color:#6366f1;border:1px solid #e2e8f0;border-radius:6px;font-size:13px}
  .pagination button:disabled{opacity:.4;cursor:not-allowed}
  .empty{text-align:center;padding:48px;color:#94a3b8;font-size:15px}
</style>
</head>
<body>

<!-- Login -->
<div id="login">
  <div class="login-card">
    <h1>LedgerApp Admin</h1>
    <p>Sign in with your admin password</p>
    <input type="password" id="pwd" placeholder="Admin password" onkeydown="if(event.key==='Enter')doLogin()"/>
    <button onclick="doLogin()">Sign In</button>
    <div class="error" id="login-err"></div>
  </div>
</div>

<!-- App -->
<div id="app">
  <header>
    <h1>⬡ LedgerApp Admin</h1>
    <nav>
      <button class="active" onclick="showTab('dashboard',this)">Dashboard</button>
      <button onclick="showTab('users',this)">Users</button>
      <button onclick="showTab('flags',this)">Feature Flags</button>
    </nav>
    <button class="logout" onclick="logout()">Sign Out</button>
  </header>
  <main>
    <!-- Dashboard -->
    <div class="tab active" id="tab-dashboard">
      <div class="stats-grid" id="stats-grid">
        <div class="stat-card"><div class="label">Loading...</div></div>
      </div>
    </div>

    <!-- Users -->
    <div class="tab" id="tab-users">
      <div class="toolbar">
        <input type="text" id="user-search" placeholder="Search by email…" oninput="searchUsers()"/>
        <span id="user-count" style="color:#64748b;font-size:14px"></span>
      </div>
      <table>
        <thead><tr>
          <th>Email</th><th>Username</th><th>Provider</th>
          <th>Verified</th><th>Joined</th><th></th>
        </tr></thead>
        <tbody id="user-tbody"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody>
      </table>
      <div class="pagination">
        <button id="prev-page" onclick="changePage(-1)" disabled>← Prev</button>
        <span id="page-info">Page 1</span>
        <button id="next-page" onclick="changePage(1)">Next →</button>
      </div>
    </div>

    <!-- Feature Flags -->
    <div class="tab" id="tab-flags">
      <div class="section-title">Feature Flags</div>
      <div id="flags-list"><div class="empty">Loading…</div></div>
    </div>
  </main>
</div>

<script>
const BASE = window.location.origin;
let TOKEN = localStorage.getItem("admin_token") || "";
let currentPage = 1;
let searchTimeout;

// ── Auth ──────────────────────────────────────────────────────────────────
async function doLogin() {
  const pwd = document.getElementById("pwd").value;
  document.getElementById("login-err").textContent = "";
  try {
    const r = await fetch(BASE + "/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pwd })
    });
    const d = await r.json();
    if (!r.ok) { document.getElementById("login-err").textContent = d.message; return; }
    TOKEN = d.token;
    localStorage.setItem("admin_token", TOKEN);
    showApp();
  } catch { document.getElementById("login-err").textContent = "Connection error."; }
}

function logout() {
  localStorage.removeItem("admin_token");
  TOKEN = "";
  document.getElementById("app").style.display = "none";
  document.getElementById("login").style.display = "flex";
}

async function api(path, opts = {}) {
  const r = await fetch(BASE + "/admin" + path, {
    ...opts,
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json", ...(opts.headers || {}) }
  });
  if (r.status === 401) { logout(); return null; }
  return r.json();
}

// ── App init ──────────────────────────────────────────────────────────────
function showApp() {
  document.getElementById("login").style.display = "none";
  document.getElementById("app").style.display = "block";
  loadDashboard();
  loadUsers();
  loadFlags();
}

function showTab(name, btn) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll("nav button").forEach(b => b.classList.remove("active"));
  document.getElementById("tab-" + name).classList.add("active");
  btn.classList.add("active");
}

// ── Dashboard ─────────────────────────────────────────────────────────────
async function loadDashboard() {
  const d = await api("/api/stats");
  if (!d) return;
  document.getElementById("stats-grid").innerHTML = [
    stat("Total Users", d.users, "+" + d.newUsers + " last 30 days"),
    stat("Total Expenses", d.expenses, "+" + d.newExpenses + " last 30 days"),
    stat("Receipts", d.receipts, "OCR processed"),
    stat("Chat Messages", d.chatMessages, "across all users")
  ].join("");
}

function stat(label, value, sub) {
  return \`<div class="stat-card"><div class="label">\${label}</div><div class="value">\${value}</div><div class="sub">\${sub}</div></div>\`;
}

// ── Users ─────────────────────────────────────────────────────────────────
async function loadUsers(page = 1) {
  currentPage = page;
  const search = document.getElementById("user-search")?.value || "";
  const d = await api(\`/api/users?page=\${page}&search=\${encodeURIComponent(search)}\`);
  if (!d) return;

  document.getElementById("user-count").textContent = \`\${d.total} user\${d.total !== 1 ? "s" : ""}\`;

  const rows = d.users.map(u => \`
    <tr>
      <td>\${u.email}</td>
      <td>\${u.username || '<span style="color:#94a3b8">—</span>'}</td>
      <td><span class="badge \${u.provider === "google" ? "blue" : "gray"}">\${u.provider}</span></td>
      <td><span class="badge \${u.isEmailVerified ? "green" : "orange"}">\${u.isEmailVerified ? "Verified" : "Unverified"}</span></td>
      <td>\${new Date(u.createdAt).toLocaleDateString()}</td>
      <td><button class="sm danger" onclick="deleteUser('\${u._id}', '\${u.email}')">Delete</button></td>
    </tr>
  \`).join("");

  document.getElementById("user-tbody").innerHTML = rows || \`<tr><td colspan="6" class="empty">No users found</td></tr>\`;
  document.getElementById("page-info").textContent = \`Page \${d.page} of \${d.pages || 1}\`;
  document.getElementById("prev-page").disabled = d.page <= 1;
  document.getElementById("next-page").disabled = d.page >= d.pages;
}

function searchUsers() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => loadUsers(1), 350);
}

function changePage(dir) {
  loadUsers(currentPage + dir);
}

async function deleteUser(id, email) {
  if (!confirm(\`Delete user "\${email}" and ALL their data? This cannot be undone.\`)) return;
  const d = await api(\`/api/users/\${id}\`, { method: "DELETE" });
  if (d) { loadUsers(currentPage); loadDashboard(); }
}

// ── Feature Flags ─────────────────────────────────────────────────────────
async function loadFlags() {
  const d = await api("/api/flags");
  if (!d) return;
  if (!d.flags.length) {
    document.getElementById("flags-list").innerHTML = \`<div class="empty">No feature flags found. They are created automatically when first accessed.</div>\`;
    return;
  }
  document.getElementById("flags-list").innerHTML = d.flags.map(f => \`
    <div class="flag-row">
      <div>
        <div class="name">\${f.key}</div>
        <div class="meta">\${f.userIds?.length || 0} specific user\${f.userIds?.length !== 1 ? "s" : ""} allowed</div>
      </div>
      <label class="toggle">
        <input type="checkbox" \${f.enabled ? "checked" : ""} onchange="toggleFlag('\${f.key}', this.checked)"/>
        <span class="slider"></span>
      </label>
    </div>
  \`).join("");
}

async function toggleFlag(key, enabled) {
  await api(\`/api/flags/\${key}\`, { method: "PATCH", body: JSON.stringify({ enabled }) });
  loadFlags();
}

// ── Boot ──────────────────────────────────────────────────────────────────
if (TOKEN) {
  // Verify existing token is still valid
  api("/api/stats").then(d => {
    if (d) showApp();
    else { TOKEN = ""; localStorage.removeItem("admin_token"); }
  });
}
</script>
</body>
</html>`;
