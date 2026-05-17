// ══════════════════════════════════════════════════════════
//  BARBI — crm.js  (Fase 1: CRM de clientas)
// ══════════════════════════════════════════════════════════

import { db } from './firebase-config.js';
import {
  collection, doc, getDocs, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { clientes, turnos, pagos, config } from './store.js';
import {
  uid, fmt, fmtFecha, fmtFechaHora, diasDesde,
  toast, openModal, closeModal, modalCloseBtn,
  iconEdit, iconTrash, iconPlus, iconWhatsapp,
  estadoBadge, segmentoCliente
} from './utils.js';
import { enlaceWaConfirmacion, mensajeReactivacion, enlaceWa } from './whatsapp-service.js';

const NS  = 'barbi';
const col = (name) => collection(db, NS, 'data', name);
const docRef = (name, id) => doc(db, NS, 'data', name, id);

// ── Estado local ──────────────────────────────────────────
let crmSearch   = '';
let crmSegmento = 'todas';
let crmVistaId  = null; // id de clienta en perfil

// ════════════════════════════════════════════════════════════
//  RENDER PRINCIPAL
// ════════════════════════════════════════════════════════════
export function renderCRM() {
  if (crmVistaId) {
    renderPerfilCliente(crmVistaId);
    return;
  }
  renderListaClientes();
}

function renderListaClientes() {
  const el = document.getElementById('mainContent');
  const topbar = document.getElementById('topbarActions');

  topbar.innerHTML = `
    <button class="btn btn-primary btn-sm" onclick="openNuevoCliente()">
      ${iconPlus()} Nueva clienta
    </button>`;

  // Filtrar
  let lista = clientes.filter(c => {
    const q = crmSearch.toLowerCase();
    const matchQ = !q || c.nombre?.toLowerCase().includes(q) || c.telefono?.includes(q);
    if (!matchQ) return false;
    if (crmSegmento === 'todas') return true;
    return segmentoCliente(c).label.toLowerCase() === crmSegmento;
  });

  lista = lista.sort((a, b) => (b.totalGastado || 0) - (a.totalGastado || 0));

  const totalClientas = clientes.length;
  const vip = clientes.filter(c => segmentoCliente(c).label === 'VIP').length;
  const dormidas = clientes.filter(c => segmentoCliente(c).label === 'Dormida').length;

  el.innerHTML = `
    <div class="page-header mb-4">
      <div class="kpi-row" style="gap:12px;display:flex;flex-wrap:wrap">
        <div class="kpi-card" style="flex:1;min-width:120px">
          <div class="kpi-label">Total clientas</div>
          <div class="kpi-value">${totalClientas}</div>
        </div>
        <div class="kpi-card" style="flex:1;min-width:120px">
          <div class="kpi-label">VIP</div>
          <div class="kpi-value">${vip}</div>
        </div>
        <div class="kpi-card" style="flex:1;min-width:120px">
          <div class="kpi-label">Dormidas (+60 días)</div>
          <div class="kpi-value">${dormidas}</div>
        </div>
      </div>
    </div>

    <div class="card p-0">
      <div style="padding:14px 16px;border-bottom:1px solid var(--accent2);display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <input class="form-input" type="search" placeholder="Buscar por nombre o teléfono…"
          id="crm-search" value="${crmSearch}"
          oninput="setCrmSearch(this.value)" style="flex:1;min-width:200px;max-width:340px">
      </div>

      <div style="padding:12px 16px 6px">
        <div class="seg-tabs">
          ${['todas','vip','frecuente','nueva','dormida'].map(s => `
            <button class="seg-tab ${crmSegmento === s ? 'active' : ''}" onclick="setCrmSegmento('${s}')">
              ${s === 'todas' ? 'Todas' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>`).join('')}
        </div>
      </div>

      ${lista.length === 0
        ? `<div style="padding:40px;text-align:center;color:var(--text3)">
             ${totalClientas === 0
               ? 'Todavía no hay clientas. <a href="#" onclick="openNuevoCliente();return false" style="color:var(--accent)">Agregar la primera</a>'
               : 'No hay clientas que coincidan con el filtro.'}
           </div>`
        : lista.map(c => clienteRow(c)).join('')
      }
    </div>`;

  // Restaurar foco en búsqueda
  const si = document.getElementById('crm-search');
  if (si && crmSearch) { si.focus(); si.setSelectionRange(crmSearch.length, crmSearch.length); }
}

function clienteRow(c) {
  const seg = segmentoCliente(c);
  const proximo = turnoProximoDeCliente(c.id);
  const ultimoFecha = c.ultimoTurnoFecha ? fmtFecha(c.ultimoTurnoFecha) : '—';
  const totalGastado = fmt(c.totalGastado || 0);

  return `
    <div class="cliente-row" onclick="verPerfilCliente('${c.id}')">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="cliente-avatar">${(c.nombre || '?').charAt(0).toUpperCase()}</div>
        <div class="cliente-info">
          <div class="cliente-nombre">${c.nombre}</div>
          <div class="cliente-sub">${c.telefono || '—'} &nbsp;·&nbsp; <span class="badge ${seg.cls}">${seg.label}</span></div>
        </div>
      </div>
      <div class="cliente-stats" style="text-align:right">
        <div class="cliente-stats-num">$${totalGastado}</div>
        <div class="cliente-stats-label">total gastado</div>
      </div>
      <div class="cliente-stats" style="text-align:right">
        <div class="cliente-stats-num">${ultimoFecha}</div>
        <div class="cliente-stats-label">último turno</div>
      </div>
      <div style="display:flex;gap:4px" onclick="event.stopPropagation()">
        <button class="btn btn-ghost btn-sm" title="Editar" onclick="openEditarCliente('${c.id}')">${iconEdit()}</button>
        ${proximo
          ? `<a class="btn-wa btn btn-sm" href="${enlaceWaConfirmacion(proximo, c)}" target="_blank" title="WhatsApp">${iconWhatsapp()}</a>`
          : `<button class="btn btn-ghost btn-sm" title="WhatsApp reactivación"
               onclick="abrirWaReactivacion('${c.id}')">${iconWhatsapp()}</button>`}
      </div>
    </div>`;
}

function turnoProximoDeCliente(clienteId) {
  const ahora = new Date();
  return turnos
    .filter(t => t.clienteId === clienteId && new Date(t.fecha) > ahora && t.estado !== 'cancelado')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))[0] || null;
}

