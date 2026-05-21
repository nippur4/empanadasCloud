// ─────────────────────────────────────────────
// Lógica principal de la app
// Depende de: config.js (db), sabores.js (SABORES)
// ─────────────────────────────────────────────

let sessionCode     = null;
let isReadonly      = false;
let isHistory       = false;  // true sólo al ver historial (no sesión activa)
let currentListener = null;
let editNick        = null;

// ── INICIALIZACIÓN ──────────────────────────────────────────
async function init() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get("code");
  const panel  = params.get("panel");

  if (!code) {
    showView("landingView");
    refreshReturnBtn();
    return;
  }

  try {
    const snap = await db.ref(`sessions/${code}`).get();
    if (!snap.exists()) { showView("invalidView"); return; }

    sessionCode = code;
    if (panel === "1") {
      isReadonly = !isOwnedSession(code);
      isHistory  = false;
      if (!isReadonly) setActiveSession(code);
      enterAsHost(code);
    } else {
      showClientView();
    }
  } catch (err) {
    console.error("Error al verificar sesión:", err);
    showView("invalidView");
  }
}

// ── VISTAS ──────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ── HOST ────────────────────────────────────────────────────
async function goHost() {
  isReadonly = false;
  isHistory  = false;

  const code = genCode();
  sessionCode = code;

  showView("hostView");
  setLinkDisplay(code);
  updateHostUI();
  updateURL(code, true);

  const label = new Date().toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
  addOwnedSession(code, label);

  try {
    await db.ref(`sessions/${code}`).set({ createdAt: Date.now(), label });
  } catch (err) {
    console.error("Error al crear sesión:", err);
    setStatus("⚠️ Error al conectar con Firebase. Revisá la configuración y las reglas de la base de datos.");
    return;
  }

  listenOrders(code);
}

// Entra al panel de una sesión existente (como host o readonly)
function enterAsHost(code) {
  sessionCode = code;
  showView("hostView");
  setLinkDisplay(code);
  updateHostUI();
  updateURL(code, true);
  listenOrders(code);
}

function setLinkDisplay(code) {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set("code", code);
  document.getElementById("linkDisplay").textContent = url.toString();
}

function setStatus(msg) {
  document.getElementById("statusBar").innerHTML = msg;
}

function updateHostUI() {
  document.getElementById("linkBar").style.display       = isReadonly ? "none" : "flex";
  document.getElementById("resetBtn").style.display      = isReadonly ? "none" : "inline-flex";
  document.getElementById("orderBtn").style.display      = isHistory  ? "none" : "inline-flex";
  document.getElementById("readonlyBadge").style.display = isReadonly ? "inline-block" : "none";
  document.getElementById("actionsHeader").textContent   = isReadonly ? "" : "Acciones";
}

function goHome() {
  if (currentListener) {
    db.ref(`orders/${currentListener}`).off();
    currentListener = null;
  }
  history.pushState({}, "", window.location.pathname);
  showView("landingView");
  refreshReturnBtn();
}

// El organizador quiere hacer su propio pedido
function goToOrder() {
  if (currentListener) {
    db.ref(`orders/${currentListener}`).off();
    currentListener = null;
  }
  updateURL(sessionCode, false);
  showClientView();
}

// Clientes (o el propio organizador) pasan a ver el panel
function goToPanel() {
  isReadonly = !isOwnedSession(sessionCode);
  isHistory  = false;
  enterAsHost(sessionCode);
}

// Muestra/oculta el botón de retorno a sesión activa en el landing
function refreshReturnBtn() {
  const stored = getHostSession();
  const btn = document.getElementById("returnSessionBtn");
  if (!btn) return;
  if (stored) {
    btn.style.display = "inline-flex";
    btn.onclick = () => { isReadonly = false; isHistory = false; enterAsHost(stored.code); };
  } else {
    btn.style.display = "none";
  }
}

// ── LISTENER DE PEDIDOS EN TIEMPO REAL ──────────────────────
function listenOrders(code) {
  if (currentListener) {
    db.ref(`orders/${currentListener}`).off();
  }
  currentListener = code;

  db.ref(`orders/${code}`).on("value", snap => {
    const orders = snap.val() ? Object.values(snap.val()) : [];
    renderDashboard(orders);
  }, err => {
    console.error("Error al escuchar pedidos:", err);
    setStatus("⚠️ Error al leer pedidos. Revisá las reglas de Firebase.");
  });
}

