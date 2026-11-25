import { createServer } from "node:http";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scrypt = promisify(scryptCallback);
const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
try { process.loadEnvFile?.(resolve(projectRoot, ".env")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const dataDirectory = resolve(process.env.REPAIRLY_DATA_DIR || resolve(projectRoot, "data"));
const databasePath = resolve(dataDirectory, "repairly.json");
const production = process.env.NODE_ENV === "production";
const host = process.env.HOST || (production ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT || 3000);
const ownerAccountId = process.env.REPAIRLY_OWNER_ID || "dda5c420-c3cb-4456-a2f9-a001c6015107";
const onlineWindow = 60 * 1000;
const sessionDuration = 1000 * 60 * 60 * 24 * 14;
const passwordKeyLength = 64;
const repairCategories = new Set(["maintenance", "engine", "brakes", "electrics", "chassis", "interior", "body", "other"]);
const repairDifficulties = new Set(["easy", "medium", "advanced"]);
const publicFiles = new Set(["index.html", "maintenance.html", "styles.css", "script.js", "promo.js", "profile.js", "repairly-logo.svg", "repairly-logo.png", "repairly-logo.gif"]);
const discordBotToken = process.env.DISCORD_BOT_TOKEN || "";
const discordSupportChannelId = process.env.DISCORD_SUPPORT_CHANNEL_ID || "";
const discordEnabled = Boolean(discordBotToken && discordSupportChannelId);
const resendApiKey = process.env.RESEND_API_KEY || "";
const verificationFromEmail = process.env.REPAIRLY_FROM_EMAIL || "";
const oauthProviders = {
  google: { clientId: process.env.GOOGLE_CLIENT_ID || "", clientSecret: process.env.GOOGLE_CLIENT_SECRET || "" },
  github: { clientId: process.env.GITHUB_CLIENT_ID || "", clientSecret: process.env.GITHUB_CLIENT_SECRET || "" },
  discord: { clientId: process.env.DISCORD_CLIENT_ID || "", clientSecret: process.env.DISCORD_CLIENT_SECRET || "" }
};
const loginAttempts = new Map();
const pendingOAuthStates = new Map();
let database;
let saveQueue = Promise.resolve();
let discordSocket = null;
let discordHeartbeat = null;
let discordReconnect = null;
let discordSequence = null;
let discordBotId = "";
let discordReconnectDelay = 5000;

const sampleRepairs = [
  {
    id: "sample-filter-golf",
    authorId: "repairly-community",
    authorName: "Repairly Community",
    title: "Innenraumfilter wechseln",
    vehicle: "Volkswagen Golf VII · Beispielanleitung",
    category: "maintenance",
    difficulty: "easy",
    summary: "Ein gemeinschaftlicher Startbeitrag zum Wechsel des Innenraumfilters. Die Lage und der Zugang können je nach Ausführung abweichen.",
    steps: [
      "Fahrzeugspezifische Herstellerangaben zum Innenraumfilter prüfen.",
      "Handschuhfach nach Vorgabe des Fahrzeughandbuchs öffnen oder ausbauen.",
      "Filterabdeckung öffnen und Einbaurichtung des alten Filters beachten.",
      "Filtereinsatz wechseln, Abdeckung schließen und Funktion prüfen."
    ],
    parts: [],
    confirmationsBy: [],
    createdAt: new Date().toISOString(),
    isSample: true
  },
  {
    id: "sample-wipers",
    authorId: "repairly-community",
    authorName: "Repairly Community",
    title: "Scheibenwischerblätter erneuern",
    vehicle: "Passende Fahrzeugausführung bitte prüfen · Beispielanleitung",
    category: "maintenance",
    difficulty: "easy",
    summary: "Ein kurzer Startbeitrag für den Tausch der Wischerblätter. Adapter und Länge müssen zum konkreten Fahrzeug passen.",
    steps: [
      "Länge und Befestigungsart mit Fahrzeughandbuch oder Teilekatalog abgleichen.",
      "Wischerarm vorsichtig anheben und gegen Zurückschnellen sichern.",
      "Altes Blatt nach Anleitung der Befestigung lösen und neues Blatt einrasten lassen.",
      "Wischerarm behutsam ablegen und die Wischfunktion mit ausreichend Wasser testen."
    ],
    parts: [],
    confirmationsBy: [],
    createdAt: new Date().toISOString(),
    isSample: true
  }
];

function passwordHash(password, salt) {
  return scrypt(password, salt, passwordKeyLength, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).then((key) => key.toString("hex"));
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function notifyUser(userId, notification) {
  if (!userId) return null;
  const item = {
    id: randomUUID(), userId, type: notification.type,
    actorName: notification.actorName || "Repairly",
    repairId: notification.repairId || null, reportId: notification.reportId || null,
    title: notification.title || "", createdAt: new Date().toISOString(), readAt: null
  };
  database.notifications.push(item);
  if (database.notifications.length > 10_000) database.notifications.splice(0, database.notifications.length - 10_000);
  return item;
}

function normalizeImageData(value, maxBytes, label, optional = true) {
  if (value == null || value === "") {
    if (optional) return null;
    throw Object.assign(new Error(`${label} fehlt.`), { status: 400, code: "invalid_input" });
  }
  if (typeof value !== "string" || value.length > Math.ceil(maxBytes * 1.42)) {
    throw Object.assign(new Error(`${label} ist zu groß.`), { status: 413, code: "invalid_input" });
  }
  const match = value.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw Object.assign(new Error(`${label} muss ein JPG-, PNG- oder WebP-Bild sein.`), { status: 400, code: "invalid_input" });
  const imageBytes = Buffer.from(match[1], "base64");
  if (!imageBytes.length || imageBytes.length > maxBytes) throw Object.assign(new Error(`${label} ist zu groß.`), { status: 413, code: "invalid_input" });
  return value;
}

async function saveDatabase() {
  const snapshot = JSON.stringify(database, null, 2);
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    const temporaryPath = databasePath + ".tmp";
    await writeFile(temporaryPath, snapshot, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, databasePath);
  });
  return saveQueue;
}

async function loadDatabase() {
  await mkdir(dataDirectory, { recursive: true });
  try {
    database = JSON.parse(await readFile(databasePath, "utf8"));
    database.users ||= [];
    database.sessions ||= [];
    database.emailVerifications ||= [];
    database.repairs ||= [];
    database.reports ||= [];
    database.notifications ||= [];
    database.maintenance ||= { enabled: false, message: "" };
    let migrated = false;
    for (const user of database.users) {
      if (typeof user.emailVerified !== "boolean") { user.emailVerified = true; migrated = true; }
      if (!user.authProviders || typeof user.authProviders !== "object") { user.authProviders = {}; migrated = true; }
      if (!Array.isArray(user.vehicles)) { user.vehicles = []; migrated = true; }
      if (typeof user.bio !== "string") { user.bio = ""; migrated = true; }
      if (!Object.hasOwn(user, "avatarData")) { user.avatarData = null; migrated = true; }
      if (!Object.hasOwn(user, "bannerData")) { user.bannerData = null; migrated = true; }
      if (user.id === ownerAccountId) {
        if (user.role !== "admin") { user.role = "admin"; migrated = true; }
        if (user.isOwner !== true) { user.isOwner = true; migrated = true; }
      } else if (!user.role) { user.role = "user"; migrated = true; }
    }
    for (const repair of database.repairs) {
      if (!repair.category) { repair.category = repair.isSample ? "maintenance" : "other"; migrated = true; }
      if (!repair.difficulty) { repair.difficulty = repair.isSample ? "easy" : "medium"; migrated = true; }
      if (!Array.isArray(repair.confirmationsBy)) { repair.confirmationsBy = []; migrated = true; }
      if (!Array.isArray(repair.comments)) { repair.comments = []; migrated = true; }
      if (!Array.isArray(repair.likesBy)) { repair.likesBy = []; migrated = true; }
      if (!Array.isArray(repair.stepImages)) { repair.stepImages = []; migrated = true; }
      if (typeof repair.adminVerified !== "boolean") { repair.adminVerified = false; migrated = true; }
    }
    for (const report of database.reports) {
      if (!Object.hasOwn(report, "resolutionSeenAt")) { report.resolutionSeenAt = null; migrated = true; }
      if (!Array.isArray(report.messages)) { report.messages = []; migrated = true; }
      if (!Object.hasOwn(report, "replyNotificationAt")) { report.replyNotificationAt = null; migrated = true; }
      if (!Object.hasOwn(report, "replyNotificationSeenAt")) { report.replyNotificationSeenAt = null; migrated = true; }
    }
    if (migrated) await saveDatabase();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    database = { users: [], sessions: [], emailVerifications: [], repairs: sampleRepairs, reports: [], notifications: [], maintenance: { enabled: false, message: "" } };
    await saveDatabase();
  }
}

function json(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    ...headers
  });
  response.end(body);
}