// ════════════════════════════════════════════════════════════
//  PERFIL DE CLIENTA
// ════════════════════════════════════════════════════════════
function renderPerfilCliente(clienteId) {
  const c = clientes.find(x => x.id === clienteId);
  if (!c) { crmVistaId = null; renderListaClientes(); return; }

  const el = document.getElementById('mainContent');
  const topbar = document.getElementById('topbarActions');

  topbar.innerHTML = `
    <button class="btn btn-secondary btn-sm" onclick="volverListaClientes()">
      ← Volver
    </button>
    <button class="btn btn-primary btn-sm" onclick="openEditarCliente('${c.id}')">
      ${iconEdit()} Editar
    </button>`;

  const seg = segmentoCliente(c);
  const turnoscli = turnos
    .filter(t => t.clienteId === c.id)
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  const proximo = turnoscli.find(t => new Date(t.fecha) > new Date() && t.estado !== 'cancelado');
  const historial = turnoscli.slice(0, 10);

  const totalTurnos = c.estadisticas?.totalTurnos ?? turnoscli.length;
  const ticketProm  = totalTurnos > 0 ? Math.round((c.totalGastado || 0) / totalTurnos) : 0;

  // Frecuencia promedio (días entre turnos)
  let frecStr = '—';
  const completados = turnoscli.filter(t => t.estado === 'completado');
  if (completados.length >= 2) {
    const diffs = [];
    for (let i = 0; i < completados.length - 1; i++) {
      diffs.push((new Date(completados[i].fecha) - new Date(completados[i + 1].fecha)) / 86400000);
    }
    const prom = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
    frecStr = `Cada ${prom} días`;
  }

  const servicioFav = (() => {
    const cnt = {};
    completados.forEach(t => { cnt[t.servicio] = (cnt[t.servicio] || 0) + 1; });
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : '—';
  })();

  const diasSinVenir = diasDesde(c.ultimoTurnoFecha);
  const alertaDormida = diasSinVenir > 60 && !proximo;

  el.innerHTML = `
    <div class="perfil-header">
      <div class="perfil-avatar">${(c.nombre || '?').charAt(0).toUpperCase()}</div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div class="perfil-nombre">${c.nombre}</div>
          <span class="badge ${seg.cls}">${seg.label}</span>
        </div>
        <div class="perfil-tel">${c.telefono || '—'}${c.email ? ' · ' + c.email : ''}</div>
        ${alertaDormida
          ? `<div style="margin-top:6px;font-size:12px;color:var(--warn)">
               Hace ${diasSinVenir} días sin turno.
               <a href="#" onclick="abrirWaReactivacion('${c.id}');return false"
                 style="color:var(--accent)">Enviar mensaje de reactivación</a>
             </div>`
          : ''}
      </div>
      <div style="flex-shrink:0">
        ${c.telefono
          ? `<a class="btn-wa" href="${enlaceWa(c.telefono, 'Hola ' + c.nombre.split(' ')[0] + '! 💅')}" target="_blank">
               ${iconWhatsapp()} WhatsApp
             </a>`
          : ''}
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-box">
        <div class="stat-box-num">$${fmt(c.totalGastado || 0)}</div>
        <div class="stat-box-label">Total gastado</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-num">${totalTurnos}</div>
        <div class="stat-box-label">Turnos realizados</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-num">$${fmt(ticketProm)}</div>
        <div class="stat-box-label">Ticket promedio</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-num">${frecStr}</div>
        <div class="stat-box-label">Frecuencia</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px" class="responsive-cols">
      <!-- Próximo turno -->
      <div class="card">
        <div class="section-title mb-3">Próximo turno</div>
        ${proximo
          ? `<div style="font-size:14px;font-weight:600;color:var(--text1)">${fmtFechaHora(proximo.fecha)}</div>
             <div style="font-size:13px;color:var(--text2);margin-top:4px">${proximo.servicio}</div>
             <div style="margin-top:8px">${estadoBadge(proximo.estado)}</div>
             <div style="margin-top:10px;display:flex;gap:6px">
               <a class="btn-wa" href="${enlaceWaConfirmacion(proximo, c)}" target="_blank">
                 ${iconWhatsapp()} Confirmar
               </a>
               <button class="btn btn-ghost btn-sm" onclick="abrirEditarTurno('${proximo.id}')">
                 ${iconEdit()} Editar
               </button>
             </div>`
          : `<div style="color:var(--text3);font-size:13px">Sin turnos próximos.
               <a href="#" onclick="abrirNuevoTurnoParaCliente('${c.id}');return false"
                 style="color:var(--accent)">Agendar ahora</a>
             </div>`}
      </div>

      <!-- Info de perfil -->
      <div class="card">
        <div class="section-title mb-3">Perfil</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.7">
          <div><strong>Servicio favorito:</strong> ${servicioFav}</div>
          ${c.alergias ? `<div><strong>Alergias:</strong> ${c.alergias}</div>` : ''}
          ${c.preferencias ? `<div><strong>Preferencias:</strong> ${c.preferencias}</div>` : ''}
          ${c.notas ? `<div><strong>Notas:</strong> ${c.notas}</div>` : ''}
          ${c.fechaNacimiento ? `<div><strong>Nacimiento:</strong> ${fmtFecha(c.fechaNacimiento)}</div>` : ''}
          <div><strong>Cliente desde:</strong> ${fmtFecha(c.fechaCreacion)}</div>
          ${c.origenAgendamiento ? `<div><strong>Origen:</strong> ${c.origenAgendamiento}</div>` : ''}
        </div>
      </div>
    </div>

    <!-- Historial de turnos -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div class="section-title">Historial de turnos</div>
        <button class="btn btn-primary btn-sm" onclick="abrirNuevoTurnoParaCliente('${c.id}')">
          ${iconPlus()} Nuevo turno
        </button>
      </div>
      ${historial.length === 0
        ? `<p class="text-sm" style="color:var(--text3)">Sin turnos registrados aún.</p>`
        : historial.map(t => `
          <div class="historial-row">
            <div>
              <div style="font-weight:500;font-size:13px">${fmtFechaHora(t.fecha)}</div>
              <div style="font-size:12px;color:var(--text2)">${t.servicio}</div>
            </div>
            <div style="text-align:right">
              ${t.precioEstimado ? `<div style="font-size:13px;font-weight:600">$${fmt(t.precioEstimado)}</div>` : ''}
              ${estadoBadge(t.estado)}
            </div>
          </div>`).join('')}
    </div>

    <!-- Analytics últimos 6 meses -->
    ${renderAnalytics6Meses(c)}

    <!-- Zona de peligro -->
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--accent2);display:flex;gap:8px">
      <button class="btn btn-ghost btn-sm" onclick="exportarCSVCliente('${c.id}')">
        Exportar historial CSV
      </button>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger)"
        onclick="confirmarEliminarCliente('${c.id}')">
        ${iconTrash()} Eliminar clienta
      </button>
    </div>`;
}