function renderDashboard(orders) {
  // Total general
  const grandTotal = orders.reduce((sum, o) => sum + o.total, 0);
  const strip = document.getElementById("totalStrip");
  if (grandTotal > 0) {
    strip.style.display = "flex";
    document.getElementById("totalCount").textContent = grandTotal;
    document.getElementById("totalPeople").textContent =
      `· ${orders.length} persona${orders.length !== 1 ? "s" : ""}`;
  } else {
    strip.style.display = "none";
  }

  // Resumen por sabor
  const totals = {};
  orders.forEach(o =>
    Object.entries(o.pedido).forEach(([s, q]) => totals[s] = (totals[s] || 0) + q)
  );
  const grid = document.getElementById("summaryGrid");
  grid.innerHTML = Object.keys(totals).length
    ? Object.entries(totals).sort((a, b) => b[1] - a[1])
        .map(([s, q]) => `
          <div class="summary-card">
            <span class="sabor">${esc(s)}</span>
            <span class="count">${q}</span>
          </div>`).join("")
    : `<div class="empty-state" style="width:100%;padding:16px">Sin pedidos aún.</div>`;

  // Tabla por persona
  const tbody = document.getElementById("ordersBody");
  tbody.innerHTML = orders.length
    ? orders.sort((a, b) => a.ts - b.ts).map(o => {
        const key = nickToKey(o.nick);
        const editBtn = isReadonly ? "" :
          `<button class="btn btn-primary btn-sm" onclick="openEditModal('${esc(o.nick)}')">✏ Editar</button>`;
        const deleteBtn = isReadonly ? "" :
          `<button class="btn btn-danger btn-sm" onclick="deleteOrder('${esc(key)}','${esc(o.nick)}')">✕ Borrar</button>`;
        return `<tr>
          <td><button class="nick-btn" onclick="showDetail('${esc(o.nick)}')">${esc(o.nick)}</button></td>
          <td><span class="badge">${o.total} 🫓</span></td>
          <td style="white-space:nowrap">${editBtn ? editBtn + "&nbsp;" : ""}${deleteBtn}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="3" class="empty-state">Nadie pidió todavía.</td></tr>`;

  if (!isReadonly) {
    setStatus(`<span class="dot"></span>&nbsp;En vivo · Última actualización: ${new Date().toLocaleTimeString("es-AR")}`);
  }
}

// ── EDITAR PEDIDO ────────────────────────────────────────────
async function openEditModal(nick) {
  try {
    const snap = await db.ref(`orders/${sessionCode}`).get();
    const data = snap.val() || {};
    const o = Object.values(data).find(x => x.nick === nick);
    if (!o) return;

    editNick = nick;
    document.getElementById("editModalName").textContent = nick;
    document.getElementById("editModalRows").innerHTML = SABORES.map((s, i) => {
      const qty = o.pedido[s] || 0;
      return `<div class="emp-row">
        <span class="emp-name">${esc(s)}</span>
        <div class="qty-ctrl">
          <button class="qty-btn" onclick="chgEdit(${i},-1)">−</button>
          <span class="qty-val" id="eq${i}">${qty}</span>
          <button class="qty-btn" onclick="chgEdit(${i},1)">+</button>
        </div>
      </div>`;
    }).join("");
    updateEditTotal();
    document.getElementById("editModal").classList.add("open");
  } catch (err) {
    console.error("Error al cargar pedido para editar:", err);
    alert("Error al cargar el pedido. Intentá de nuevo.");
  }
}

function chgEdit(i, d) {
  const el = document.getElementById("eq" + i);
  el.textContent = Math.max(0, +el.textContent + d);
  updateEditTotal();
}

function updateEditTotal() {
  const total = SABORES.reduce((sum, s, i) => sum + (+document.getElementById("eq" + i).textContent), 0);
  document.getElementById("editModalTotal").textContent = `${total} 🫓`;
}

async function saveEditOrder() {
  const pedido = {}; let total = 0;
  SABORES.forEach((s, i) => {
    const q = +document.getElementById("eq" + i).textContent;
    if (q > 0) { pedido[s] = q; total += q; }
  });
  if (!total) { alert("El pedido debe tener al menos una empanada."); return; }

  const key = nickToKey(editNick);
  const btn = document.querySelector("#editModal .btn-success");
  btn.innerHTML = `<span class="spinner"></span>&nbsp;Guardando…`;
  btn.disabled = true;
  try {
    await db.ref(`orders/${sessionCode}/${key}`).update({ pedido, total });
    closeMO("editModal");
  } catch (err) {
    alert("Error al guardar los cambios. Intentá de nuevo.");
    console.error(err);
  } finally {
    btn.innerHTML = "Guardar ✓";
    btn.disabled = false;
  }
}

// ── BORRAR PEDIDO INDIVIDUAL ─────────────────────────────────
async function deleteOrder(key, nick) {
  if (!confirm(`¿Borrar el pedido de "${nick}"?`)) return;
  try {
    await db.ref(`orders/${sessionCode}/${key}`).remove();
  } catch (err) {
    alert("Error al borrar el pedido. Intentá de nuevo.");
    console.error(err);
  }
}

// ── REINICIAR DASHBOARD ──────────────────────────────────────
async function resetDashboard() {
  if (!confirm("¿Borrás todos los pedidos y generás un link nuevo?")) return;

  if (currentListener) {
    db.ref(`orders/${currentListener}`).off();
    currentListener = null;
  }

  try {
    await db.ref(`orders/${sessionCode}`).remove();
  } catch (err) {
    console.error("Error al borrar pedidos:", err);
  }

  const code = genCode();
  sessionCode = code;
  const label = new Date().toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });

  addOwnedSession(code, label);

  try {
    await db.ref(`sessions/${code}`).set({ createdAt: Date.now(), label });
  } catch (err) {
    console.error("Error al crear nueva sesión:", err);
  }

  isReadonly = false;
  isHistory  = false;
  setLinkDisplay(code);
  updateURL(code, true);
  updateHostUI();
  listenOrders(code);
}