function apiError(response, status, code, message) {
  json(response, status, { code, error: message });
}

function readCookie(request, name) {
  const cookies = (request.headers.cookie || "").split(";");
  const prefix = name + "=";
  for (const cookie of cookies) {
    const value = cookie.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return "";
}

function getCurrentUser(request) {
  const token = readCookie(request, "repairly_session");
  if (!token) return null;
  const session = database.sessions.find((item) => item.tokenHash === hashToken(token) && item.expiresAt > Date.now());
  if (!session) return null;
  return database.users.find((user) => user.id === session.userId) || null;
}

function getCurrentSession(request) {
  const token = readCookie(request, "repairly_session");
  if (!token) return null;
  return database.sessions.find((item) => item.tokenHash === hashToken(token) && item.expiresAt > Date.now()) || null;
}

function isAdmin(user) {
  return Boolean(user && user.role === "admin");
}

function publicUser(user) {
  return {
    id: user.id, name: user.name, email: user.email, role: user.role || "user", isOwner: Boolean(user.isOwner),
    emailVerified: Boolean(user.emailVerified), vehicles: user.vehicles || [], bio: user.bio || "", avatarData: user.avatarData || null, bannerData: user.bannerData || null
  };
}

function repairView(repair, user) {
  const { confirmationsBy = [], comments = [], likesBy = [], ...fields } = repair;
  return {
    ...fields,
    authorName: database.users.find((account) => account.id === repair.authorId)?.name || repair.authorName,
    comments: comments.map(({ id, authorId, authorName, text, createdAt }) => ({ id, authorId, authorName, text, createdAt })),
    confirmations: confirmationsBy.length,
    likes: likesBy.length,
    likedByMe: Boolean(user && likesBy.includes(user.id)),
    adminVerified: Boolean(repair.adminVerified),
    confirmedByMe: Boolean(user && confirmationsBy.includes(user.id)),
    isOwn: Boolean(user && repair.authorId === user.id)
  };
}

function sessionCookie(token) {
  return `repairly_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionDuration / 1000}${production ? "; Secure" : ""}`;
}

async function createSession(user) {
  const token = randomBytes(32).toString("base64url");
  database.sessions = database.sessions.filter((item) => item.expiresAt > Date.now() && item.userId !== user.id);
  database.sessions.push({ tokenHash: hashToken(token), userId: user.id, expiresAt: Date.now() + sessionDuration, lastSeenAt: Date.now() });
  await saveDatabase();
  return token;
}

async function requestBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 3_000_000) throw Object.assign(new Error("Request body is too large."), { status: 413, code: "invalid_input" });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error("Request body must be valid JSON."), { status: 400, code: "invalid_input" }); }
}

function normalizeText(value, max, label) {
  if (typeof value !== "string") throw Object.assign(new Error(`${label} fehlt.`), { status: 400, code: "invalid_input" });
  const result = value.trim();
  if (!result || result.length > max) throw Object.assign(new Error(`${label} muss zwischen 1 und ${max} Zeichen lang sein.`), { status: 400, code: "invalid_input" });
  return result;
}