function renderAnalytics6Meses(c) {
  const hoy = new Date();
  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    const turnosMes = turnos.filter(t =>
      t.clienteId === c.id &&
      t.fecha?.slice(0, 7) === key &&
      t.estado === 'completado'
    );
    const ingresosMes = turnosMes.reduce((a, t) => a + (t.precioEstimado || 0), 0);
    meses.push({ key, label: d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' }), turnos: turnosMes.length, ingresos: ingresosMes });
  }
  const maxIng = Math.max(...meses.map(m => m.ingresos), 1);

  return `
    <div class="card mt-3">
      <div class="section-title mb-3">Últimos 6 meses</div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;align-items:end;height:80px;margin-bottom:8px">
        ${meses.map(m => `
          <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
            <div style="font-size:10px;color:var(--accent);font-weight:600">${m.ingresos > 0 ? '$' + fmt(m.ingresos) : ''}</div>
            <div style="width:100%;background:var(--accent);border-radius:3px 3px 0 0;opacity:.85;height:${Math.round((m.ingresos / maxIng) * 56) || 2}px"></div>
          </div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px">
        ${meses.map(m => `<div style="text-align:center;font-size:10px;color:var(--text3)">${m.label}</div>`).join('')}
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
//  CRUD — Modal nueva/editar clienta
// ════════════════════════════════════════════════════════════
window.openNuevoCliente = function () {
  _abrirModalCliente(null);
};

window.openEditarCliente = function (id) {
  _abrirModalCliente(id);
};

function _abrirModalCliente(id) {
  const c = id ? clientes.find(x => x.id === id) : null;

  openModal(`
    ${modalCloseBtn()}
    <div class="modal-header">
      <div class="modal-title">${c ? 'Editar clienta' : 'Nueva clienta'}</div>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Nombre completo *</label>
        <input class="form-input" type="text" id="cli-nombre" placeholder="María García" value="${c?.nombre || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Teléfono (WhatsApp) *</label>
        <input class="form-input" type="tel" id="cli-telefono" placeholder="+5491123456789" value="${c?.telefono || ''}">
        <div class="form-hint">Incluir código de país (ej: +54911…)</div>
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" type="email" id="cli-email" placeholder="maria@email.com" value="${c?.email || ''}">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label">Fecha de nacimiento</label>
          <input class="form-input" type="date" id="cli-nacimiento" value="${c?.fechaNacimiento || ''}">
        </div>
        <div class="form-group" style="opacity:0"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Alergias / contraindicaciones</label>
        <input class="form-input" type="text" id="cli-alergias" placeholder="Ej: níquel, acrílico" value="${c?.alergias || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Preferencias de estilo</label>
        <input class="form-input" type="text" id="cli-preferencias" placeholder="Ej: tonos neutros, no brillantes" value="${c?.preferencias || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Notas internas</label>
        <textarea class="form-input" id="cli-notas" rows="2" placeholder="Observaciones para Barbi…">${c?.notas || ''}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveCliente('${id || ''}')">
        ${c ? 'Guardar cambios' : 'Crear clienta'}
      </button>
    </div>`, true);
}

window.saveCliente = async function (id) {
  const nombre = document.getElementById('cli-nombre').value.trim();
  const telefono = document.getElementById('cli-telefono').value.trim();
  if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
  if (!telefono) { toast('El teléfono es obligatorio', 'error'); return; }

  const existing = id ? clientes.find(x => x.id === id) : null;
  const ahora = new Date().toISOString();

  const obj = {
    id: id || uid(),
    nombre,
    telefono,
    email:          document.getElementById('cli-email').value.trim(),
    fechaNacimiento:document.getElementById('cli-nacimiento').value,
    alergias:       document.getElementById('cli-alergias').value.trim(),
    preferencias:   document.getElementById('cli-preferencias').value.trim(),
    notas:          document.getElementById('cli-notas').value.trim(),
    totalGastado:   existing?.totalGastado || 0,
    ultimoTurnoFecha: existing?.ultimoTurnoFecha || null,
    estadisticas:   existing?.estadisticas || { totalTurnos: 0, ticketPromedio: 0 },
    origenAgendamiento: existing?.origenAgendamiento || 'manual',
    fechaCreacion:  existing?.fechaCreacion || ahora,
    ultimaActualizacion: ahora
  };

  await saveDoc('clientes', obj);

  if (id) {
    const idx = clientes.findIndex(x => x.id === id);
    if (idx >= 0) clientes[idx] = obj; else clientes.push(obj);
  } else {
    clientes.push(obj);
  }

  closeModal();
  toast(id ? 'Clienta actualizada' : 'Clienta creada');

  if (id && crmVistaId === id) renderPerfilCliente(id);
  else renderListaClientes();
};

window.confirmarEliminarCliente = function (id) {
  const c = clientes.find(x => x.id === id);
  if (!c) return;
  openModal(`
    ${modalCloseBtn()}
    <div class="modal-header"><div class="modal-title">Eliminar clienta</div></div>
    <div class="modal-body">
      <p>¿Eliminar a <strong>${c.nombre}</strong>? Esta acción no se puede deshacer.</p>
      <p class="text-sm" style="color:var(--text3);margin-top:8px">
        Sus turnos históricos se mantienen en la base de datos.
      </p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger" onclick="deleteCliente('${id}')">Eliminar</button>
    </div>`);
};

window.deleteCliente = async function (id) {
  await deleteDoc(docRef('clientes', id));
  const idx = clientes.findIndex(x => x.id === id);
  if (idx >= 0) clientes.splice(idx, 1);
  closeModal();
  crmVistaId = null;
  toast('Clienta eliminada');
  renderListaClientes();
};

// ── Navegación interna CRM ────────────────────────────────
window.verPerfilCliente = function (id) {
  crmVistaId = id;
  renderPerfilCliente(id);
};

window.volverListaClientes = function () {
  crmVistaId = null;
  renderListaClientes();
};

window.setCrmSearch = function (v) {
  crmSearch = v;
  renderListaClientes();
  const si = document.getElementById('crm-search');
  if (si) { si.focus(); si.setSelectionRange(v.length, v.length); }
};

window.setCrmSegmento = function (v) {
  crmSegmento = v;
  renderListaClientes();
};

// ── WhatsApp reactivación ─────────────────────────────────
window.abrirWaReactivacion = function (clienteId) {
  const c = clientes.find(x => x.id === clienteId);
  if (!c?.telefono) { toast('La clienta no tiene teléfono cargado', 'error'); return; }
  const msg = mensajeReactivacion(c);
  window.open(enlaceWa(c.telefono, msg), '_blank');
};

// ── Puente: abrir nuevo turno desde perfil ────────────────
window.abrirNuevoTurnoParaCliente = function (clienteId) {
  // Delegado a agenda.js — se llama navigate('agenda') con clienteId prefijado
  window._agendaPreselectCliente = clienteId;
  window.navigate('agenda');
};

window.abrirEditarTurno = function (turnoId) {
  window._agendaEditarTurnoId = turnoId;
  window.navigate('agenda');
};

// ── Exportar CSV ──────────────────────────────────────────
window.exportarCSVCliente = function (clienteId) {
  const c = clientes.find(x => x.id === clienteId);
  if (!c) return;
  const turnosCli = turnos.filter(t => t.clienteId === clienteId);
  const rows = [
    ['Fecha', 'Servicio', 'Precio', 'Estado'].join(','),
    ...turnosCli.map(t => [
      t.fecha?.slice(0, 16) || '',
      `"${t.servicio || ''}"`,
      t.precioEstimado || '',
      t.estado || ''
    ].join(','))
  ];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `historial-${c.nombre.replace(/\s+/g, '-')}.csv`;
  a.click();
  toast('CSV exportado');
};

// ── Actualizar stats de clienta (llamado desde agenda.js) ─
export async function actualizarStatsCliente(clienteId) {
  const turnosCli = turnos.filter(t => t.clienteId === clienteId && t.estado === 'completado');
  const totalGastado = turnosCli.reduce((a, t) => a + (t.precioEstimado || 0), 0);
  const totalTurnos = turnosCli.length;
  const ticketPromedio = totalTurnos > 0 ? Math.round(totalGastado / totalTurnos) : 0;

  const svcCount = {};
  turnosCli.forEach(t => { svcCount[t.servicio] = (svcCount[t.servicio] || 0) + 1; });
  const servicioFavorito = Object.entries(svcCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  const ultimo = turnosCli.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];

  const idx = clientes.findIndex(x => x.id === clienteId);
  if (idx < 0) return;

  const updated = {
    ...clientes[idx],
    totalGastado,
    ultimoTurnoFecha: ultimo?.fecha || null,
    estadisticas: { totalTurnos, ticketPromedio, servicioFavorito },
    ultimaActualizacion: new Date().toISOString()
  };
  clientes[idx] = updated;
  await saveDoc('clientes', updated);
}

// ── Helper interno ────────────────────────────────────────
async function saveDoc(colName, obj) {
  await setDoc(docRef(colName, obj.id), obj);
}