// ── HISTORIAL ────────────────────────────────────────────────
// Mergea sesiones de Firebase + las propias en localStorage (dedupe por code),
// así si la DB se vacía o el navegador es nuevo, igual ves tus sesiones.
async function openHistoryModal() {
  document.getElementById("historyModal").classList.add("open");
  document.getElementById("historyList").innerHTML = `<p class="empty-state">Cargando…</p>`;

  const owned = getOwnedSessions();
  const ownedSet = new Set(owned.map(s => s.code));

  let remote = [];
  try {
    const snap = await db.ref("sessions").orderByChild("createdAt").get();
    if (snap.exists()) snap.forEach(c => remote.push({ code: c.key, ...c.val() }));
  } catch (err) {
    console.error("Error al cargar historial de Firebase:", err);
  }

  const merged = new Map();
  remote.forEach(s => merged.set(s.code, s));
  owned.forEach(s => { if (!merged.has(s.code)) merged.set(s.code, s); });
  const all = [...merged.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!all.length) {
    document.getElementById("historyList").innerHTML =
      `<p class="empty-state">No hay sesiones guardadas.</p>`;
    return;
  }

  const counts = await Promise.all(all.map(async s => {
    try {
      const o = await db.ref(`orders/${s.code}`).get();
      return o.exists() ? Object.keys(o.val()).length : 0;
    } catch { return 0; }
  }));

  document.getElementById("historyList").innerHTML = all.map((s, i) => {
    const mine = ownedSet.has(s.code);
    const badge = mine ? `<span class="hist-mine">tuya</span>` : "";
    const btnLabel = mine ? "Abrir →" : "Ver →";
    return `
      <div class="hist-item">
        <div>
          <div class="hist-date">${esc(s.label || "Sesión sin fecha")} ${badge}</div>
          <div class="hist-code">Código: ${esc(s.code)}</div>
          <div class="hist-count">${counts[i]} persona${counts[i] !== 1 ? "s" : ""} pidieron</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="loadHistorySession('${esc(s.code)}')">${btnLabel}</button>
      </div>`;
  }).join("");
}

async function loadHistorySession(code) {
  closeMO("historyModal");

  if (currentListener) {
    db.ref(`orders/${currentListener}`).off();
    currentListener = null;
  }

  sessionCode = code;

  if (isOwnedSession(code)) {
    // Sesión propia → modo host completo, con listener en vivo
    setActiveSession(code);
    isReadonly = false;
    isHistory  = false;
    enterAsHost(code);
    return;
  }

  // Sesión ajena → snapshot sólo lectura
  isReadonly = true;
  isHistory  = true;
  showView("hostView");
  setLinkDisplay(code);
  updateHostUI();
  updateURL(code, true);

  try {
    const [ordersSnap, metaSnap] = await Promise.all([
      db.ref(`orders/${code}`).get(),
      db.ref(`sessions/${code}`).get()
    ]);
    const orders = ordersSnap.exists() ? Object.values(ordersSnap.val()) : [];
    const meta = metaSnap.val();
    setStatus(`📂 Historial: ${meta?.label || code}`);
    renderDashboard(orders);
  } catch (err) {
    console.error("Error al cargar sesión histórica:", err);
    setStatus("⚠️ Error al cargar los pedidos de esta sesión.");
  }
}

// ── COPIAR LINK ──────────────────────────────────────────────
function copyLink() {
  const link = document.getElementById("linkDisplay").textContent;
  const btn = document.getElementById("copyBtn");
  const done = () => { btn.textContent = "¡Copiado! ✓"; setTimeout(() => btn.textContent = "Copiar link", 2500); };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(link).then(done).catch(() => fallbackCopy(link, done));
  } else {
    fallbackCopy(link, done);
  }
}

function fallbackCopy(text, cb) {
  const ta = document.createElement("textarea");
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); cb(); } catch {}
  document.body.removeChild(ta);
}

