// ─────────────────────────────────────────────
// Lógica principal de la app
// Depende de: config.js (db), sabores.js (SABORES)
// ─────────────────────────────────────────────

let sessionCode = null;
let isReadonly = false;
let currentListener = null; // código del listener activo de Firebase

// ── INICIALIZACIÓN ──────────────────────────────────────────
// Lee el ?code= de la URL para saber si es vista de cliente o de organizador
async function init() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");

  if (!code) {
    showView("landingView");
    return;
  }

  try {
    const snap = await db.ref(`sessions/${code}`).get();
    if (snap.exists()) {
      sessionCode = code;
      showClientView();
    } else {
      showView("invalidView");
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
  showView("hostView");

  // Generar código y mostrar el link de inmediato (sin esperar a Firebase)
  sessionCode = genCode();
  setLinkDisplay(sessionCode);
  updateHostUI();

  // Guardar sesión en Firebase en segundo plano
  const label = new Date().toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });

  try {
    await db.ref(`sessions/${sessionCode}`).set({ createdAt: Date.now(), label });
  } catch (err) {
    console.error("Error al crear sesión:", err);
    setStatus("⚠️ Error al conectar con Firebase. Revisá la configuración y las reglas de la base de datos.");
    return;
  }

  listenOrders(sessionCode);
}

function setLinkDisplay(code) {
  const link = `${window.location.origin}${window.location.pathname}?code=${code}`;
  document.getElementById("linkDisplay").textContent = link;
}

function setStatus(msg) {
  document.getElementById("statusBar").innerHTML = msg;
}

function updateHostUI() {
  document.getElementById("linkBar").style.display      = isReadonly ? "none" : "flex";
  document.getElementById("resetBtn").style.display     = isReadonly ? "none" : "inline-flex";
  document.getElementById("readonlyBadge").style.display = isReadonly ? "inline-block" : "none";
  document.getElementById("actionsHeader").textContent  = isReadonly ? "" : "Acciones";
}

// ── LISTENER DE PEDIDOS EN TIEMPO REAL ──────────────────────
function listenOrders(code) {
  // Desuscribir listener anterior
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
        const deleteBtn = isReadonly ? "" :
          `<button class="btn btn-danger btn-sm" onclick="deleteOrder('${esc(key)}','${esc(o.nick)}')">✕ Borrar</button>`;
        return `<tr>
          <td><button class="nick-btn" onclick="showDetail('${esc(o.nick)}')">${esc(o.nick)}</button></td>
          <td><span class="badge">${o.total} 🫓</span></td>
          <td>${deleteBtn}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="3" class="empty-state">Nadie pidió todavía.</td></tr>`;

  if (!isReadonly) {
    setStatus(`<span class="dot"></span>&nbsp;En vivo · Última actualización: ${new Date().toLocaleTimeString("es-AR")}`);
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

  // Nueva sesión (link nuevo), la anterior queda en el historial
  sessionCode = genCode();
  const label = new Date().toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });

  try {
    await db.ref(`sessions/${sessionCode}`).set({ createdAt: Date.now(), label });
  } catch (err) {
    console.error("Error al crear nueva sesión:", err);
  }

  isReadonly = false;
  setLinkDisplay(sessionCode);
  updateHostUI();
  listenOrders(sessionCode);
}

// ── HISTORIAL ────────────────────────────────────────────────
async function openHistoryModal() {
  document.getElementById("historyModal").classList.add("open");
  document.getElementById("historyList").innerHTML =
    `<p class="empty-state">Cargando…</p>`;

  try {
    const snap = await db.ref("sessions").orderByChild("createdAt").get();

    if (!snap.exists()) {
      document.getElementById("historyList").innerHTML =
        `<p class="empty-state">No hay sesiones guardadas.</p>`;
      return;
    }

    // Convertir a array y ordenar de más reciente a más antiguo
    const sessions = [];
    snap.forEach(child => sessions.push({ code: child.key, ...child.val() }));
    sessions.sort((a, b) => b.createdAt - a.createdAt);

    // Obtener cantidad de pedidos por sesión
    const counts = await Promise.all(
      sessions.map(async s => {
        try {
          const o = await db.ref(`orders/${s.code}`).get();
          return o.exists() ? Object.keys(o.val()).length : 0;
        } catch {
          return 0;
        }
      })
    );

    document.getElementById("historyList").innerHTML = sessions.map((s, i) => `
      <div class="hist-item">
        <div>
          <div class="hist-date">${s.label || "Sesión sin fecha"}</div>
          <div class="hist-code">Código: ${s.code}</div>
          <div class="hist-count">${counts[i]} persona${counts[i] !== 1 ? "s" : ""} pidieron</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="loadHistorySession('${s.code}')">Ver →</button>
      </div>`).join("");

  } catch (err) {
    console.error("Error al cargar historial:", err);
    document.getElementById("historyList").innerHTML =
      `<p class="empty-state" style="color:#c0392b">Error al cargar el historial. Revisá las reglas de Firebase.</p>`;
  }
}

async function loadHistorySession(code) {
  closeMO("historyModal");

  // Desuscribir listener en tiempo real
  if (currentListener) {
    db.ref(`orders/${currentListener}`).off();
    currentListener = null;
  }

  sessionCode = code;
  isReadonly = true;
  showView("hostView");
  updateHostUI();

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
  if (!nick) { alert("Por favor ingresá tu nickname."); return; }

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
    // Usar el nick como key → si la misma persona guarda de nuevo, pisa el pedido anterior
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

// ── ARRANQUE ─────────────────────────────────────────────────
init();
