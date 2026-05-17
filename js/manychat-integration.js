// ══════════════════════════════════════════════════════════
//  BARBI — manychat-integration.js  (Fase 4)
//  UI de configuración + documentación del webhook
// ══════════════════════════════════════════════════════════

import { config, clientes, turnos, disponibilidad, servicios } from './store.js';
import {
  uid, fmt, fmtFechaHora,
  toast, openModal, closeModal, modalCloseBtn, iconPlus
} from './utils.js';

// ════════════════════════════════════════════════════════════
//  RENDER PÁGINA DE CONFIGURACIÓN MANYCHAT
// ════════════════════════════════════════════════════════════
export function renderManychat() {
  const el = document.getElementById('mainContent');
  document.getElementById('topbarActions').innerHTML = '';

  const connected = !!(config.manychatToken && config.manychatPageId);
  const webhookUrl = _getWebhookUrl();

  el.innerHTML = `
    <!-- Estado de conexión -->
    <div class="card mb-4">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div class="section-title">Integración ManyChat</div>
          <div class="text-sm" style="color:var(--text2);margin-top:4px">
            Conectá tu bot de Instagram / WhatsApp para agendar turnos automáticamente.
          </div>
        </div>
        <span class="mc-status-chip ${connected ? 'connected' : 'disconnected'}">
          ${connected ? '● Conectado' : '○ Sin configurar'}
        </span>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="responsive-cols">

      <!-- Columna izquierda: configuración -->
      <div>
        <div class="card mb-4">
          <div class="section-title mb-3">Configuración de API</div>

          <div class="form-group">
            <label class="form-label">API Token de ManyChat</label>
            <input class="form-input" type="password" id="mc-token"
              value="${config.manychatToken || ''}"
              placeholder="mc-XXXXXXXXXXXXXXXXXXXXXXXX">
            <div class="form-hint">Encontralo en ManyChat → Settings → API</div>
          </div>

          <div class="form-group">
            <label class="form-label">Page / Bot ID</label>
            <input class="form-input" type="text" id="mc-page-id"
              value="${config.manychatPageId || ''}"
              placeholder="123456789">
          </div>

          <div class="form-group">
            <label class="form-label">Teléfono de WhatsApp de Barbi</label>
            <input class="form-input" type="tel" id="mc-tel-barbi"
              value="${config.telefonoBarbi || ''}"
              placeholder="+5491123456789">
            <div class="form-hint">Se usa para generar enlaces wa.me salientes</div>
          </div>

          <button class="btn btn-primary" onclick="saveMCConfig()">Guardar configuración</button>
        </div>

        <!-- Webhook URL -->
        <div class="card mb-4">
          <div class="section-title mb-2">URL del Webhook</div>
          <p class="text-sm" style="color:var(--text2);margin-bottom:10px">
            Pegá esta URL en ManyChat → Flows → External Request para que los turnos lleguen automáticamente.
          </p>
          <div style="display:flex;gap:8px;align-items:center">
            <input class="form-input" type="text" id="mc-webhook-url"
              value="${webhookUrl}" readonly
              style="font-size:12px;font-family:monospace;background:var(--hover)">
            <button class="btn btn-secondary btn-sm" onclick="copiarWebhook()">Copiar</button>
          </div>
          ${!webhookUrl
            ? `<div style="margin-top:8px;font-size:12px;color:var(--warn)">
                 Deploiá las Firebase Cloud Functions primero. Ver instrucciones abajo.
               </div>`
            : ''}
        </div>

        <!-- Flujos activos -->
        <div class="card">
          <div class="section-title mb-3">Flujos configurados</div>
          <div class="mc-flow-row">
            <div>
              <div style="font-weight:500;font-size:13px">Nuevo turno desde Instagram/WhatsApp</div>
              <div style="font-size:12px;color:var(--text3)">POST /webhook/nuevo-turno</div>
            </div>
            <span class="badge badge-success">Activo</span>
          </div>
          <div class="mc-flow-row">
            <div>
              <div style="font-weight:500;font-size:13px">Cancelación de turno</div>
              <div style="font-size:12px;color:var(--text3)">POST /webhook/cancelar-turno</div>
            </div>
            <span class="badge badge-success">Activo</span>
          </div>
          <div class="mc-flow-row">
            <div>
              <div style="font-weight:500;font-size:13px">Reagendamiento</div>
              <div style="font-size:12px;color:var(--text3)">POST /webhook/reagendar-turno</div>
            </div>
            <span class="badge badge-success">Activo</span>
          </div>
          <div class="mc-flow-row">
            <div>
              <div style="font-weight:500;font-size:13px">Confirmación de turno</div>
              <div style="font-size:12px;color:var(--text3)">POST /webhook/confirmar-turno</div>
            </div>
            <span class="badge badge-success">Activo</span>
          </div>
        </div>
      </div>

      <!-- Columna derecha: instrucciones -->
      <div>
        <div class="card mb-4">
          <div class="section-title mb-3">Cómo configurar ManyChat</div>
          <ol style="font-size:13px;color:var(--text2);line-height:2;padding-left:18px">
            <li>Instalar Firebase CLI: <code style="background:var(--hover);padding:1px 5px;border-radius:3px">npm install -g firebase-tools</code></li>
            <li>En la carpeta <code style="background:var(--hover);padding:1px 5px;border-radius:3px">functions/</code>: <code style="background:var(--hover);padding:1px 5px;border-radius:3px">npm install</code></li>
            <li>Deploy: <code style="background:var(--hover);padding:1px 5px;border-radius:3px">firebase deploy --only functions</code></li>
            <li>Copiar la URL del webhook generada arriba</li>
            <li>En ManyChat → Flows → Automation → crear un External Request apuntando a la URL</li>
            <li>Mapear los campos: <code>clienteNombre</code>, <code>clienteTelefono</code>, <code>servicio</code>, <code>fechaPreferida</code></li>
          </ol>
        </div>

        <!-- Payload de ejemplo -->
        <div class="card mb-4">
          <div class="section-title mb-2">Payload esperado (ManyChat → Barbi)</div>
          <pre style="background:var(--hover);padding:12px;border-radius:var(--radius-sm);font-size:11px;overflow-x:auto;color:var(--text1);line-height:1.6">${JSON.stringify({
  type: "new_booking",
  manychatUserId: "mc_user_123",
  clienteNombre: "María García",
  clienteTelefono: "+5491123456789",
  servicio: "Soft Gel",
  fechaPreferida: "2025-05-24",
  horarioPreferido: "15:00-17:00",
  origen: "instagram"
}, null, 2)}</pre>
        </div>

        <!-- Estadísticas ManyChat -->
        ${renderMCStats()}
      </div>
    </div>`;
}

