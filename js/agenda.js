// ══════════════════════════════════════════════════════════
//  BARBI — agenda.js  (Fase 2: Agenda de turnos + Calendario)
// ══════════════════════════════════════════════════════════

import { db } from './firebase-config.js';
import {
  collection, doc, getDocs, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { clientes, turnos, disponibilidad, servicios, config, pagos } from './store.js';
import {
  uid, fmt, fmtFecha, fmtFechaHora, fmtHora,
  toast, openModal, closeModal, modalCloseBtn,
  iconEdit, iconTrash, iconPlus, iconCheck, iconWhatsapp,
  estadoBadge, ESTADO_LABELS
} from './utils.js';
import { actualizarStatsCliente } from './crm.js';
import {
  enlaceWaConfirmacion, enlaceWaRecordatorio,
  mensajeCancelacion, mensajeReagendamiento,
  enlaceWa, necesitaRecordatorio48h, necesitaRecordatorio24h
} from './whatsapp-service.js';

const NS  = 'barbi';
const col = (name) => collection(db, NS, 'data', name);
const docRef = (name, id) => doc(db, NS, 'data', name, id);

// ── Estado local ──────────────────────────────────────────
let agendaYear  = new Date().getFullYear();
let agendaMonth = new Date().getMonth();
let diaSel      = null; // fecha ISO del día seleccionado
let agendaVista = 'calendario'; // 'calendario' | 'lista' | 'disponibilidad'

const DIAS_SEMANA  = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_NOMBRE  = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MESES_NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ════════════════════════════════════════════════════════════
//  RENDER PRINCIPAL
// ════════════════════════════════════════════════════════════
export function renderAgenda() {
  _procesarPreselectores();

  const el = document.getElementById('mainContent');
  const topbar = document.getElementById('topbarActions');

  topbar.innerHTML = `
    <div style="display:flex;gap:6px">
      <button class="btn ${agendaVista==='calendario'?'btn-primary':'btn-secondary'} btn-sm" onclick="setAgendaVista('calendario')">Calendario</button>
      <button class="btn ${agendaVista==='lista'?'btn-primary':'btn-secondary'} btn-sm" onclick="setAgendaVista('lista')">Lista</button>
      <button class="btn ${agendaVista==='disponibilidad'?'btn-primary':'btn-secondary'} btn-sm" onclick="setAgendaVista('disponibilidad')">Disponibilidad</button>
      <button class="btn btn-primary btn-sm" onclick="openNuevoTurno()">
        ${iconPlus()} Nuevo turno
      </button>
    </div>`;

  if (agendaVista === 'calendario') renderCalendario(el);
  else if (agendaVista === 'lista') renderListaTurnos(el);
  else renderDisponibilidad(el);

  // Si había preselección de cliente, abre el modal
  if (window._agendaPreselectCliente) {
    const cid = window._agendaPreselectCliente;
    window._agendaPreselectCliente = null;
    openNuevoTurno(cid);
  }
  if (window._agendaEditarTurnoId) {
    const tid = window._agendaEditarTurnoId;
    window._agendaEditarTurnoId = null;
    openEditarTurnoById(tid);
  }
}

function _procesarPreselectores() {
  // noop — handled after render
}

// ════════════════════════════════════════════════════════════
//  VISTA CALENDARIO
// ════════════════════════════════════════════════════════════
function renderCalendario(el) {
  const hoy = new Date();

  // Generar días del mes
  const primerDia = new Date(agendaYear, agendaMonth, 1);
  const ultimoDia = new Date(agendaYear, agendaMonth + 1, 0);

  // Ajustar al lunes (0=Dom → convertir a Lun=0)
  let dow = primerDia.getDay(); // 0=Dom
  const offset = dow === 0 ? 6 : dow - 1;

  const celdas = [];
  // Días del mes anterior
  for (let i = offset - 1; i >= 0; i--) {
    const d = new Date(agendaYear, agendaMonth, -i);
    celdas.push({ fecha: d, otroMes: true });
  }
  // Días del mes actual
  for (let d = 1; d <= ultimoDia.getDate(); d++) {
    celdas.push({ fecha: new Date(agendaYear, agendaMonth, d), otroMes: false });
  }
  // Completar última semana
  while (celdas.length % 7 !== 0) {
    const ultimo = celdas[celdas.length - 1].fecha;
    celdas.push({ fecha: new Date(ultimo.getTime() + 86400000), otroMes: true });
  }

  const todayStr = hoy.toDateString();
  const diasConTurnos = new Map();
  turnos.forEach(t => {
    if (!t.fecha) return;
    const key = t.fecha.slice(0, 10);
    if (!diasConTurnos.has(key)) diasConTurnos.set(key, []);
    diasConTurnos.get(key).push(t);
  });

  const grid = celdas.map(({ fecha, otroMes }) => {
    const key = fecha.toISOString().slice(0, 10);
    const eHoy = fecha.toDateString() === todayStr;
    const esSel = diaSel === key;
    const turnoDia = diasConTurnos.get(key) || [];
    const count = turnoDia.length;

    const chips = turnoDia.slice(0, 2).map(t => {
      const cliente = clientes.find(c => c.id === t.clienteId);
      const nombre = cliente?.nombre?.split(' ')[0] || t.clienteNombre?.split(' ')[0] || '?';
      return `<div class="cal-turno-chip ${t.estado}" title="${nombre} - ${t.servicio}">${nombre}</div>`;
    }).join('');

    const mas = count > 2 ? `<div class="cal-mas">+${count - 2}</div>` : '';

    return `
      <div class="cal-cell ${otroMes ? 'otro-mes' : ''} ${eHoy ? 'hoy' : ''} ${esSel ? 'seleccionado' : ''}"
        data-count="${count || ''}"
        onclick="selDia('${key}')">
        <div class="cal-dia">${fecha.getDate()}</div>
        ${chips}${mas}
      </div>`;
  }).join('');

  // Turnos del día seleccionado
  const turnosDia = diaSel ? (diasConTurnos.get(diaSel) || []) : [];
  const diaLabel  = diaSel ? fmtFecha(diaSel + 'T12:00:00', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Seleccioná un día';

  // Panel recordatorios pendientes
  const pendRecordatorio = turnos.filter(t =>
    necesitaRecordatorio48h(t) || necesitaRecordatorio24h(t)
  );

  el.innerHTML = `
    ${pendRecordatorio.length > 0 ? `
    <div style="background:var(--warn-bg);border:1px solid var(--warn);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--text1)">
      <strong>⏰ ${pendRecordatorio.length} turno${pendRecordatorio.length>1?'s':''} necesitan recordatorio</strong>
      <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">
        ${pendRecordatorio.map(t => {
          const c = clientes.find(x => x.id === t.clienteId);
          return `<a class="btn-wa" href="${enlaceWaRecordatorio(t, c)}" target="_blank">
            ${iconWhatsapp()} ${c?.nombre?.split(' ')[0] || t.clienteNombre}
          </a>`;
        }).join('')}
      </div>
    </div>` : ''}

    <div class="agenda-layout">
      <div>
        <!-- Navegación -->
        <div class="cal-header">
          <button class="cal-nav-btn" onclick="navMes(-1)">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polyline points="15,18 9,12 15,6"/></svg>
          </button>
          <div class="cal-title">${MESES_NOMBRE[agendaMonth]} ${agendaYear}</div>
          <button class="cal-nav-btn" onclick="navMes(1)">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polyline points="9,18 15,12 9,6"/></svg>
          </button>
        </div>

        <!-- Grilla -->
        <div class="cal-grid" style="margin-bottom:4px">
          ${DIAS_SEMANA.map(d => `<div class="cal-day-name">${d}</div>`).join('')}
        </div>
        <div class="cal-grid">${grid}</div>
      </div>

      <!-- Panel lateral -->
      <div class="dia-panel">
        <div class="dia-panel-header">
          <span>${diaLabel}</span>
          ${diaSel ? `<button class="btn btn-primary btn-sm" onclick="openNuevoTurno(null,'${diaSel}')">
            ${iconPlus()} Turno
          </button>` : ''}
        </div>
        ${turnosDia.length === 0
          ? `<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">
               ${diaSel ? 'Sin turnos este día.' : 'Hacé clic en un día para ver los turnos.'}
             </div>`
          : turnosDia
              .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
              .map(t => turnoItem(t)).join('')}
      </div>
    </div>`;
}

function turnoItem(t) {
  const c = clientes.find(x => x.id === t.clienteId);
  const nombre = c?.nombre || t.clienteNombre || '?';
  const hora   = fmtHora(t.fecha);

  return `
    <div class="turno-item">
      <div class="turno-hora">${hora}</div>
      <div class="turno-body">
        <div class="turno-nombre">${nombre}</div>
        <div class="turno-servicio">${t.servicio} ${t.duracion ? `· ${t.duracion} min` : ''}</div>
        <div style="margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${estadoBadge(t.estado)}
          ${t.precioEstimado ? `<span style="font-size:11px;color:var(--text3)">$${fmt(t.precioEstimado)}</span>` : ''}
        </div>
      </div>
      <div class="turno-actions">
        ${c?.telefono
          ? `<a class="btn btn-ghost btn-sm" href="${enlaceWaConfirmacion(t, c)}" target="_blank" title="WhatsApp">${iconWhatsapp()}</a>`
          : ''}
        <button class="btn btn-ghost btn-sm" onclick="openEditarTurnoModal('${t.id}')" title="Editar">${iconEdit()}</button>
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
//  VISTA LISTA
// ════════════════════════════════════════════════════════════
function renderListaTurnos(el) {
  const ahora = new Date();
  const proximos = [...turnos]
    .filter(t => new Date(t.fecha) >= ahora && t.estado !== 'cancelado')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    .slice(0, 50);

  const pendientes  = proximos.filter(t => ['pendiente','no_confirmado'].includes(t.estado));
  const confirmados = proximos.filter(t => t.estado === 'confirmado');
  const otros       = proximos.filter(t => !['pendiente','no_confirmado','confirmado'].includes(t.estado));

  const renderSeccion = (titulo, lista, colorCls) => {
    if (!lista.length) return '';
    return `
      <div class="estado-panel-section">
        <div class="estado-panel-title">${titulo} (${lista.length})</div>
        <div class="card p-0">
          ${lista.map(t => {
            const c = clientes.find(x => x.id === t.clienteId);
            return `
              <div class="turno-item">
                <div class="turno-hora" style="min-width:80px;color:var(--text2)">
                  <div style="font-weight:600;font-size:12px">${fmtFecha(t.fecha, {day:'2-digit',month:'2-digit'})}</div>
                  <div style="font-size:12px">${fmtHora(t.fecha)}</div>
                </div>
                <div class="turno-body">
                  <div class="turno-nombre">${c?.nombre || t.clienteNombre || '?'}</div>
                  <div class="turno-servicio">${t.servicio}</div>
                  <div style="margin-top:3px">${estadoBadge(t.estado)}</div>
                </div>
                <div class="turno-actions">
                  ${c?.telefono
                    ? `<a class="btn btn-ghost btn-sm" href="${enlaceWaConfirmacion(t, c)}" target="_blank">${iconWhatsapp()}</a>`
                    : ''}
                  <button class="btn btn-ghost btn-sm" onclick="openEditarTurnoModal('${t.id}')">${iconEdit()}</button>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  };

  el.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--text3)">Próximos ${proximos.length} turnos</div>
    </div>
    ${renderSeccion('Sin confirmar', pendientes, 'warn')}
    ${renderSeccion('Confirmados', confirmados, 'success')}
    ${renderSeccion('Otros estados', otros, 'neutral')}
    ${proximos.length === 0
      ? `<div class="card" style="text-align:center;padding:40px;color:var(--text3)">
           No hay turnos próximos. <a href="#" onclick="openNuevoTurno();return false" style="color:var(--accent)">Agendar uno</a>
         </div>`
      : ''}`;
}

// ════════════════════════════════════════════════════════════
//  VISTA DISPONIBILIDAD
// ════════════════════════════════════════════════════════════
export function renderAgendaConfig() {
  agendaVista = 'disponibilidad';
  renderAgenda();
}

function renderDisponibilidad(el) {
  const diasDefault = DIAS_NOMBRE.map(dia => {
    const d = disponibilidad.find(x => x.diaSemana === dia);
    return d || {
      id: 'disp_' + dia,
      diaSemana: dia,
      activo: ['lunes','martes','miércoles','jueves','viernes'].includes(dia),
      bloques: [{ id: uid(), inicio: '09:00', fin: '18:00', duracionMinutos: 90 }],
      descansoEntreServicios: 15,
      noDisponible: false
    };
  });

  el.innerHTML = `
    <div style="margin-bottom:16px">
      <p class="text-sm" style="color:var(--text2)">
        Configurá los días y horarios disponibles para agendar turnos.
      </p>
    </div>

    <div class="disponibilidad-grid">
      ${diasDefault.map(d => renderDiaCfg(d)).join('')}
    </div>

    <div style="margin-top:20px">
      <button class="btn btn-primary" onclick="saveDisponibilidad()">Guardar disponibilidad</button>
    </div>`;
}

function renderDiaCfg(d) {
  const activo = d.activo && !d.noDisponible;
  return `
    <div class="disp-card" id="disp-card-${d.diaSemana}">
      <div class="disp-card-header">
        <span style="text-transform:capitalize">${d.diaSemana}</span>
        <label class="toggle-switch" title="${activo ? 'Disponible' : 'No disponible'}">
          <input type="checkbox" ${activo ? 'checked' : ''} onchange="toggleDispDia('${d.diaSemana}',this.checked)">
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
      </div>
      <div id="disp-bloques-${d.diaSemana}">
        ${activo
          ? (d.bloques || []).map((b, i) => `
              <div class="disp-bloque">
                <span>${b.inicio} – ${b.fin}</span>
                <span>${b.duracionMinutos} min/turno</span>
              </div>`).join('')
          : `<div style="padding:8px 14px;font-size:12px;color:var(--text3)">No disponible</div>`}
      </div>
      ${activo ? `
        <div style="padding:8px 14px;border-top:1px solid var(--accent2)">
          <button class="btn btn-ghost btn-sm" onclick="editarDisp('${d.diaSemana}')">
            ${iconEdit()} Editar horarios
          </button>
        </div>` : ''}
    </div>`;
}

// ════════════════════════════════════════════════════════════
//  MODAL NUEVO / EDITAR TURNO
// ════════════════════════════════════════════════════════════
window.openNuevoTurno = function (preselectClienteId = null, preselectFecha = null) {
  _abrirModalTurno(null, preselectClienteId, preselectFecha);
};

function openEditarTurnoById(id) {
  _abrirModalTurno(id);
}

window.openEditarTurnoModal = function (id) {
  _abrirModalTurno(id);
};

function _abrirModalTurno(id, preselectClienteId = null, preselectFecha = null) {
  const t = id ? turnos.find(x => x.id === id) : null;

  // Fecha/hora por defecto
  const fechaDefault = preselectFecha || t?.fecha?.slice(0, 16) || (() => {
    const d = new Date();
    d.setHours(10, 0, 0, 0);
    // Si hay día seleccionado en calendario, usar ese
    if (diaSel) {
      const [y, m, day] = diaSel.split('-');
      d.setFullYear(+y, +m - 1, +day);
    }
    return d.toISOString().slice(0, 16);
  })();

  const clienteSelected = t?.clienteId || preselectClienteId || '';

  openModal(`
    ${modalCloseBtn()}
    <div class="modal-header">
      <div class="modal-title">${t ? 'Editar turno' : 'Nuevo turno'}</div>
    </div>
    <div class="modal-body">

      <!-- Clienta -->
      <div class="form-group">
        <label class="form-label">Clienta *</label>
        <select class="form-input" id="turno-cliente" onchange="onTurnoClienteChange(this.value)">
          <option value="">Seleccionar clienta…</option>
          ${clientes
              .sort((a, b) => a.nombre.localeCompare(b.nombre))
              .map(c => `<option value="${c.id}" ${c.id === clienteSelected ? 'selected' : ''}>${c.nombre}</option>`)
              .join('')}
          <option value="__nueva__">+ Nueva clienta…</option>
        </select>
      </div>

      <!-- Info clienta -->
      <div id="turno-cliente-info"></div>

      <!-- Servicio -->
      <div class="form-group">
        <label class="form-label">Servicio *</label>
        <select class="form-input" id="turno-servicio" onchange="onTurnoServicioChange(this.value)">
          <option value="">Seleccionar servicio…</option>
          ${servicios.map(s => `<option value="${s.id}" ${t?.servicioId === s.id ? 'selected' : ''}>${s.nombre}</option>`).join('')}
          <option value="__otro__">Otro (escribir)</option>
        </select>
        <input class="form-input" type="text" id="turno-servicio-custom"
          placeholder="Nombre del servicio" value="${t?.servicioId ? '' : (t?.servicio || '')}"
          style="${(t?.servicioId || !t?.servicio) ? 'display:none' : ''};margin-top:6px">
      </div>

      <!-- Fecha / hora / duración -->
      <div style="display:grid;grid-template-columns:1fr 120px;gap:12px">
        <div class="form-group">
          <label class="form-label">Fecha y hora *</label>
          <input class="form-input" type="datetime-local" id="turno-fecha" value="${fechaDefault}">
        </div>
        <div class="form-group">
          <label class="form-label">Duración (min)</label>
          <input class="form-input" type="number" id="turno-duracion" value="${t?.duracion || 90}" min="15" step="15">
        </div>
      </div>

      <!-- Precio -->
      <div class="form-group">
        <label class="form-label">Precio estimado</label>
        <input class="form-input" type="number" id="turno-precio" value="${t?.precioEstimado || ''}" placeholder="Auto desde servicio">
      </div>

      <!-- Estado -->
      ${t ? `
        <div class="form-group">
          <label class="form-label">Estado</label>
          <select class="form-input" id="turno-estado">
            ${Object.entries(ESTADO_LABELS).map(([k, v]) =>
              `<option value="${k}" ${t.estado === k ? 'selected' : ''}>${v.label}</option>`
            ).join('')}
          </select>
        </div>` : ''}

      <!-- Notas -->
      <div class="form-group">
        <label class="form-label">Notas</label>
        <input class="form-input" type="text" id="turno-notas" value="${t?.notas || ''}" placeholder="Observaciones del turno">
      </div>

      <!-- Preview mensaje WA -->
      <div id="turno-wa-preview"></div>

    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      ${t ? `
        <button class="btn btn-ghost" style="color:var(--danger)" onclick="cancelarTurnoConfirm('${t.id}')">Cancelar turno</button>
        ${t.estado !== 'completado' ? `<button class="btn btn-success" onclick="completarTurno('${t.id}')">Marcar completado</button>` : ''}
      ` : ''}
      <button class="btn btn-primary" onclick="saveTurno('${id || ''}')">
        ${t ? 'Guardar' : 'Agendar turno'}
      </button>
    </div>`, true);

  // Inicializar info clienta y preview
  if (clienteSelected) onTurnoClienteChange(clienteSelected);
  if (t?.servicioId) onTurnoServicioChange(t.servicioId);
  _updateWaPreview();
}

window.onTurnoClienteChange = function (val) {
  if (val === '__nueva__') {
    closeModal();
    window.openNuevoCliente();
    return;
  }
  const el = document.getElementById('turno-cliente-info');
  if (!el) return;
  const c = clientes.find(x => x.id === val);
  if (c) {
    const seg = window._utils?.segmentoCliente?.(c);
    el.innerHTML = `
      <div style="background:var(--hover);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:12px;color:var(--text2)">
        ${c.telefono || '—'}
        ${c.alergias ? ` · <span style="color:var(--warn)">Alergias: ${c.alergias}</span>` : ''}
        ${c.notas ? ` · ${c.notas}` : ''}
      </div>`;
  } else {
    el.innerHTML = '';
  }
  _updateWaPreview();
};

window.onTurnoServicioChange = function (val) {
  const custom = document.getElementById('turno-servicio-custom');
  if (!custom) return;
  if (val === '__otro__') {
    custom.style.display = 'block';
    custom.value = '';
    document.getElementById('turno-precio').value = '';
  } else if (val) {
    custom.style.display = 'none';
    const s = servicios.find(x => x.id === val);
    if (s) {
      // Auto-rellenar precio y duración
      const precioInput = document.getElementById('turno-precio');
      if (precioInput && !precioInput.value) {
        const precio = s.precioCustom > 0 ? s.precioCustom : null;
        if (precio) precioInput.value = precio;
      }
      const durInput = document.getElementById('turno-duracion');
      if (durInput && s.tiempo) durInput.value = s.tiempo;
    }
  } else {
    custom.style.display = 'none';
  }
  _updateWaPreview();
};

function _updateWaPreview() {
  const el = document.getElementById('turno-wa-preview');
  if (!el) return;

  const cid = document.getElementById('turno-cliente')?.value;
  const fecha = document.getElementById('turno-fecha')?.value;
  const svId  = document.getElementById('turno-servicio')?.value;
  const svCustom = document.getElementById('turno-servicio-custom')?.value;
  const precio = document.getElementById('turno-precio')?.value;

  if (!cid || !fecha || cid === '__nueva__') { el.innerHTML = ''; return; }

  const c   = clientes.find(x => x.id === cid);
  const s   = servicios.find(x => x.id === svId);
  const svcNombre = s?.nombre || svCustom || '';

  if (!svcNombre || !c?.telefono) { el.innerHTML = ''; return; }

  const turnoTemp = {
    fecha: new Date(fecha).toISOString(),
    servicio: svcNombre,
    precioEstimado: parseFloat(precio) || 0,
    duracion: parseInt(document.getElementById('turno-duracion')?.value) || 90
  };

  const link = enlaceWaConfirmacion(turnoTemp, c);

  el.innerHTML = `
    <div style="background:var(--hover);border-radius:var(--radius-sm);padding:10px 12px;border-left:3px solid #25d366">
      <div style="font-size:11px;font-weight:600;color:var(--text3);margin-bottom:6px">ENLACE WA LISTO PARA ENVIAR</div>
      <a class="btn-wa" href="${link}" target="_blank">
        ${iconWhatsapp()} Enviar confirmación a ${c.nombre.split(' ')[0]}
      </a>
    </div>`;
}

window.saveTurno = async function (id) {
  const cid   = document.getElementById('turno-cliente').value;
  const svId  = document.getElementById('turno-servicio').value;
  const svCustom = document.getElementById('turno-servicio-custom').value.trim();
  const fecha = document.getElementById('turno-fecha').value;

  if (!cid || cid === '__nueva__') { toast('Seleccioná una clienta', 'error'); return; }
  if (!fecha)  { toast('La fecha es obligatoria', 'error'); return; }

  const s = servicios.find(x => x.id === svId);
  const svcNombre = s?.nombre || (svId === '__otro__' ? svCustom : '') || svCustom;
  if (!svcNombre) { toast('Indicá el servicio', 'error'); return; }

  const c = clientes.find(x => x.id === cid);
  const existing = id ? turnos.find(x => x.id === id) : null;
  const ahora = new Date().toISOString();

  const obj = {
    id: id || uid(),
    clienteId:      cid,
    clienteNombre:  c?.nombre || '',
    clienteTelefono:c?.telefono || '',
    servicio:       svcNombre,
    servicioId:     s?.id || '',
    fecha:          new Date(fecha).toISOString(),
    duracion:       parseInt(document.getElementById('turno-duracion').value) || 90,
    precioEstimado: parseFloat(document.getElementById('turno-precio').value) || 0,
    notas:          document.getElementById('turno-notas').value.trim(),
    estado:         document.getElementById('turno-estado')?.value || 'pendiente',
    manychatOrigin: existing?.manychatOrigin || false,
    confirmacion: existing?.confirmacion || {
      enviado: false,
      recordatorio1Enviado: false,
      recordatorio2Enviado: false
    },
    fechaCreacion:  existing?.fechaCreacion || ahora,
    ultimaActualizacion: ahora,
    creadoPor: existing?.creadoPor || 'manual'
  };

  await saveDoc('turnos', obj);

  if (id) {
    const idx = turnos.findIndex(x => x.id === id);
    if (idx >= 0) turnos[idx] = obj; else turnos.push(obj);
  } else {
    turnos.push(obj);
  }

  closeModal();
  toast(id ? 'Turno actualizado' : 'Turno agendado');
  renderAgenda();
};

// ── Completar turno → crea pago automático ────────────────
window.completarTurno = async function (id) {
  const t = turnos.find(x => x.id === id);
  if (!t) return;

  // Actualizar estado
  const updated = { ...t, estado: 'completado', ultimaActualizacion: new Date().toISOString() };
  await saveDoc('turnos', updated);
  const idx = turnos.findIndex(x => x.id === id);
  if (idx >= 0) turnos[idx] = updated;

  // Actualizar stats de clienta
  await actualizarStatsCliente(t.clienteId);

  // Crear pago automático en Caja si tiene precio
  if (t.precioEstimado > 0 && typeof window._crearPagoDesdeAgenda === 'function') {
    await window._crearPagoDesdeAgenda(t);
  }

  closeModal();
  toast('Turno marcado como completado');
  renderAgenda();
};

// ── Cancelar turno ────────────────────────────────────────
window.cancelarTurnoConfirm = function (id) {
  const t = turnos.find(x => x.id === id);
  if (!t) return;
  const c = clientes.find(x => x.id === t.clienteId);

  openModal(`
    ${modalCloseBtn()}
    <div class="modal-header"><div class="modal-title">Cancelar turno</div></div>
    <div class="modal-body">
      <p>¿Cancelar el turno de <strong>${c?.nombre || t.clienteNombre}</strong>?</p>
      <div class="form-group mt-3">
        <label class="form-label">Motivo (opcional)</label>
        <input class="form-input" type="text" id="cancel-razon" placeholder="Emergencia, reprogramación…">
      </div>
      ${c?.telefono ? `
        <div style="margin-top:12px">
          <div class="form-label" style="margin-bottom:6px">Notificar a clienta:</div>
          <a class="btn-wa" href="${enlaceWa(c.telefono, mensajeCancelacion(t, c))}" target="_blank">
            ${iconWhatsapp()} Enviar mensaje de cancelación
          </a>
        </div>` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Volver</button>
      <button class="btn btn-danger" onclick="ejecutarCancelarTurno('${id}')">Confirmar cancelación</button>
    </div>`);
};

window.ejecutarCancelarTurno = async function (id) {
  const t = turnos.find(x => x.id === id);
  if (!t) return;
  const razon = document.getElementById('cancel-razon')?.value.trim() || '';

  const updated = {
    ...t,
    estado: 'cancelado',
    cancelacion: { razon, fecha: new Date().toISOString() },
    ultimaActualizacion: new Date().toISOString()
  };
  await saveDoc('turnos', updated);
  const idx = turnos.findIndex(x => x.id === id);
  if (idx >= 0) turnos[idx] = updated;

  closeModal();
  toast('Turno cancelado');
  renderAgenda();
};

// ── Confirmar turno manualmente ───────────────────────────
window.confirmarTurnoManual = async function (id) {
  const t = turnos.find(x => x.id === id);
  if (!t) return;
  const updated = {
    ...t,
    estado: 'confirmado',
    confirmacion: { ...t.confirmacion, confirmadoPor: 'manual', fechaConfirmacion: new Date().toISOString() },
    ultimaActualizacion: new Date().toISOString()
  };
  await saveDoc('turnos', updated);
  const idx = turnos.findIndex(x => x.id === id);
  if (idx >= 0) turnos[idx] = updated;
  toast('Turno confirmado');
  renderAgenda();
};

// ── Disponibilidad ────────────────────────────────────────
window.toggleDispDia = function (dia, activo) {
  const d = disponibilidad.find(x => x.diaSemana === dia);
  if (d) d.activo = activo; else {
    disponibilidad.push({
      id: 'disp_' + dia, diaSemana: dia, activo,
      bloques: [{ id: uid(), inicio: '09:00', fin: '18:00', duracionMinutos: 90 }],
      descansoEntreServicios: 15, noDisponible: false
    });
  }
  renderAgenda();
};

window.editarDisp = function (dia) {
  const d = disponibilidad.find(x => x.diaSemana === dia) || {
    id: 'disp_' + dia, diaSemana: dia, activo: true,
    bloques: [{ id: uid(), inicio: '09:00', fin: '18:00', duracionMinutos: 90 }],
    descansoEntreServicios: 15, noDisponible: false
  };

  openModal(`
    ${modalCloseBtn()}
    <div class="modal-header">
      <div class="modal-title" style="text-transform:capitalize">Horarios — ${dia}</div>
    </div>
    <div class="modal-body">
      <div id="disp-bloques-edit">
        ${d.bloques.map((b, i) => bloqueCfgRow(b, i)).join('')}
      </div>
      <button class="btn btn-ghost btn-sm mt-2" onclick="addBloqueDisp()">
        ${iconPlus()} Agregar bloque horario
      </button>
      <div class="form-group mt-3">
        <label class="form-label">Descanso entre servicios (min)</label>
        <input class="form-input" type="number" id="disp-descanso" value="${d.descansoEntreServicios || 15}" min="0" step="5" style="max-width:100px">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveDispDia('${dia}')">Guardar</button>
    </div>`);

  window._dispBloques = d.bloques.map(b => ({ ...b }));
};

function bloqueCfgRow(b, i) {
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px" id="bloque-row-${i}">
      <input class="form-input" type="time" value="${b.inicio}" style="width:100px"
        onchange="window._dispBloques[${i}].inicio=this.value">
      <span style="color:var(--text3)">→</span>
      <input class="form-input" type="time" value="${b.fin}" style="width:100px"
        onchange="window._dispBloques[${i}].fin=this.value">
      <select class="form-input" style="width:120px" onchange="window._dispBloques[${i}].duracionMinutos=+this.value">
        ${[30,45,60,75,90,105,120,150,180].map(m =>
          `<option value="${m}" ${b.duracionMinutos===m?'selected':''}>${m} min/turno</option>`
        ).join('')}
      </select>
      <button class="btn btn-ghost btn-sm" onclick="removeBloqueDisp(${i})">${iconTrash()}</button>
    </div>`;
}

window.addBloqueDisp = function () {
  window._dispBloques = window._dispBloques || [];
  window._dispBloques.push({ id: uid(), inicio: '09:00', fin: '18:00', duracionMinutos: 90 });
  const cont = document.getElementById('disp-bloques-edit');
  if (cont) {
    const i = window._dispBloques.length - 1;
    cont.insertAdjacentHTML('beforeend', bloqueCfgRow(window._dispBloques[i], i));
  }
};

window.removeBloqueDisp = function (i) {
  window._dispBloques.splice(i, 1);
  const cont = document.getElementById('disp-bloques-edit');
  if (cont) cont.innerHTML = window._dispBloques.map((b, j) => bloqueCfgRow(b, j)).join('');
};

window.saveDispDia = async function (dia) {
  const descanso = parseInt(document.getElementById('disp-descanso')?.value) || 15;
  const obj = {
    id: 'disp_' + dia,
    diaSemana: dia,
    activo: true,
    bloques: (window._dispBloques || []).map(b => ({ ...b, id: b.id || uid() })),
    descansoEntreServicios: descanso,
    noDisponible: false,
    ultimaActualizacion: new Date().toISOString()
  };
  await saveDoc('disponibilidad', obj);
  const idx = disponibilidad.findIndex(x => x.diaSemana === dia);
  if (idx >= 0) disponibilidad[idx] = obj; else disponibilidad.push(obj);
  closeModal();
  toast('Disponibilidad guardada');
  renderAgenda();
};

window.saveDisponibilidad = async function () {
  toast('Disponibilidad guardada');
  renderAgenda();
};

// ── Navegación calendario ─────────────────────────────────
window.navMes = function (delta) {
  agendaMonth += delta;
  if (agendaMonth < 0)  { agendaMonth = 11; agendaYear--; }
  if (agendaMonth > 11) { agendaMonth = 0;  agendaYear++; }
  renderAgenda();
};

window.selDia = function (isoDate) {
  diaSel = isoDate;
  renderAgenda();
};

window.setAgendaVista = function (vista) {
  agendaVista = vista;
  renderAgenda();
};

// ── Helper interno ────────────────────────────────────────
async function saveDoc(colName, obj) {
  await setDoc(docRef(colName, obj.id), obj);
}

// ── Exponer _updateWaPreview para llamadas inline ─────────
window._agendaUpdateWaPreview = _updateWaPreview;