// ── VISTA CLIENTE ────────────────────────────────────────────
function showClientView() {
  showView("clientView");
  document.getElementById("empanadasList").innerHTML = SABORES.map((s, i) => `
    <div class="emp-row">
      <span class="emp-name">${esc(s)}</span>
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="chg(${i},-1)">−</button>
        <span class="qty-val" id="q${i}">0</span>
        <button class="qty-btn" onclick="chg(${i},1)">+</button>
      </div>
    </div>`).join("");
}

function chg(i, d) {
  const el = document.getElementById("q" + i);
  el.textContent = Math.max(0, +el.textContent + d);
}

async function submitOrder() {
  const nick = document.getElementById("nicknameInput").value.trim();
  if (!nick) {
    const input = document.getElementById("nicknameInput");
    input.classList.add("nickname-input-error");
    input.focus();
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const pedido = {}; let total = 0;
  SABORES.forEach((s, i) => {
    const q = +document.getElementById("q" + i).textContent;
    if (q > 0) { pedido[s] = q; total += q; }
  });
  if (!total) { alert("Seleccioná al menos una empanada."); return; }

  const btn = document.getElementById("submitBtn");
  btn.innerHTML = `<span class="spinner"></span>&nbsp;Guardando…`;
  btn.disabled = true;

  try {
    const key = nickToKey(nick);
    await db.ref(`orders/${sessionCode}/${key}`).set({ nick, pedido, total, ts: Date.now() });
    showView("successView");
  } catch (err) {
    console.error("Error al guardar pedido:", err);
    alert("Error al guardar. Revisá tu conexión e intentá de nuevo.");
    btn.innerHTML = "Guardar pedido ✓";
    btn.disabled = false;
  }
}

// ── MODAL DETALLE ────────────────────────────────────────────
async function showDetail(nick) {
  try {
    const snap = await db.ref(`orders/${sessionCode}`).get();
    const data = snap.val() || {};
    const o = Object.values(data).find(x => x.nick === nick);
    if (!o) return;
    document.getElementById("detailName").textContent = nick;
    document.getElementById("detailRows").innerHTML = Object.entries(o.pedido)
      .map(([s, q]) => `<div class="detail-row"><span>${esc(s)}</span><span><strong>${q}</strong></span></div>`).join("");
    document.getElementById("detailTotal").textContent = `${o.total} 🫓`;
    document.getElementById("detailModal").classList.add("open");
  } catch (err) {
    console.error("Error al cargar detalle:", err);
  }
}

// ── UTILIDADES ───────────────────────────────────────────────
function genCode() {
  return Math.random().toString(36).substr(2, 8).toUpperCase();
}

function nickToKey(nick) {
  return nick.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

function closeMO(id, e) {
  if (!e || e.target === document.getElementById(id))
    document.getElementById(id).classList.remove("open");
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function updateURL(code, isPanel) {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set("code", code);
  if (isPanel) url.searchParams.set("panel", "1");
  history.replaceState({}, "", url);
}

// ── LOCALSTORAGE (sesiones del organizador) ──────────────────
// Estructura:
//   empanadas_host_sessions  → [{ code, label, createdAt }, ...]  (sesiones creadas en este dispositivo)
//   empanadas_active_session → "CODE"  (puntero a la última activa, para "Volver a mi sesión")

function getOwnedSessions() {
  try {
    const raw = localStorage.getItem("empanadas_host_sessions");
    if (raw) return JSON.parse(raw) || [];

    // Migración del formato viejo (objeto único)
    const old = localStorage.getItem("empanadas_host_session");
    if (old) {
      const parsed = JSON.parse(old);
      if (parsed?.code) {
        const list = [{ code: parsed.code, label: parsed.label || "", createdAt: Date.now() }];
        localStorage.setItem("empanadas_host_sessions", JSON.stringify(list));
        localStorage.setItem("empanadas_active_session", parsed.code);
        return list;
      }
    }
    return [];
  } catch { return []; }
}

function addOwnedSession(code, label) {
  const list = getOwnedSessions();
  if (!list.some(s => s.code === code)) {
    list.unshift({ code, label, createdAt: Date.now() });
    if (list.length > 100) list.length = 100;
    localStorage.setItem("empanadas_host_sessions", JSON.stringify(list));
  }
  localStorage.setItem("empanadas_active_session", code);
}

function setActiveSession(code) {
  localStorage.setItem("empanadas_active_session", code);
}

function isOwnedSession(code) {
  return getOwnedSessions().some(s => s.code === code);
}

// Mantiene la forma {code, label} para los call-sites existentes
function getHostSession() {
  const code = localStorage.getItem("empanadas_active_session");
  if (!code) return null;
  const found = getOwnedSessions().find(s => s.code === code);
  return found ? { code: found.code, label: found.label } : null;
}

// ── ARRANQUE ─────────────────────────────────────────────────
init();