function renderMCStats() {
  const turnosMC = turnos.filter(t => t.manychatOrigin);
  const turnosManuales = turnos.filter(t => !t.manychatOrigin);

  if (turnos.length === 0) return '';

  const pctMC = Math.round((turnosMC.length / turnos.length) * 100);

  return `
    <div class="card">
      <div class="section-title mb-3">Estadísticas de origen</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="stat-box">
          <div class="stat-box-num">${turnosMC.length}</div>
          <div class="stat-box-label">Via ManyChat</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-num">${turnosManuales.length}</div>
          <div class="stat-box-label">Manuales</div>
        </div>
      </div>
      <div style="margin-top:12px">
        <div style="font-size:12px;color:var(--text3);margin-bottom:4px">${pctMC}% automatizados</div>
        <div style="height:6px;background:var(--accent2);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pctMC}%;background:var(--accent);border-radius:3px"></div>
        </div>
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
//  RECEPCIÓN DE WEBHOOK (cliente-side simulation)
//  El webhook real corre en Firebase Cloud Functions.
//  Estas funciones procesan los datos ya validados.
// ════════════════════════════════════════════════════════════

export async function procesarWebhookNuevoTurno(payload) {
  const { clienteNombre, clienteTelefono, servicio, fechaPreferida, manychatUserId, origen } = payload;

  // Buscar o crear cliente
  let cliente = clientes.find(c =>
    c.telefono === clienteTelefono ||
    c.nombre?.toLowerCase() === clienteNombre?.toLowerCase()
  );

  if (!cliente) {
    const { db: _db } = await import('./firebase-config.js');
    const { doc: _doc, setDoc: _setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

    cliente = {
      id: uid(),
      nombre: clienteNombre,
      telefono: clienteTelefono,
      email: '',
      totalGastado: 0,
      estadisticas: { totalTurnos: 0, ticketPromedio: 0 },
      origenAgendamiento: origen || 'manychat',
      manychatId: manychatUserId || '',
      fechaCreacion: new Date().toISOString(),
      ultimaActualizacion: new Date().toISOString()
    };
    clientes.push(cliente);
    // saveDoc delegado a app.js
    if (typeof window._saveDoc === 'function') await window._saveDoc('clientes', cliente);
  }

  // Buscar slots disponibles cerca de fechaPreferida
  const slots = _buscarSlotsDisponibles(fechaPreferida, 5);

  return { cliente, slots, servicio };
}

function _buscarSlotsDisponibles(fechaPreferida, cantDias = 5) {
  const base = fechaPreferida ? new Date(fechaPreferida) : new Date();
  const slots = [];

  for (let i = 0; i < cantDias * 2 && slots.length < 3; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);

    const dowIdx = (d.getDay() + 6) % 7; // Lun=0
    const diaNombre = ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'][dowIdx];
    const dispDia = disponibilidad.find(x => x.diaSemana === diaNombre && x.activo);

    if (!dispDia || dispDia.noDisponible) continue;

    for (const bloque of (dispDia.bloques || [])) {
      const [hIni, mIni] = bloque.inicio.split(':').map(Number);
      let t = new Date(d);
      t.setHours(hIni, mIni, 0, 0);

      const [hFin, mFin] = bloque.fin.split(':').map(Number);
      const finBloque = new Date(d);
      finBloque.setHours(hFin, mFin, 0, 0);

      while (t < finBloque && slots.length < 3) {
        const tStr = t.toISOString();
        // Verificar que no haya turno ya
        const ocupado = turnos.some(turno =>
          turno.estado !== 'cancelado' &&
          Math.abs(new Date(turno.fecha) - t) < (bloque.duracionMinutos + (dispDia.descansoEntreServicios || 15)) * 60000
        );
        if (!ocupado) slots.push(tStr);
        t = new Date(t.getTime() + bloque.duracionMinutos * 60000);
      }
    }
  }

  return slots;
}

// ── Window functions ──────────────────────────────────────
window.saveMCConfig = async function () {
  config.manychatToken  = document.getElementById('mc-token')?.value.trim() || '';
  config.manychatPageId = document.getElementById('mc-page-id')?.value.trim() || '';
  config.telefonoBarbi  = document.getElementById('mc-tel-barbi')?.value.trim() || '';

  if (typeof window._saveConfig === 'function') await window._saveConfig();
  toast('Configuración de ManyChat guardada');
  renderManychat();
};

window.copiarWebhook = function () {
  const url = document.getElementById('mc-webhook-url')?.value;
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => toast('URL copiada al portapapeles'));
};

function _getWebhookUrl() {
  // La URL se genera una vez desplegadas las Cloud Functions.
  // Formato: https://us-central1-{projectId}.cloudfunctions.net/manychatWebhook
  // Si está en el config, usarla; si no, mostrar placeholder.
  return config.webhookUrl || '';
}