async function discordRequest(path, method = "GET", payload = undefined) {
  if (!discordEnabled) throw new Error("Discord ist nicht konfiguriert.");
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${discordBotToken}`, "Content-Type": "application/json", "User-Agent": "Repairly Support Bot (https://repairly.local, 1.0)" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(12_000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Discord API ${response.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

async function sendDiscordTicket(report) {
  if (!discordEnabled) { report.discordSyncState = "disabled"; return; }
  try {
    const thread = await discordRequest(`/channels/${encodeURIComponent(discordSupportChannelId)}/threads`, "POST", {
      name: `ticket-${report.id.slice(0, 8)}`,
      type: 12,
      invitable: false,
      auto_archive_duration: 10080
    });
    report.discordThreadId = thread.id;
    report.discordGuildId = thread.guild_id || "";
    report.discordSyncState = "sent";
    const content = [
      `🎫 Repairly Supportticket ${report.id}`,
      `**Status:** ${report.status}`,
      `**Von:** ${report.userName || "Gast"}`,
      `**Kategorie:** ${report.category}`,
      `**Betreff:** ${report.title}`,
      "",
      report.description,
      "",
      "Antworten in diesem privaten Thread werden in das Repairly-Ticket übernommen."
    ].join("\n").slice(0, 1950);
    await discordRequest(`/channels/${encodeURIComponent(thread.id)}/messages`, "POST", { content, allowed_mentions: { parse: [] } });
  } catch (error) {
    report.discordSyncState = "failed";
    report.discordSyncError = String(error.message || error).slice(0, 220);
    console.error("Discord ticket sync failed:", error.message || error);
  }
  await saveDatabase();
}

async function sendDiscordTicketMessage(report, message, authorName) {
  if (!discordEnabled || !report.discordThreadId) return;
  const content = `**${String(authorName || "Repairly Team").slice(0, 60)}:**\n${String(message).slice(0, 1850)}`;
  await discordRequest(`/channels/${encodeURIComponent(report.discordThreadId)}/messages`, "POST", { content, allowed_mentions: { parse: [] } });
}

async function syncDiscordTicketStatus(report, status) {
  if (!discordEnabled || !report.discordThreadId) return;
  const closed = status === "resolved";
  if (!closed) await discordRequest(`/channels/${encodeURIComponent(report.discordThreadId)}`, "PATCH", { archived: false, locked: false });
  await discordRequest(`/channels/${encodeURIComponent(report.discordThreadId)}/messages`, "POST", {
    content: closed ? "🔒 Dieses Repairly-Ticket wurde geschlossen." : "🔓 Dieses Repairly-Ticket wurde wieder geöffnet.",
    allowed_mentions: { parse: [] }
  });
  if (closed) await discordRequest(`/channels/${encodeURIComponent(report.discordThreadId)}`, "PATCH", { archived: true, locked: true });
}

async function onDiscordMessage(message) {
  if (!message?.guild_id || !message?.channel_id || !message?.author || message.author.bot || !discordBotId || message.author.id === discordBotId) return;
  const report = database.reports.find((ticket) => ticket.discordThreadId === message.channel_id);
  if (!report) return;
  const text = typeof message.content === "string" ? message.content.trim().slice(0, 2000) : "";
  if (!text) return;
  report.messages ||= [];
  if (report.messages.some((entry) => entry.discordMessageId === message.id)) return;
  const memberName = message.member?.nick || message.author.global_name || message.author.username || "Repairly Team";
  report.messages.push({ id: randomUUID(), discordMessageId: message.id, authorId: null, authorName: memberName, authorRole: "team", text, createdAt: new Date().toISOString() });
  report.status = "open";
  report.resolvedAt = null;
  report.resolutionSeenAt = null;
  if (report.userId) notifyUser(report.userId, { type: "support_reply", actorName: memberName, reportId: report.id, title: report.title });
  report.replyNotificationAt = new Date().toISOString();
  report.replyNotificationSeenAt = null;
  await saveDatabase();
}

function connectDiscordGateway() {
  if (!discordEnabled || typeof WebSocket !== "function" || discordReconnect) return;
  try {
    const socket = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");
    discordSocket = socket;
    let heartbeatInterval = null;
    const sendHeartbeat = () => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 1, d: discordSequence })); };
    socket.addEventListener("message", (event) => {
      let packet;
      try { packet = JSON.parse(String(event.data)); } catch { return; }
      if (packet.s != null) discordSequence = packet.s;
      if (packet.op === 10) {
        heartbeatInterval = Number(packet.d?.heartbeat_interval) || 45_000;
        discordHeartbeat = setInterval(sendHeartbeat, heartbeatInterval);
        discordHeartbeat.unref?.();
        setTimeout(sendHeartbeat, Math.random() * heartbeatInterval);
        socket.send(JSON.stringify({ op: 2, d: { token: discordBotToken, intents: 33281, properties: { os: process.platform, browser: "repairly", device: "repairly" } } }));
      } else if (packet.op === 1) sendHeartbeat();
      else if (packet.op === 7 || packet.op === 9) socket.close();
      else if (packet.op === 0 && packet.t === "READY") {
        discordBotId = packet.d?.user?.id || "";
        discordReconnectDelay = 5000;
        console.log("Discord support bot connected.");
      } else if (packet.op === 0 && packet.t === "MESSAGE_CREATE") {
        void onDiscordMessage(packet.d).catch((error) => console.error("Discord message sync failed:", error.message || error));
      }
    });
    socket.addEventListener("close", () => {
      if (discordHeartbeat) clearInterval(discordHeartbeat);
      discordHeartbeat = null;
      discordSocket = null;
      if (!discordEnabled) return;
      discordReconnect = setTimeout(() => { discordReconnect = null; connectDiscordGateway(); }, discordReconnectDelay);
      discordReconnect.unref?.();
      discordReconnectDelay = Math.min(discordReconnectDelay * 2, 60_000);
    });
    socket.addEventListener("error", () => console.error("Discord gateway connection error."));
  } catch (error) {
    console.error("Discord gateway could not start:", error.message || error);
  }
}

function checkOrigin(request, response) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const requestOrigin = `http://${request.headers.host}`;
  const forwarded = request.headers["x-forwarded-proto"];
  const effectiveOrigin = forwarded ? `${forwarded}://${request.headers.host}` : requestOrigin;
  if (origin === effectiveOrigin) return true;
  apiError(response, 403, "origin_rejected", "Diese Anfrage konnte nicht überprüft werden.");
  return false;
}

function rateLimitKey(request, email) {
  return `${request.socket.remoteAddress || "unknown"}:${email}`;
}

function tooManyAttempts(request, email) {
  const key = rateLimitKey(request, email);
  const current = loginAttempts.get(key);
  if (!current || current.until <= Date.now()) {
    loginAttempts.set(key, { count: 1, until: Date.now() + 15 * 60 * 1000 });
    return false;
  }
  current.count += 1;
  return current.count > 7;
}

function requestBaseUrl(request) {
  if (process.env.REPAIRLY_PUBLIC_URL) return new URL(process.env.REPAIRLY_PUBLIC_URL).origin;
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(request.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const protocol = forwardedProto || (production ? "https" : "http");
  const requestHost = forwardedHost || request.headers.host || "127.0.0.1:3000";
  return new URL(`${protocol}://${requestHost}`).origin;
}

function oauthRedirectUri(request, provider) {
  return new URL(`/api/auth/oauth/${provider}/callback`, requestBaseUrl(request)).href;
}

function expireOAuthStateCookie() {
  return `repairly_oauth_state=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${production ? "; Secure" : ""}`;
}

function redirect(response, location, headers = {}) {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store", ...headers });
  response.end();
}

function verificationLink(request, token) {
  const link = new URL("/api/auth/verify-email", requestBaseUrl(request));
  link.searchParams.set("token", token);
  return link.href;
}

async function createEmailVerification(user, request) {
  const token = randomBytes(32).toString("base64url");
  database.emailVerifications = database.emailVerifications.filter((item) => item.userId !== user.id);
  database.emailVerifications.push({ userId: user.id, tokenHash: hashToken(token), expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  await saveDatabase();
  const link = verificationLink(request, token);
  if (!resendApiKey || !verificationFromEmail) {
    if (production) throw Object.assign(new Error("Die E-Mail-Bestätigung ist noch nicht eingerichtet."), { status: 503, code: "email_service_unavailable" });
    console.info(`Repairly email verification link for ${user.email}: ${link}`);
    return;
  }
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: verificationFromEmail,
      to: [user.email],
      subject: "Bestätige deine Repairly-E-Mail-Adresse",
      html: `<p>Hallo ${user.name.replace(/[&<>"']/g, "").slice(0, 40)},</p><p>bestätige deine E-Mail-Adresse, um dein Repairly-Konto zu aktivieren.</p><p><a href="${link}">E-Mail-Adresse bestätigen</a></p><p>Der Link ist 24 Stunden gültig.</p>`
    }),
    signal: AbortSignal.timeout(12_000)
  });
  if (!result.ok) {
    const detail = (await result.text()).slice(0, 250);
    console.error(`Verification email delivery failed (${result.status}): ${detail}`);
    throw Object.assign(new Error("Die Bestätigungs-E-Mail konnte gerade nicht gesendet werden. Bitte versuche es erneut."), { status: 502, code: "email_delivery_failed" });
  }
}

async function oauthFetchJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OAuth-Anfrage fehlgeschlagen (${response.status}).`);
  return payload;
}

async function oauthProfile(provider, code, request) {
  const config = oauthProviders[provider];
  const redirectUri = oauthRedirectUri(request, provider);
  let accessToken;
  if (provider === "google") {
    const token = await oauthFetchJson("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" })
    });
    accessToken = token.access_token;
    if (!accessToken) throw new Error("Google hat kein Zugriffstoken zurückgegeben.");
    const profile = await oauthFetchJson("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
    return { id: String(profile.sub || ""), email: profile.email, emailVerified: profile.email_verified === true, name: profile.name || profile.given_name || "" };
  }
  if (provider === "github") {
    const token = await oauthFetchJson("https://github.com/login/oauth/access_token", {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri })
    });
    accessToken = token.access_token;
    if (!accessToken) throw new Error("GitHub hat kein Zugriffstoken zurückgegeben.");
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "Repairly" };
    const [profile, emails] = await Promise.all([
      oauthFetchJson("https://api.github.com/user", { headers }),
      oauthFetchJson("https://api.github.com/user/emails", { headers })
    ]);
    const email = Array.isArray(emails) ? emails.find((item) => item.primary && item.verified) || emails.find((item) => item.verified) : null;
    return { id: String(profile.id || ""), email: email?.email || profile.email, emailVerified: Boolean(email?.verified), name: profile.name || profile.login || "" };
  }
  const token = await oauthFetchJson("https://discord.com/api/oauth2/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" })
  });
  accessToken = token.access_token;
  if (!accessToken) throw new Error("Discord hat kein Zugriffstoken zurückgegeben.");
  const profile = await oauthFetchJson("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${accessToken}` } });
  return { id: String(profile.id || ""), email: profile.email, emailVerified: profile.verified === true, name: profile.global_name || profile.username || "" };
}

async function findOrCreateOAuthUser(provider, profile) {
  const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : "";
  const providerId = String(profile.id || "");
  if (!providerId || !profile.emailVerified || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("Der Anbieter hat keine bestätigte E-Mail-Adresse geliefert."), { status: 400, code: "verified_email_required" });
  }
  let account = database.users.find((item) => item.authProviders?.[provider] === providerId) || database.users.find((item) => item.email === email);
  if (!account) {
    const fallbackName = email.split("@")[0];
    const name = String(profile.name || fallbackName).trim().replace(/[\r\n\t]/g, " ").slice(0, 40) || fallbackName.slice(0, 40);
    account = { id: randomUUID(), name, email, emailVerified: true, authProviders: {}, role: "user", vehicles: [], createdAt: new Date().toISOString() };
    database.users.push(account);
  }
  account.authProviders ||= {};
  account.authProviders[provider] = providerId;
  account.emailVerified = true;
  await saveDatabase();
  return account;
}

async function handleApi(request, response, url) {
  const user = getCurrentUser(request);
  if (request.method === "GET" && url.pathname === "/api/status") {
    return json(response, 200, { maintenance: database.maintenance, isAdmin: isAdmin(user) });
  }
  if (request.method === "GET" && url.pathname === "/api/auth/providers") {
    return json(response, 200, { providers: Object.entries(oauthProviders).filter(([, config]) => config.clientId && config.clientSecret).map(([name]) => name) });
  }
  const oauthRoute = url.pathname.match(/^\/api\/auth\/oauth\/(google|github|discord)(\/callback)?$/);
  if (request.method === "GET" && oauthRoute) {
    const provider = oauthRoute[1];
    const isCallback = Boolean(oauthRoute[2]);
    const config = oauthProviders[provider];
    if (!config.clientId || !config.clientSecret) return redirect(response, "/?oauth=unavailable");
    if (!isCallback) {
      for (const [key, value] of pendingOAuthStates) if (value.expiresAt <= Date.now()) pendingOAuthStates.delete(key);
      const state = randomBytes(32).toString("base64url");
      pendingOAuthStates.set(state, { provider, expiresAt: Date.now() + 10 * 60 * 1000 });
      const authorizeUrl = provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : provider === "github" ? "https://github.com/login/oauth/authorize" : "https://discord.com/oauth2/authorize";
      const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: oauthRedirectUri(request, provider), response_type: "code", state });
      params.set("scope", provider === "google" ? "openid email profile" : provider === "github" ? "read:user user:email" : "identify email");
      if (provider === "google") params.set("prompt", "select_account");
      if (provider === "discord") params.set("prompt", "consent");
      const stateCookie = `repairly_oauth_state=${encodeURIComponent(state)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600${production ? "; Secure" : ""}`;
      return redirect(response, `${authorizeUrl}?${params}`, { "Set-Cookie": stateCookie });
    }
    const state = url.searchParams.get("state") || "";
    const cookieState = readCookie(request, "repairly_oauth_state");
    const pending = pendingOAuthStates.get(state);
    if (!state || state !== cookieState || !pending || pending.provider !== provider || pending.expiresAt <= Date.now()) {
      if (state) pendingOAuthStates.delete(state);
      return redirect(response, "/?oauth=failed", { "Set-Cookie": expireOAuthStateCookie() });
    }
    pendingOAuthStates.delete(state);
    if (url.searchParams.has("error") || !url.searchParams.get("code")) {
      return redirect(response, "/?oauth=cancelled", { "Set-Cookie": expireOAuthStateCookie() });
    }
    try {
      const profile = await oauthProfile(provider, url.searchParams.get("code"), request);
      const account = await findOrCreateOAuthUser(provider, profile);
      const sessionToken = await createSession(account);
      return redirect(response, "/?oauth=success", { "Set-Cookie": [sessionCookie(sessionToken), expireOAuthStateCookie()] });
    } catch (error) {
      console.error(`${provider} sign-in failed:`, error.message || error);
      const failure = error.code === "verified_email_required" ? "unverified-email" : "failed";
      return redirect(response, `/?oauth=${failure}`, { "Set-Cookie": expireOAuthStateCookie() });
    }
  }
  if (request.method === "GET" && url.pathname === "/api/auth/verify-email") {
    const token = url.searchParams.get("token") || "";
    const record = database.emailVerifications.find((item) => item.tokenHash === hashToken(token) && item.expiresAt > Date.now());
    const account = record && database.users.find((item) => item.id === record.userId);
    if (!account) return redirect(response, "/?email-verification=expired");
    account.emailVerified = true;
    database.emailVerifications = database.emailVerifications.filter((item) => item !== record);
    const sessionToken = await createSession(account);
    return redirect(response, "/?email-verified=1", { "Set-Cookie": sessionCookie(sessionToken) });
  }
  if (database.maintenance.enabled && !isAdmin(user)) {
    return apiError(response, 503, "maintenance", database.maintenance.message || "Repairly ist gerade kurz in Wartung. Bitte schau später wieder vorbei.");
  }
  if (request.method === "GET" && url.pathname === "/api/session") {
    return json(response, 200, { user: user ? publicUser(user) : null });
  }
  if (request.method === "GET" && url.pathname === "/api/notifications") {
    if (!user) return apiError(response, 401, "authentication_required", "Bitte melde dich an.");
    const notifications = database.notifications
      .filter((item) => item.userId === user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100);
    return json(response, 200, { notifications, unreadCount: notifications.filter((item) => !item.readAt).length });
  }
  if (request.method === "GET" && url.pathname === "/api/repairs") {
    const list = database.repairs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((repair) => repairView(repair, user));
    return json(response, 200, { repairs: list });
  }
  const publicProfile = url.pathname.match(/^\/api\/users\/([a-z\d-]+)$/i);
  if (request.method === "GET" && publicProfile) {
    const account = database.users.find((item) => item.id === publicProfile[1]);
    if (!account) return apiError(response, 404, "not_found", "Dieses Profil wurde nicht gefunden.");
    const profile = { id: account.id, name: account.name, role: account.role || "user", bio: account.bio || "", avatarData: account.avatarData || null, bannerData: account.bannerData || null, createdAt: account.createdAt || null };
    const userRepairs = database.repairs.filter((repair) => repair.authorId === account.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((repair) => repairView(repair, user));
    return json(response, 200, { profile, repairs: userRepairs });
  }
  if (request.method === "GET" && url.pathname === "/api/support/mine") {
    if (!user) return apiError(response, 401, "authentication_required", "Bitte melde dich an.");
    const reports = database.reports.filter((report) => report.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ notifyTokenHash, ...report }) => report);
    return json(response, 200, { reports });
  }
  if (request.method === "GET" && url.pathname === "/api/admin/overview") {
    if (!isAdmin(user)) return apiError(response, 403, "admin_required", "Nur das Repairly-Team kann diese Ansicht öffnen.");
    const onlineCutoff = Date.now() - onlineWindow;
    const onlineIds = new Set(database.sessions.filter((session) => session.expiresAt > Date.now() && session.lastSeenAt > onlineCutoff).map((session) => session.userId));
    const users = database.users.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).map((account) => ({
      id: account.id, name: account.name, email: account.email, role: account.role || "user", isOwner: Boolean(account.isOwner),
      online: onlineIds.has(account.id), vehicleCount: (account.vehicles || []).length, createdAt: account.createdAt || null
    }));
    const reports = database.reports.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ notifyTokenHash, ...report }) => report);
    return json(response, 200, {
      maintenance: database.maintenance,
      discord: { configured: discordEnabled, connected: Boolean(discordBotId), supportChannelId: discordEnabled ? discordSupportChannelId : null },
      users,
      onlineCount: onlineIds.size,
      openReportCount: reports.filter((report) => report.status === "open").length,
      reports,
      repairs: database.repairs.filter((repair) => !repair.isSample).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((repair) => repairView(repair, user))
    });
  }
  if (request.method === "DELETE") {
    if (!checkOrigin(request, response)) return;
    const repairDelete = url.pathname.match(/^\/api\/admin\/repairs\/([a-z\d-]+)$/i);
    if (repairDelete) {
      if (!isAdmin(user)) return apiError(response, 403, "admin_required", "Nur das Repairly-Team kann Beiträge löschen.");
      const repairIndex = database.repairs.findIndex((repair) => repair.id === repairDelete[1] && !repair.isSample);
      if (repairIndex === -1) return apiError(response, 404, "not_found", "Dieser Community-Beitrag wurde nicht gefunden.");
      const [removed] = database.repairs.splice(repairIndex, 1);
      await saveDatabase();
      return json(response, 200, { deleted: removed.id });
    }
    if (!user) return apiError(response, 401, "authentication_required", "Bitte melde dich an.");
    const vehicleDelete = url.pathname.match(/^\/api\/vehicles\/([a-z\d-]+)$/i);
    if (vehicleDelete) {
      const originalLength = (user.vehicles || []).length;
      user.vehicles = user.vehicles.filter((vehicle) => vehicle.id !== vehicleDelete[1]);
      if (user.vehicles.length === originalLength) return apiError(response, 404, "not_found", "Dieses Fahrzeug wurde nicht gefunden.");
      await saveDatabase();
      return json(response, 200, { user: publicUser(user) });
    }
    return apiError(response, 404, "not_found", "Diese Funktion wurde nicht gefunden.");
  }
  if (request.method !== "POST") return apiError(response, 405, "method_not_allowed", "Diese Methode ist nicht verfügbar.");
  if (!checkOrigin(request, response)) return;
  const body = await requestBody(request);

  if (url.pathname === "/api/auth/register") {
    const name = normalizeText(body.name, 40, "Der Anzeigename");
    const email = normalizeText(body.email, 254, "Die E-Mail-Adresse").toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return apiError(response, 400, "invalid_input", "Bitte gib eine gültige E-Mail-Adresse ein.");
    if (password.length < 10 || password.length > 128) return apiError(response, 400, "invalid_input", "Das Passwort muss 10 bis 128 Zeichen lang sein.");
    if (database.users.some((item) => item.email === email)) return apiError(response, 409, "email_in_use", "Für diese E-Mail-Adresse gibt es bereits ein Konto.");
    if (production && (!resendApiKey || !verificationFromEmail)) return apiError(response, 503, "email_service_unavailable", "Die E-Mail-Bestätigung ist noch nicht eingerichtet.");
    const salt = randomBytes(16).toString("hex");
    const derivedHash = await passwordHash(password, salt);
    if (database.users.some((item) => item.email === email)) return apiError(response, 409, "email_in_use", "Für diese E-Mail-Adresse gibt es bereits ein Konto.");
    const userRecord = { id: randomUUID(), name, email, salt, passwordHash: derivedHash, emailVerified: false, authProviders: {}, role: "user", vehicles: [], createdAt: new Date().toISOString() };
    database.users.push(userRecord);
    try { await createEmailVerification(userRecord, request); }
    catch (error) { return apiError(response, error.status || 502, error.code || "email_delivery_failed", error.message || "Die Bestätigungs-E-Mail konnte nicht gesendet werden."); }
    return json(response, 201, { verificationRequired: true });
  }

  if (url.pathname === "/api/auth/resend-verification") {
    if (production && (!resendApiKey || !verificationFromEmail)) return apiError(response, 503, "email_service_unavailable", "Die E-Mail-Bestätigung ist noch nicht eingerichtet.");
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email && !tooManyAttempts(request, `verify:${email}`)) {
      const account = database.users.find((item) => item.email === email && !item.emailVerified);
      if (account) {
        try { await createEmailVerification(account, request); }
        catch (error) { console.error("Verification resend failed:", error.message || error); }
      }
    }
    return json(response, 200, { sent: true });
  }

  if (url.pathname === "/api/auth/login") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (tooManyAttempts(request, email)) return apiError(response, 429, "rate_limited", "Zu viele Versuche. Bitte warte kurz.");
    const userRecord = database.users.find((item) => item.email === email);
    if (!userRecord || typeof body.password !== "string" || !userRecord.salt || !userRecord.passwordHash) return apiError(response, 401, "invalid_credentials", "E-Mail-Adresse oder Passwort stimmen nicht.");
    const submitted = Buffer.from(await passwordHash(body.password, userRecord.salt), "hex");
    const saved = Buffer.from(userRecord.passwordHash, "hex");
    if (submitted.length !== saved.length || !timingSafeEqual(submitted, saved)) return apiError(response, 401, "invalid_credentials", "E-Mail-Adresse oder Passwort stimmen nicht.");
    if (!userRecord.emailVerified) return apiError(response, 403, "email_not_verified", "Bitte bestätige zuerst deine E-Mail-Adresse. Du kannst dir den Bestätigungslink erneut senden lassen.");
    loginAttempts.delete(rateLimitKey(request, email));
    const token = await createSession(userRecord);
    return json(response, 200, { user: publicUser(userRecord) }, { "Set-Cookie": sessionCookie(token) });
  }

  if (url.pathname === "/api/presence") {
    if (!user) return apiError(response, 401, "authentication_required", "Bitte melde dich an.");
    const session = getCurrentSession(request);
    if (!session) return apiError(response, 401, "authentication_required", "Deine Sitzung ist abgelaufen.");
    session.lastSeenAt = Date.now();
    await saveDatabase();
    return json(response, 200, { online: true });
  }

  if (url.pathname === "/api/profile") {
    if (!user) return apiError(response, 401, "authentication_required", "Bitte melde dich an.");
    if (typeof body.bio !== "string" || body.bio.trim().length > 500) return apiError(response, 400, "invalid_input", "Die Profilbeschreibung darf höchstens 500 Zeichen haben.");
    user.name = normalizeText(body.name, 40, "Der Anzeigename");
    user.bio = body.bio.trim();
    user.avatarData = body.avatarData === undefined ? (user.avatarData || null) : normalizeImageData(body.avatarData, 256 * 1024, "Das Profilbild");
    user.bannerData = body.bannerData === undefined ? (user.bannerData || null) : normalizeImageData(body.bannerData, 512 * 1024, "Das Titelbild");
    await saveDatabase();
    return json(response, 200, { user: publicUser(user) });
  }

  if (url.pathname === "/api/notifications/read-all") {
    if (!user) return apiError(response, 401, "authentication_required", "Bitte melde dich an.");
    const readAt = new Date().toISOString();
    let updated = 0;
    for (const item of database.notifications) {
      if (item.userId === user.id && !item.readAt) { item.readAt = readAt; updated += 1; }
    }
    if (updated) await saveDatabase();
    return json(response, 200, { updated });
  }

  const notificationRead = url.pathname.match(/^\/api\/notifications\/([a-z\d-]+)\/read$/i);
  if (notificationRead) {
    if (!user) return apiError(response, 401, "authentication_required", "Bitte melde dich an.");
    const item = database.notifications.find((notification) => notification.id === notificationRead[1] && notification.userId === user.id);
    if (!item) return apiError(response, 404, "not_found", "Diese Benachrichtigung gibt es nicht mehr.");
    item.readAt ||= new Date().toISOString();
    await saveDatabase();
    return json(response, 200, { notification: item });
  }

  if (url.pathname === "/api/support") {
    const category = ["bug", "content", "account", "other"].includes(body.category) ? body.category : "other";
    const title = normalizeText(body.title, 120, "Der Betreff");
    const description = normalizeText(body.description, 3000, "Die Beschreibung");
    if (title.length < 4 || description.length < 10) return apiError(response, 400, "invalid_input", "Bitte beschreibe dein Anliegen etwas genauer.");
    const deviceToken = typeof body.deviceToken === "string" && body.deviceToken.length >= 32 && body.deviceToken.length <= 128 ? body.deviceToken : "";
    const report = {
      id: randomUUID(), category, title, description, status: "open",
      userId: user?.id || null, userName: user?.name || "Gast",
      notifyTokenHash: !user && deviceToken ? hashToken(deviceToken) : null,
      page: typeof body.page === "string" ? body.page.slice(0, 200) : "/",
      createdAt: new Date().toISOString(), resolutionSeenAt: null,
      messages: [], replyNotificationAt: null, replyNotificationSeenAt: null,
      discordSyncState: discordEnabled ? "pending" : "disabled", discordThreadId: null
    };
    database.reports.push(report);
    await saveDatabase();
    if (discordEnabled) void sendDiscordTicket(report);
    return json(response, 201, { report: { id: report.id, status: report.status } });
  }

  const supportReply = url.pathname.match(/^\/api\/support\/([a-z\d-]+)\/messages$/i);
  if (supportReply) {
    const report = database.reports.find((item) => item.id === supportReply[1]);
    if (!report) return apiError(response, 404, "not_found", "Dieses Supportticket wurde nicht gefunden.");
    const deviceToken = typeof body.deviceToken === "string" && body.deviceToken.length >= 32 && body.deviceToken.length <= 128 ? body.deviceToken : "";
    const belongsToUser = Boolean(user && report.userId === user.id);
    const belongsToDevice = Boolean(deviceToken && report.notifyTokenHash && hashToken(deviceToken) === report.notifyTokenHash);
    if (!belongsToUser && !belongsToDevice) return apiError(response, 403, "forbidden", "Dieses Supportticket gehört nicht zu deinem Konto.");
    const text = normalizeText(body.text, 2000, "Die Nachricht");
    report.messages ||= [];
    if (report.messages.length >= 200) return apiError(response, 429, "message_limit", "Dieses Ticket enthält bereits sehr viele Nachrichten.");
    const wasClosed = report.status === "resolved";
    const message = { id: randomUUID(), authorId: user?.id || null, authorName: user?.name || "Gast", authorRole: "user", text, createdAt: new Date().toISOString() };
    report.messages.push(message);
    report.status = "open";
    report.resolvedAt = null;
    report.resolutionSeenAt = null;
    report.replyNotificationSeenAt = report.replyNotificationAt;
    await saveDatabase();
    void (async () => {
      if (wasClosed) await syncDiscordTicketStatus(report, "open");
      await sendDiscordTicketMessage(report, text, message.authorName);
    })().catch((error) => console.error("Discord support reply failed:", error.message || error));
    return json(response, 201, { message, report: { id: report.id, status: report.status } });
  }

  if (url.pathname === "/api/admin/maintenance") {
    if (!isAdmin(user)) return apiError(response, 403, "admin_required", "Nur Admins können den Wartungsmodus ändern.");
    if (typeof body.enabled !== "boolean") return apiError(response, 400, "invalid_input", "Der Wartungsstatus ist ungültig.");
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 400) : "";
    database.maintenance = { enabled: body.enabled, message };
    await saveDatabase();
    return json(response, 200, { maintenance: database.maintenance });
  }

  if (url.pathname === "/api/notifications/ack") {
    const deviceToken = typeof body.deviceToken === "string" && body.deviceToken.length >= 32 && body.deviceToken.length <= 128 ? body.deviceToken : "";
    const deviceHash = deviceToken ? hashToken(deviceToken) : "";
    if (!user && !deviceHash) return apiError(response, 401, "authentication_required", "Diese Benachrichtigung gehört nicht zu diesem Gerät.");
    const ids = Array.isArray(body.reportIds) ? new Set(body.reportIds.filter((id) => typeof id === "string").slice(0, 100)) : new Set();
    if (!ids.size) return json(response, 200, { acknowledged: 0 });
    const seenAt = new Date().toISOString();
    let acknowledged = 0;
    for (const report of database.reports) {
      const belongsToUser = Boolean(user && report.userId === user.id);
      const belongsToDevice = Boolean(deviceHash && report.notifyTokenHash === deviceHash);
      if (ids.has(report.id) && (belongsToUser || belongsToDevice)) {
        if (report.status === "resolved" && !report.resolutionSeenAt) { report.resolutionSeenAt = seenAt; acknowledged += 1; }
        if (report.replyNotificationAt && !report.replyNotificationSeenAt) { report.replyNotificationSeenAt = seenAt; acknowledged += 1; }
      }
    }
    if (acknowledged) await saveDatabase();
    return json(response, 200, { acknowledged });
  }

  if (url.pathname === "/api/notifications/pending") {
    const deviceToken = typeof body.deviceToken === "string" && body.deviceToken.length >= 32 && body.deviceToken.length <= 128 ? body.deviceToken : "";
    const deviceHash = deviceToken ? hashToken(deviceToken) : "";
    if (!user && !deviceHash) return apiError(response, 401, "authentication_required", "Diese Benachrichtigung gehört nicht zu diesem Gerät.");
    const notifications = database.reports
      .filter((report) => (Boolean(user && report.userId === user.id) || Boolean(deviceHash && report.notifyTokenHash === deviceHash)) && ((report.status === "resolved" && !report.resolutionSeenAt) || (report.replyNotificationAt && !report.replyNotificationSeenAt)))
      .map((report) => ({ reportId: report.id, kind: report.replyNotificationAt && !report.replyNotificationSeenAt ? "reply" : "resolved" }));
    return json(response, 200, { notifications });
  }

  const adminReportMessage = url.pathname.match(/^\/api\/admin\/reports\/([a-z\d-]+)\/messages$/i);
  if (adminReportMessage) {
    if (!isAdmin(user)) return apiError(response, 403, "admin_required", "Nur das Repairly-Team kann Supportanfragen beantworten.");
    const report = database.reports.find((item) => item.id === adminReportMessage[1]);
    if (!report) return apiError(response, 404, "not_found", "Diese Supportmeldung wurde nicht gefunden.");
    const text = normalizeText(body.text, 2000, "Die Antwort");
    report.messages ||= [];
    if (report.messages.length >= 200) return apiError(response, 429, "message_limit", "Dieses Ticket enthält bereits sehr viele Nachrichten.");
    const wasClosed = report.status === "resolved";
    const message = { id: randomUUID(), authorId: user.id, authorName: user.name, authorRole: "team", text, createdAt: new Date().toISOString() };
    report.messages.push(message);
    report.status = "open";
    report.resolvedAt = null;
    report.resolutionSeenAt = null;
    report.replyNotificationAt = message.createdAt;
    report.replyNotificationSeenAt = null;
    if (report.userId) notifyUser(report.userId, { type: "support_reply", actorName: user.name, reportId: report.id, title: report.title });
    await saveDatabase();
    void (async () => {
      if (wasClosed) await syncDiscordTicketStatus(report, "open");
      await sendDiscordTicketMessage(report, text, user.name);
    })().catch((error) => console.error("Discord support reply failed:", error.message || error));
    return json(response, 201, { message, report: { id: report.id, status: report.status } });
  }

  const reportUpdate = url.pathname.match(/^\/api\/admin\/reports\/([a-z\d-]+)$/i);
  if (reportUpdate) {
    if (!isAdmin(user)) return apiError(response, 403, "admin_required", "Nur Admins können Supportmeldungen bearbeiten.");
    if (!["open", "resolved"].includes(body.status)) return apiError(response, 400, "invalid_input", "Dieser Meldungsstatus ist ungültig.");
    const report = database.reports.find((item) => item.id === reportUpdate[1]);
    if (!report) return apiError(response, 404, "not_found", "Diese Meldung wurde nicht gefunden.");
    report.status = body.status;
    report.resolvedAt = body.status === "resolved" ? new Date().toISOString() : null;
    report.resolutionSeenAt = null;
    if (body.status === "resolved" && report.userId) notifyUser(report.userId, { type: "support_closed", actorName: user.name, reportId: report.id, title: report.title });
    await saveDatabase();
    void syncDiscordTicketStatus(report, body.status).catch((error) => console.error("Discord ticket status sync failed:", error.message || error));
    return json(response, 200, { report });
  }

  const roleUpdate = url.pathname.match(/^\/api\/admin\/users\/([a-z\d-]+)$/i);
  if (roleUpdate) {
    if (!isAdmin(user)) return apiError(response, 403, "admin_required", "Nur Admins können Teamrollen ändern.");
    if (!["admin", "user"].includes(body.role)) return apiError(response, 400, "invalid_input", "Diese Rolle ist ungültig.");
    const target = database.users.find((item) => item.id === roleUpdate[1]);
    if (!target) return apiError(response, 404, "not_found", "Dieses Konto wurde nicht gefunden.");
    if ((target.id === ownerAccountId || target.id === user.id) && body.role !== "admin") return apiError(response, 400, "owner_role_locked", "Der eigene Admin-Zugang kann hier nicht entfernt werden.");
    if (body.role === "user" && database.users.filter((item) => item.role === "admin").length <= 1) return apiError(response, 400, "last_admin", "Mindestens ein Admin muss Zugriff behalten.");
    target.role = body.role;
    await saveDatabase();
    return json(response, 200, { user: { id: target.id, name: target.name, role: target.role, isOwner: Boolean(target.isOwner) } });
  }

  if (url.pathname === "/api/auth/logout") {
    const token = readCookie(request, "repairly_session");
    if (token) {
      database.sessions = database.sessions.filter((item) => item.tokenHash !== hashToken(token));
      await saveDatabase();
    }
    return json(response, 200, { user: null }, { "Set-Cookie": `repairly_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${production ? "; Secure" : ""}` });
  }

  if (url.pathname === "/api/vehicles") {
    if (!user) return apiError(response, 401, "authentication_required", "Bitte melde dich an.");
    user.vehicles ||= [];
    if (user.vehicles.length >= 20) return apiError(response, 400, "vehicle_limit", "Du kannst bis zu 20 Fahrzeuge speichern.");
    if (!["car", "motorcycle"].includes(body.kind)) return apiError(response, 400, "invalid_input", "Bitte wähle Auto oder Motorrad.");
    const make = normalizeText(body.make, 60, "Die Marke");
    const model = normalizeText(body.model, 80, "Das Modell");
    const year = body.year === "" || body.year == null ? null : Number(body.year);
    if (year !== null && (!Number.isInteger(year) || year < 1950 || year > new Date().getFullYear() + 1)) return apiError(response, 400, "invalid_input", "Bitte gib ein gültiges Baujahr ein.");
    const engine = typeof body.engine === "string" ? body.engine.trim().slice(0, 60) : "";
    const vehicle = { id: randomUUID(), kind: body.kind, make, model, year, engine, createdAt: new Date().toISOString() };
    user.vehicles.push(vehicle);
    await saveDatabase();
    return json(response, 201, { user: publicUser(user), vehicle });
  }

  if (url.pathname === "/api/repairs") {
    if (!user) return apiError(response, 401, "authentication_required", "Bitte melde dich an.");
    const title = normalizeText(body.title, 100, "Der Titel");
    let linkedVehicle = null;
    if (typeof body.vehicleId === "string" && body.vehicleId) {
      linkedVehicle = (user.vehicles || []).find((vehicle) => vehicle.id === body.vehicleId) || null;
      if (!linkedVehicle) return apiError(response, 403, "vehicle_not_owned", "Dieses Fahrzeug gehört nicht zu deiner Garage.");
    }
    const vehicle = linkedVehicle
      ? [linkedVehicle.make, linkedVehicle.model, linkedVehicle.year, linkedVehicle.engine].filter(Boolean).join(" · ")
      : normalizeText(body.vehicle, 100, "Die Fahrzeugangabe");
    const summary = normalizeText(body.summary, 500, "Die Kurzbeschreibung");
    const category = typeof body.category === "string" && repairCategories.has(body.category) ? body.category : "other";
    const difficulty = typeof body.difficulty === "string" && repairDifficulties.has(body.difficulty) ? body.difficulty : "medium";
    if (title.length < 5 || summary.length < 15) return apiError(response, 400, "invalid_input", "Titel und Kurzbeschreibung sind zu kurz.");
    if (!Array.isArray(body.steps) || body.steps.length < 2 || body.steps.length > 30) return apiError(response, 400, "invalid_input", "Bitte beschreibe mindestens zwei und höchstens 30 Arbeitsschritte.");
    const steps = body.steps.map((step) => normalizeText(step, 500, "Ein Arbeitsschritt"));
    if (steps.join(" ").length < 20) return apiError(response, 400, "invalid_input", "Bitte beschreibe die Arbeitsschritte etwas genauer.");
    if (!Array.isArray(body.parts) || body.parts.length > 8) return apiError(response, 400, "invalid_input", "Es sind höchstens acht Teile-Links erlaubt.");
    const parts = body.parts.map((value) => {
      const link = normalizeText(value, 1000, "Ein Teile-Link");
      let parsed;
      try { parsed = new URL(link); } catch { throw Object.assign(new Error("Bitte verwende gültige http- oder https-Links."), { status: 400, code: "invalid_input" }); }
      if (!(["http:", "https:"].includes(parsed.protocol))) throw Object.assign(new Error("Bitte verwende gültige http- oder https-Links."), { status: 400, code: "invalid_input" });
      return { url: parsed.href, label: parsed.hostname };
    });
    if (body.stepImages != null && (!Array.isArray(body.stepImages) || body.stepImages.length > steps.length || body.stepImages.length > 8)) {
      return apiError(response, 400, "invalid_input", "Du kannst Bilder für höchstens acht Arbeitsschritte hinzufügen.");
    }
    const stepImages = (body.stepImages || []).map((image, index) => image ? normalizeImageData(image, 180 * 1024, `Schrittbild ${index + 1}`) : null);
    if (!stepImages.some(Boolean)) return apiError(response, 400, "image_required", "Bitte füge mindestens ein Bild hinzu, bevor du die Anleitung veröffentlichst.");
    const repair = {
      id: randomUUID(), authorId: user.id, authorName: user.name, vehicleId: linkedVehicle?.id || null, title, vehicle, category, difficulty, summary,
      steps, stepImages, parts, confirmationsBy: [], comments: [], likesBy: [], adminVerified: false, adminVerifiedBy: null, adminVerifiedAt: null, createdAt: new Date().toISOString(), isSample: false
    };
    database.repairs.push(repair);
    await saveDatabase();
    return json(response, 201, { repair: repairView(repair, user) });
  }

  const repairComments = url.pathname.match(/^\/api\/repairs\/([a-z\d-]+)\/comments$/i);
  if (repairComments) {
    if (!user) return apiError(response, 401, "authentication_required", "Bitte melde dich an, um zu kommentieren.");
    const repair = database.repairs.find((item) => item.id === repairComments[1]);
    if (!repair) return apiError(response, 404, "not_found", "Diese Anleitung gibt es nicht mehr.");
    const text = normalizeText(body.text, 1000, "Der Kommentar");
    if (text.length < 2) return apiError(response, 400, "invalid_input", "Der Kommentar ist zu kurz.");
    repair.comments ||= [];
    if (repair.comments.length >= 500) return apiError(response, 429, "comment_limit", "Zu dieser Anleitung gibt es bereits sehr viele Kommentare.");
    const comment = { id: randomUUID(), authorId: user.id, authorName: user.name, text, createdAt: new Date().toISOString() };
    repair.comments.push(comment);
    if (repair.authorId !== user.id) notifyUser(repair.authorId, { type: "comment", actorName: user.name, repairId: repair.id, title: repair.title });
    await saveDatabase();
    return json(response, 201, { comment });
  }

  const repairLike = url.pathname.match(/^\/api\/repairs\/([a-z\d-]+)\/like$/i);
  if (repairLike) {
    if (!user) return apiError(response, 401, "authentication_required", "Bitte melde dich an, um Anleitungen zu liken.");
    const repair = database.repairs.find((item) => item.id === repairLike[1]);
    if (!repair) return apiError(response, 404, "not_found", "Diese Anleitung gibt es nicht mehr.");
    if (repair.authorId === user.id) return apiError(response, 400, "own_repair", "Deine eigene Anleitung kannst du nicht liken.");
    repair.likesBy ||= [];
    const existingIndex = repair.likesBy.indexOf(user.id);
    const liked = existingIndex < 0;
    if (liked) {
      if (repair.likesBy.length >= 10_000) return apiError(response, 429, "like_limit", "Diese Anleitung hat bereits sehr viele Likes.");
      repair.likesBy.push(user.id);
      notifyUser(repair.authorId, { type: "like", actorName: user.name, repairId: repair.id, title: repair.title });
    } else repair.likesBy.splice(existingIndex, 1);
    await saveDatabase();
    return json(response, 200, { repair: repairView(repair, user), liked });
  }

  const adminVerification = url.pathname.match(/^\/api\/admin\/repairs\/([a-z\d-]+)\/verification$/i);
  if (adminVerification) {
    if (!isAdmin(user)) return apiError(response, 403, "admin_required", "Nur Admins können Anleitungen prüfen.");
    if (typeof body.verified !== "boolean") return apiError(response, 400, "invalid_input", "Der Prüfstatus ist ungültig.");
    const repair = database.repairs.find((item) => item.id === adminVerification[1]);
    if (!repair || repair.isSample) return apiError(response, 404, "not_found", "Diese Community-Anleitung wurde nicht gefunden.");
    repair.adminVerified = body.verified;
    repair.adminVerifiedBy = body.verified ? user.id : null;
    repair.adminVerifiedAt = body.verified ? new Date().toISOString() : null;
    await saveDatabase();
    return json(response, 200, { repair: repairView(repair, user) });
  }

  const confirmation = url.pathname.match(/^\/api\/repairs\/([a-z\d-]+)\/confirm$/i);
  if (confirmation) {
    if (!user) return apiError(response, 401, "authentication_required", "Bitte melde dich an.");
    const repair = database.repairs.find((item) => item.id === confirmation[1]);
    if (!repair) return apiError(response, 404, "not_found", "Diese Anleitung gibt es nicht mehr.");
    if (repair.authorId === user.id) return apiError(response, 400, "own_repair", "Eigene Anleitungen kannst du nicht bestätigen.");
    repair.confirmationsBy ||= [];
    if (repair.confirmationsBy.includes(user.id)) return apiError(response, 409, "already_confirmed", "Du hast diese Anleitung bereits bestätigt.");
    repair.confirmationsBy.push(user.id);
    await saveDatabase();
    return json(response, 200, { repair: repairView(repair, user) });
  }

  return apiError(response, 404, "not_found", "Diese Funktion wurde nicht gefunden.");
}

const contentTypes = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".gif": "image/gif", ".ico": "image/x-icon"
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

async function serveMaintenance(response) {
  const pagePath = resolve(projectRoot, "maintenance.html");
  const page = await readFile(pagePath, "utf8");
  const message = database.maintenance.message || "Wir führen gerade Wartungsarbeiten durch und sind bald wieder online.";
  response.writeHead(503, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Retry-After": "300",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'"
  });
  response.end(page.replace("{{MAINTENANCE_MESSAGE}}", escapeHtml(message)));
}

async function serveStatic(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error: "Method not allowed." });
  let pathname = decodeURIComponent(url.pathname);
  const visitorIsAdmin = isAdmin(getCurrentUser(request));
  if (database.maintenance.enabled && !visitorIsAdmin && ["/", "/index.html", "/maintenance.html"].includes(pathname)) {
    return serveMaintenance(response);
  }
  if (!database.maintenance.enabled && pathname === "/maintenance.html") {
    response.writeHead(302, { Location: "/", "Cache-Control": "no-store" }); response.end(); return;
  }
  if (database.maintenance.enabled && !visitorIsAdmin && pathname === "/script.js") {
    return apiError(response, 503, "maintenance", database.maintenance.message || "Repairly ist gerade kurz in Wartung.");
  }
  if (pathname === "/") pathname = "/index.html";
  const path = resolve(projectRoot, "." + pathname);
  if (path !== projectRoot && !path.startsWith(projectRoot + sep)) {
    response.writeHead(403); response.end("Forbidden"); return;
  }
  if (!publicFiles.has(path.slice(projectRoot.length + 1).replaceAll("\\", "/"))) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Not found"); return;
  }
  try {
    const contents = await readFile(path);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(path).toLowerCase()] || "application/octet-stream",
      "Cache-Control": [".html", ".css", ".js"].includes(extname(path).toLowerCase()) ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'"
    });
    response.end(request.method === "HEAD" ? undefined : contents);
  } catch (error) {
    if (error.code === "ENOENT") { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Not found"); return; }
    throw error;
  }
}

await loadDatabase();
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) await handleApi(request, response, url);
    else await serveStatic(request, response, url);
  } catch (error) {
    console.error(error);
    if (response.headersSent) { response.destroy(); return; }
    apiError(response, error.status || 500, error.code || "server_error", error.status ? error.message : "Ein unerwarteter Serverfehler ist aufgetreten.");
  }
});

server.listen(port, host, () => {
  console.log(`Repairly is running at http://${host}:${port}`);
  console.log(`Account and repair data: ${databasePath}`);
  if (discordEnabled) connectDiscordGateway();
  else console.log("Discord support bot is not configured (set DISCORD_BOT_TOKEN and DISCORD_SUPPORT_CHANNEL_ID).");
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") console.error(`Port ${port} ist bereits belegt. Setze PORT auf einen anderen freien Port.`);
  else console.error(error);
  process.exitCode = 1;
});
