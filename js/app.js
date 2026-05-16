// ══════════════════════════════════════════════════════════
//  BARBI MANICURA — app.js
//  Lógica principal, Firebase Firestore, todas las páginas
// ══════════════════════════════════════════════════════════

import { db } from './firebase-config.js';
import {
  collection, doc, getDocs, setDoc, deleteDoc, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── NAMESPACE en Firestore (para multi-tenant futuro) ─────
const NS = 'barbi'; // cambiá si usás múltiples salones

const col = (name) => collection(db, NS, 'data', name);
const docRef = (name, id) => doc(db, NS, 'data', name, id);
const configDocRef = () => doc(db, NS, 'data', 'config', 'main');

// ── ESTADO LOCAL ──────────────────────────────────────────
let insumos  = [];
let servicios = [];
let pagos    = [];
let gastosFijos = [];
let config   = {
  serviciosMes: 80,
  margenGanancia: 40,
  comisionPct: 0,
  userName: 'Barbi',
  userRole: 'Administradora'
};

let dbReady = false;

// ── HELPERS ───────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmt = (n) => (Math.round(n) || 0).toLocaleString('es-AR');
const fmtDec = (n) => (Math.round(n * 10) / 10).toFixed(1);

// ── DB STATUS UI ──────────────────────────────────────────
function setDbStatus(state, msg) {
  const bar = document.getElementById('dbStatusBar');
  const txt = document.getElementById('dbStatusText');
  if (!bar) return;
  bar.className = 'db-status-bar db-' + state;
  txt.textContent = msg;
  if (state === 'connected') {
    setTimeout(() => bar.classList.add('hide'), 3000);
  } else {
    bar.classList.remove('hide');
  }
}

// ── FIREBASE SAVE ─────────────────────────────────────────
async function saveDoc(colName, obj) {
  try {
    await setDoc(docRef(colName, obj.id), obj);
  } catch (e) {
    console.error('saveDoc error', e);
    toast('Error al guardar en Firebase', 'error');
  }
}

async function deleteFireDoc(colName, id) {
  try {
    await deleteDoc(docRef(colName, id));
  } catch (e) {
    console.error('deleteDoc error', e);
    toast('Error al eliminar', 'error');
  }
}

async function saveConfig() {
  try {
    await setDoc(configDocRef(), config);
  } catch (e) {
    console.error('saveConfig error', e);
  }
}

// Gastos fijos se guardan dentro de config como array
async function saveGastosFijos() {
  try {
    await setDoc(configDocRef(), { ...config, gastosFijos });
  } catch (e) {
    console.error('saveGastosFijos error', e);
  }
}

// ── LOAD ALL DATA ─────────────────────────────────────────
async function loadAll() {
  setDbStatus('connecting', 'Conectando con Firebase…');
  try {
    const [insSnap, svcSnap, pagSnap, cfgSnap] = await Promise.all([
      getDocs(col('insumos')),
      getDocs(col('servicios')),
      getDocs(col('pagos')),
      getDocs(collection(db, NS, 'data', 'config'))
    ]);

    insumos   = insSnap.docs.map(d => d.data());
    servicios = svcSnap.docs.map(d => d.data());
    pagos     = pagSnap.docs.map(d => d.data());

    const cfgDoc = cfgSnap.docs.find(d => d.id === 'main');
    if (cfgDoc) {
      const data = cfgDoc.data();
      gastosFijos = data.gastosFijos || [];
      config = { ...config, ...data };
      delete config.gastosFijos;
    }

    dbReady = true;
    setDbStatus('connected', `✓ Firebase conectado — ${insumos.length} insumos, ${servicios.length} servicios, ${pagos.length} pagos`);
    applyUserProfile();
    navigate(currentPage);
  } catch (e) {
    console.error('loadAll error', e);
    setDbStatus('error', '✗ Error de conexión con Firebase. Revisá la configuración en firebase-config.js');
    document.getElementById('mainContent').innerHTML = `
      <div class="card mt-4">
        <div class="section-title mb-2" style="color:var(--danger)">Error de conexión con Firebase</div>
        <p class="text-sm text-muted mb-3">No se pudo conectar a la base de datos. Verificá que:</p>
        <ol style="font-size:13.5px;color:var(--text2);padding-left:18px;line-height:2">
          <li>Reemplazaste los datos en <code>js/firebase-config.js</code></li>
          <li>El proyecto Firebase existe y Firestore está habilitado</li>
          <li>Las reglas de Firestore permiten lectura/escritura</li>
        </ol>
        <button class="btn btn-primary mt-4" onclick="location.reload()">Reintentar</button>
      </div>`;
  }
}

// ── CALCULATIONS ──────────────────────────────────────────

/**
 * NUEVA LÓGICA DE COSTOS:
 *
 * 1. Costo materiales = suma de (costo/unidad × cantidad) por ingrediente
 * 2. Costo operativo por servicio = total gastos fijos mensuales ÷ servicios al mes
 * 3. Costo base = materiales + operativo
 * 4. Precio mínimo = costo base (sin margen ni comisión)
 * 5. Precio sugerido = costo base × (1 + margen/100)
 * 6. Comisión manicurista = precio sugerido × comisionPct/100
 *    (lo que se le paga a ella; se descuenta del ingreso neto)
 * 7. Ingreso neto = precio cobrado - comisión
 */
function totalGastosFijosM() {
  return gastosFijos.reduce((s, g) => s + (parseFloat(g.monto) || 0), 0);
}

function costoOperativoPorServicio() {
  const total = totalGastosFijosM();
  const serviciosMes = config.serviciosMes || 1;
  return total / serviciosMes;
}

function calcularServicio(servicio) {
  let costoMateriales = 0;
  (servicio.ingredientes || []).forEach(ing => {
    const ins = insumos.find(i => i.id === ing.insumoId);
    if (ins && ins.cantidad > 0) {
      const cpu = ins.costo / ins.cantidad;
      costoMateriales += cpu * ing.cantidad;
    }
  });

  const costoOperativo = costoOperativoPorServicio();
  const costoBase = costoMateriales + costoOperativo;
  const margen = costoBase * (config.margenGanancia / 100);
  const precioSugerido = costoBase + margen;

  // Comisión = % del precio final que cobra el cliente
  const comisionMonto = precioSugerido * ((config.comisionPct || 0) / 100);
  const ingresoNeto = precioSugerido - comisionMonto;

  return {
    costoMateriales,
    costoOperativo,
    costoBase,
    margen,
    precioSugerido,
    comisionMonto,
    ingresoNeto
  };
}

function calcularConPrecioReal(precioReal) {
  const comisionMonto = precioReal * ((config.comisionPct || 0) / 100);
  return {
    comisionMonto,
    ingresoNeto: precioReal - comisionMonto
  };
}

// ── NAVIGATION ────────────────────────────────────────────
let currentPage = 'dashboard';

const pageTitles = {
  dashboard: 'Dashboard',
  insumos: 'Insumos',
  servicios: 'Servicios',
  caja: 'Caja',
  arqueo: 'Arqueo de Caja',
  estadisticas: 'Estadísticas',
  config: 'Configuración'
};

const pageRenderers = {
  dashboard: renderDashboard,
  insumos: renderInsumos,
  servicios: renderServicios,
  caja: renderCaja,
  arqueo: renderArqueo,
  estadisticas: renderEstadisticas,
  config: renderConfigPage
};

function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  document.getElementById('pageTitle').textContent = pageTitles[page] || page;
  document.getElementById('topbarActions').innerHTML = '';
  if (!dbReady) return;
  if (pageRenderers[page]) pageRenderers[page]();
  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
}

function applyUserProfile() {
  document.getElementById('userName').textContent = config.userName || 'Barbi';
  document.getElementById('userRole').textContent = config.userRole || 'Administradora';
  document.getElementById('userAvatar').textContent = (config.userName || 'B').charAt(0).toUpperCase();
}

// ── TOAST ─────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const tc = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  const icon = type === 'success'
    ? '<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polyline points="20,6 9,17 4,12"/></svg>'
    : '<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  t.innerHTML = icon + msg;
  tc.appendChild(t);
  setTimeout(() => t.style.opacity = '0', 2700);
  setTimeout(() => t.remove(), 3000);
}

// ── MODAL ─────────────────────────────────────────────────
function openModal(html, lg = false) {
  document.getElementById('modalContainer').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal${lg ? ' modal-lg' : ''}">${html}</div>
    </div>`;
}
function closeModal() { document.getElementById('modalContainer').innerHTML = ''; }

function modalCloseBtn() {
  return `<button class="modal-close" onclick="closeModal()">
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg></button>`;
}

function iconEdit() {
  return `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
}
function iconTrash() {
  return `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>`;
}
function iconPlus() {
  return `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
}
function iconDownload() {
  return `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
}

// ════════════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════════════
function renderDashboard() {
  const hoy = new Date().toDateString();
  const pagosHoy = pagos.filter(p => new Date(p.fecha).toDateString() === hoy);
  const totalHoy = pagosHoy.reduce((a, p) => a + p.total, 0);
  const efectivoHoy = pagosHoy.reduce((a, p) => a + (p.efectivo || 0), 0);
  const transHoy = pagosHoy.reduce((a, p) => a + (p.transferencia || 0), 0);

  const mes = new Date().getMonth();
  const anio = new Date().getFullYear();
  const pagosMes = pagos.filter(p => {
    const d = new Date(p.fecha);
    return d.getMonth() === mes && d.getFullYear() === anio;
  });
  const totalMes = pagosMes.reduce((a, p) => a + p.total, 0);
  const comisionMes = pagosMes.reduce((a, p) => a + (p.comisionMonto || 0), 0);
  const ingresoNetoMes = totalMes - comisionMes;

  const servicioCount = {};
  pagosMes.forEach(p => {
    if (p.servicioNombre) servicioCount[p.servicioNombre] = (servicioCount[p.servicioNombre] || 0) + 1;
  });
  const top3 = Object.entries(servicioCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const ultimos5 = [...pagos].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 5);

  const totalGastosMes = totalGastosFijosM();

  document.getElementById('mainContent').innerHTML = `
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Ingresos de hoy</div>
      <div class="stat-value">$${fmt(totalHoy)}</div>
      <div class="stat-sub">${pagosHoy.length} servicio${pagosHoy.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Ingresos del mes</div>
      <div class="stat-value">$${fmt(totalMes)}</div>
      <div class="stat-sub">${pagosMes.length} servicios</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Ingreso neto del mes</div>
      <div class="stat-value ${ingresoNetoMes >= 0 ? 'stat-up' : 'stat-down'}">$${fmt(ingresoNetoMes)}</div>
      <div class="stat-sub">después de comisión</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Gastos fijos / mes</div>
      <div class="stat-value">$${fmt(totalGastosMes)}</div>
      <div class="stat-sub">${gastosFijos.length} rubros</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Efectivo hoy</div>
      <div class="stat-value">$${fmt(efectivoHoy)}</div>
      <div class="stat-sub">en mano</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Transferencias hoy</div>
      <div class="stat-value">$${fmt(transHoy)}</div>
      <div class="stat-sub">en cuenta</div>
    </div>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="section-header">
        <div class="section-title">Últimos movimientos</div>
        <button class="btn btn-ghost btn-sm" onclick="navigate('caja')">Ver todos →</button>
      </div>
      ${ultimos5.length === 0
        ? `<div class="empty"><p>Sin movimientos aún</p></div>`
        : `<div class="table-wrap"><table>
          <thead><tr><th>Servicio</th><th>Forma</th><th>Total</th></tr></thead>
          <tbody>
            ${ultimos5.map(p => `<tr>
              <td>
                <div class="font-medium">${p.servicioNombre || 'Manual'}</div>
                <div class="text-xs text-hint">${new Date(p.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
              </td>
              <td><span class="pago-chip pago-${p.forma}">${p.forma === 'efectivo' ? 'Efectivo' : p.forma === 'transferencia' ? 'Transfer.' : 'Mixto'}</span></td>
              <td class="td-num font-medium">$${fmt(p.total)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`
      }
    </div>
    <div class="card">
      <div class="section-title mb-3">Top servicios del mes</div>
      ${top3.length === 0
        ? `<p class="text-sm text-muted">Sin datos aún</p>`
        : top3.map(([nom, cnt], i) => `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="width:22px;height:22px;border-radius:50%;background:var(--accent2);color:var(--accent3);font-size:11px;font-weight:500;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i + 1}</div>
            <div style="flex:1;font-size:13.5px">${nom}</div>
            <div class="badge badge-accent">${cnt}×</div>
          </div>`).join('')
      }
      <div class="divider"></div>
      <div class="flex justify-between text-sm text-muted mb-2"><span>Insumos cargados</span><span class="font-medium text-accent">${insumos.length}</span></div>
      <div class="flex justify-between text-sm text-muted mb-2"><span>Servicios definidos</span><span class="font-medium text-accent">${servicios.length}</span></div>
      <div class="flex justify-between text-sm text-muted"><span>Servicios/mes config.</span><span class="font-medium text-accent">${config.serviciosMes}</span></div>
    </div>
  </div>

  <div class="card mt-4">
    <div class="section-title mb-3">Accesos rápidos</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      <button class="btn btn-primary" onclick="navigate('caja');setTimeout(openNuevoPago,80)">${iconPlus()} Registrar pago</button>
      <button class="btn btn-secondary" onclick="navigate('insumos');setTimeout(openNuevoInsumo,80)">${iconPlus()} Nuevo insumo</button>
      <button class="btn btn-secondary" onclick="navigate('servicios');setTimeout(openNuevoServicio,80)">${iconPlus()} Nuevo servicio</button>
      <button class="btn btn-secondary" onclick="navigate('arqueo')">Ver arqueo</button>
      <button class="btn btn-secondary" onclick="navigate('config')">Configuración</button>
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════
//  INSUMOS
// ════════════════════════════════════════════════════════════
let insumoSearch = '';

function renderInsumos() {
  document.getElementById('topbarActions').innerHTML = `
    <button class="btn btn-primary" onclick="openNuevoInsumo()">${iconPlus()} Nuevo insumo</button>`;

  const filtered = insumos.filter(i =>
    !insumoSearch
    || i.nombre.toLowerCase().includes(insumoSearch.toLowerCase())
    || (i.categoria || '').toLowerCase().includes(insumoSearch.toLowerCase())
  );

  document.getElementById('mainContent').innerHTML = `
  <div class="card">
    <div class="search-wrap">
      <div class="search-icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
      <input class="form-input" placeholder="Buscar por nombre o categoría…" value="${insumoSearch}"
        oninput="insumoSearch=this.value;renderInsumos()" style="padding-left:32px">
    </div>
    ${filtered.length === 0
      ? `<div class="empty">
          <div class="empty-icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div>
          <h3>${insumoSearch ? 'Sin resultados' : 'Sin insumos cargados'}</h3>
          <p>${insumoSearch ? 'Probá con otro término' : 'Agregá tu primer insumo para empezar'}</p>
          ${!insumoSearch ? `<button class="btn btn-primary mt-3" onclick="openNuevoInsumo()">${iconPlus()} Agregar primer insumo</button>` : ''}
        </div>`
      : `<div class="table-wrap"><table>
          <thead>
            <tr><th>Nombre</th><th>Categoría</th><th>Costo compra</th><th>Cantidad</th><th>Costo/unidad</th><th>Marca</th><th style="width:80px"></th></tr>
          </thead>
          <tbody>
            ${filtered.map(ins => {
              const cpu = ins.cantidad > 0 ? ins.costo / ins.cantidad : 0;
              return `<tr>
                <td>
                  <div class="font-medium">${ins.nombre}</div>
                  ${ins.notas ? `<div class="text-xs text-hint">${ins.notas}</div>` : ''}
                </td>
                <td><span class="badge badge-neutral">${ins.categoria || '—'}</span></td>
                <td class="td-num">$${fmt(ins.costo)}</td>
                <td class="td-muted">${ins.cantidad} ${ins.unidad}</td>
                <td class="td-num text-accent font-medium">$${fmtDec(cpu)}/${ins.unidad}</td>
                <td class="td-muted text-sm">${ins.marca || '—'}</td>
                <td>
                  <div class="flex gap-2">
                    <button class="btn btn-ghost btn-sm" onclick="openNuevoInsumo('${ins.id}')" title="Editar">${iconEdit()}</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteInsumo('${ins.id}')" title="Eliminar">${iconTrash()}</button>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>`
    }
  </div>`;
}

function openNuevoInsumo(id) {
  const ins = id ? insumos.find(i => i.id === id) : null;
  const cpu = ins && ins.cantidad > 0 ? ins.costo / ins.cantidad : 0;
  openModal(`
  <div class="modal-header">
    <div class="modal-title">${ins ? 'Editar insumo' : 'Nuevo insumo'}</div>
    ${modalCloseBtn()}
  </div>
  <div class="modal-body">
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Nombre *</label>
        <input class="form-input" id="ins-nombre" value="${ins?.nombre || ''}" placeholder="Ej: Gel UV transparente">
      </div>
      <div class="form-group">
        <label class="form-label">Categoría *</label>
        <input class="form-input" id="ins-cat" value="${ins?.categoria || ''}" placeholder="Ej: Geles, Tips, Primers">
      </div>
    </div>
    <div class="form-row-3">
      <div class="form-group">
        <label class="form-label">Costo de compra ($) *</label>
        <input class="form-input" type="number" id="ins-costo" value="${ins?.costo || ''}" placeholder="15000" oninput="calcCPU()">
      </div>
      <div class="form-group">
        <label class="form-label">Cantidad total *</label>
        <input class="form-input" type="number" id="ins-cant" value="${ins?.cantidad || ''}" placeholder="30" oninput="calcCPU()">
      </div>
      <div class="form-group">
        <label class="form-label">Unidad *</label>
        <select class="form-input form-select" id="ins-unidad">
          ${['ml', 'g', 'unidades', 'cm', 'rollos', 'sobres', 'frascos', 'pares', 'tips'].map(u =>
            `<option ${(ins?.unidad || 'ml') === u ? 'selected' : ''}>${u}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="cpu-display" class="calc-display" style="display:${ins ? 'block' : 'none'}">
      Costo por unidad: <strong id="cpu-val">$${fmtDec(cpu)}</strong>
    </div>
    <div class="form-row mt-3">
      <div class="form-group">
        <label class="form-label">Marca (opcional)</label>
        <input class="form-input" id="ins-marca" value="${ins?.marca || ''}" placeholder="Ej: ByFama">
      </div>
      <div class="form-group">
        <label class="form-label">Notas (opcional)</label>
        <input class="form-input" id="ins-notas" value="${ins?.notas || ''}" placeholder="Observaciones">
      </div>
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="saveInsumo('${id || ''}')">Guardar</button>
  </div>`);
}

window.calcCPU = function () {
  const c = parseFloat(document.getElementById('ins-costo')?.value) || 0;
  const q = parseFloat(document.getElementById('ins-cant')?.value) || 0;
  const d = document.getElementById('cpu-display');
  if (d && c && q) { d.style.display = 'block'; document.getElementById('cpu-val').textContent = '$' + fmtDec(c / q); }
  else if (d) d.style.display = 'none';
};

window.saveInsumo = async function (id) {
  const nombre = document.getElementById('ins-nombre').value.trim();
  const categoria = document.getElementById('ins-cat').value.trim();
  const costo = parseFloat(document.getElementById('ins-costo').value);
  const cantidad = parseFloat(document.getElementById('ins-cant').value);
  if (!nombre || !costo || !cantidad) { toast('Completá los campos obligatorios', 'error'); return; }
  const obj = {
    id: id || uid(), nombre, categoria, costo, cantidad,
    unidad: document.getElementById('ins-unidad').value,
    marca: document.getElementById('ins-marca').value.trim(),
    notas: document.getElementById('ins-notas').value.trim()
  };
  await saveDoc('insumos', obj);
  if (id) { const idx = insumos.findIndex(i => i.id === id); insumos[idx] = obj; }
  else insumos.push(obj);
  closeModal();
  renderInsumos();
  toast(id ? 'Insumo actualizado' : 'Insumo creado');
};

window.openNuevoInsumo = openNuevoInsumo;

window.deleteInsumo = async function (id) {
  if (!confirm('¿Eliminar este insumo?')) return;
  await deleteFireDoc('insumos', id);
  insumos = insumos.filter(i => i.id !== id);
  renderInsumos();
  toast('Insumo eliminado');
};

// ════════════════════════════════════════════════════════════
//  SERVICIOS
// ════════════════════════════════════════════════════════════
let tempIngredientes = [];

function renderServicios() {
  document.getElementById('topbarActions').innerHTML = `
    <button class="btn btn-primary" onclick="openNuevoServicio()">${iconPlus()} Nuevo servicio</button>`;

  document.getElementById('mainContent').innerHTML = `
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px">
    ${servicios.length === 0
      ? `<div class="card" style="grid-column:1/-1"><div class="empty">
          <div class="empty-icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></div>
          <h3>Sin servicios definidos</h3>
          <p>Creá tu primer servicio con su receta de insumos</p>
          <button class="btn btn-primary mt-3" onclick="openNuevoServicio()">${iconPlus()} Crear primer servicio</button>
        </div></div>`
      : servicios.map(s => {
          const c = calcularServicio(s);
          return `<div class="card">
            <div class="flex items-center justify-between mb-2">
              <div class="font-medium" style="font-size:15px">${s.nombre}</div>
              <div class="flex gap-2">
                <button class="btn btn-ghost btn-sm" onclick="openNuevoServicio('${s.id}')">${iconEdit()}</button>
                <button class="btn btn-danger btn-sm" onclick="deleteServicio('${s.id}')">${iconTrash()}</button>
              </div>
            </div>
            ${s.descripcion ? `<p class="text-sm text-muted mb-2">${s.descripcion}</p>` : ''}
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
              ${s.tiempo ? `<span class="badge badge-neutral">⏱ ${s.tiempo} min</span>` : ''}
              ${s.dificultad ? `<span class="badge badge-info">${s.dificultad}</span>` : ''}
              <span class="badge badge-neutral">${(s.ingredientes || []).length} insumos</span>
            </div>
            <div class="divider" style="margin:8px 0"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12.5px">
              <div>
                <div class="stat-label" style="font-size:10px">Materiales</div>
                <div class="text-muted">$${fmt(c.costoMateriales)}</div>
              </div>
              <div>
                <div class="stat-label" style="font-size:10px">Operativo</div>
                <div class="text-muted">$${fmt(c.costoOperativo)}</div>
              </div>
              <div>
                <div class="stat-label" style="font-size:10px">Costo base</div>
                <div>$${fmt(c.costoBase)}</div>
              </div>
              <div>
                <div class="stat-label" style="font-size:10px">Precio sugerido</div>
                <div class="font-medium text-accent font-serif" style="font-size:16px">$${fmt(c.precioSugerido)}</div>
              </div>
            </div>
            ${config.comisionPct > 0 ? `
            <div class="flex justify-between text-xs text-hint mt-2">
              <span>Comisión manicurista (${config.comisionPct}%)</span>
              <span>$${fmt(c.comisionMonto)}</span>
            </div>
            <div class="flex justify-between text-xs text-success mt-1">
              <span>Ingreso neto estimado</span>
              <span class="font-medium">$${fmt(c.ingresoNeto)}</span>
            </div>` : ''}
          </div>`;
        }).join('')
    }
  </div>`;
}

window.openNuevoServicio = function (id) {
  const s = id ? servicios.find(sv => sv.id === id) : null;
  tempIngredientes = s ? JSON.parse(JSON.stringify(s.ingredientes || [])) : [];
  openModal(`
  <div class="modal-header">
    <div class="modal-title">${s ? 'Editar servicio' : 'Nuevo servicio'}</div>
    ${modalCloseBtn()}
  </div>
  <div class="modal-body">
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Nombre del servicio *</label>
        <input class="form-input" id="svc-nombre" value="${s?.nombre || ''}" placeholder="Ej: Soft Gel completo">
      </div>
      <div class="form-group">
        <label class="form-label">Descripción (opcional)</label>
        <input class="form-input" id="svc-desc" value="${s?.descripcion || ''}" placeholder="Detalle del servicio">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Tiempo estimado (min)</label>
        <input class="form-input" type="number" id="svc-tiempo" value="${s?.tiempo || ''}" placeholder="90">
      </div>
      <div class="form-group">
        <label class="form-label">Dificultad (opcional)</label>
        <select class="form-input form-select" id="svc-dif">
          <option value="">— Sin especificar —</option>
          ${['Básico', 'Intermedio', 'Avanzado', 'Premium'].map(d =>
            `<option ${s?.dificultad === d ? 'selected' : ''}>${d}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="divider"></div>
    <div class="section-header">
      <div class="section-title">Insumos / Receta</div>
      <button class="btn btn-secondary btn-sm" onclick="addIngRow()">${iconPlus()} Agregar insumo</button>
    </div>
    ${insumos.length === 0
      ? `<p class="text-sm text-muted">Primero cargá insumos desde la sección <strong>Insumos</strong>.</p>`
      : ''}
    <div id="ing-list"></div>
    <div id="svc-preview"></div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="saveServicio('${id || ''}')">Guardar servicio</button>
  </div>`, true);
  renderIngList();
};

window.addIngRow = function () {
  tempIngredientes.push({ insumoId: '', cantidad: 0 });
  renderIngList();
};

function renderIngList() {
  const el = document.getElementById('ing-list');
  if (!el) return;
  if (tempIngredientes.length === 0) {
    el.innerHTML = '<p class="text-sm text-hint mb-2">Sin insumos agregados aún</p>';
    updateSvcPreview(); return;
  }
  el.innerHTML = tempIngredientes.map((ing, i) => {
    const ins = insumos.find(x => x.id === ing.insumoId);
    const cpu = ins && ins.cantidad > 0 ? ins.costo / ins.cantidad : 0;
    const cost = cpu * (ing.cantidad || 0);
    return `<div class="ingredient-row">
      <select class="form-input flex1" style="font-size:13px"
        onchange="tempIngredientes[${i}].insumoId=this.value;renderIngList()">
        <option value="">Seleccionar insumo…</option>
        ${insumos.map(x => `<option value="${x.id}" ${x.id === ing.insumoId ? 'selected' : ''}>${x.nombre} (${x.unidad})</option>`).join('')}
      </select>
      <input type="number" class="form-input" style="width:76px;font-size:13px"
        value="${ing.cantidad || ''}" placeholder="Cant."
        oninput="tempIngredientes[${i}].cantidad=parseFloat(this.value)||0;renderIngList()">
      <div class="cost-tag">$${fmtDec(cost)}</div>
      <button class="btn btn-ghost btn-sm" onclick="tempIngredientes.splice(${i},1);renderIngList()">
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  }).join('');
  updateSvcPreview();
}

function updateSvcPreview() {
  const el = document.getElementById('svc-preview');
  if (!el) return;
  const c = calcularServicio({ ingredientes: tempIngredientes });
  if (c.costoBase <= 0) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="cost-breakdown">
    <div class="cost-section-label">Cálculo en tiempo real</div>
    <div class="cost-row"><span class="cost-label">Materiales</span><span>$${fmt(c.costoMateriales)}</span></div>
    <div class="cost-row"><span class="cost-label">Operativo (${gastosFijos.length} gastos ÷ ${config.serviciosMes} servicios/mes)</span><span>$${fmt(c.costoOperativo)}</span></div>
    <div class="cost-row subtotal"><span class="cost-label">Costo base</span><span>$${fmt(c.costoBase)}</span></div>
    <div class="cost-row"><span class="cost-label">Margen ${config.margenGanancia}%</span><span>$${fmt(c.margen)}</span></div>
    <div class="cost-row total"><span class="cost-label">Precio sugerido</span><span class="cost-val">$${fmt(c.precioSugerido)}</span></div>
    ${config.comisionPct > 0 ? `
    <div class="cost-row" style="margin-top:6px"><span class="cost-label">Comisión manicurista ${config.comisionPct}%</span><span style="color:var(--danger)">— $${fmt(c.comisionMonto)}</span></div>
    <div class="cost-row"><span class="cost-label text-success">Ingreso neto estimado</span><span class="text-success font-medium">$${fmt(c.ingresoNeto)}</span></div>
    ` : ''}
  </div>`;
}

window.saveServicio = async function (id) {
  const nombre = document.getElementById('svc-nombre').value.trim();
  if (!nombre) { toast('Ingresá el nombre del servicio', 'error'); return; }
  const obj = {
    id: id || uid(), nombre,
    descripcion: document.getElementById('svc-desc').value.trim(),
    tiempo: parseInt(document.getElementById('svc-tiempo').value) || 0,
    dificultad: document.getElementById('svc-dif').value,
    ingredientes: tempIngredientes.filter(i => i.insumoId && i.cantidad > 0)
  };
  await saveDoc('servicios', obj);
  if (id) { const idx = servicios.findIndex(s => s.id === id); servicios[idx] = obj; }
  else servicios.push(obj);
  closeModal();
  renderServicios();
  toast(id ? 'Servicio actualizado' : 'Servicio creado');
};

window.deleteServicio = async function (id) {
  if (!confirm('¿Eliminar este servicio?')) return;
  await deleteFireDoc('servicios', id);
  servicios = servicios.filter(s => s.id !== id);
  renderServicios();
  toast('Servicio eliminado');
};

// ════════════════════════════════════════════════════════════
//  CAJA — PAGOS
// ════════════════════════════════════════════════════════════
let cajaMonth = new Date().toISOString().slice(0, 7);
let cajaBusqueda = '';
let pagoForma = 'efectivo';

function renderCaja() {
  document.getElementById('topbarActions').innerHTML = `
    <button class="btn btn-primary" onclick="openNuevoPago()">${iconPlus()} Registrar pago</button>`;

  const filtrados = pagos.filter(p => {
    const matchMes = !cajaMonth || p.fecha.slice(0, 7) === cajaMonth;
    const matchQ = !cajaBusqueda
      || (p.servicioNombre || '').toLowerCase().includes(cajaBusqueda.toLowerCase())
      || (p.clienteNombre || '').toLowerCase().includes(cajaBusqueda.toLowerCase());
    return matchMes && matchQ;
  }).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  const totalEf = filtrados.reduce((a, p) => a + (p.efectivo || 0), 0);
  const totalTr = filtrados.reduce((a, p) => a + (p.transferencia || 0), 0);
  const totalGen = filtrados.reduce((a, p) => a + p.total, 0);
  const totalComision = filtrados.reduce((a, p) => a + (p.comisionMonto || 0), 0);
  const totalNeto = totalGen - totalComision;

  document.getElementById('mainContent').innerHTML = `
  <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
    <div class="stat-card"><div class="stat-label">Total período</div><div class="stat-value">$${fmt(totalGen)}</div><div class="stat-sub">${filtrados.length} pagos</div></div>
    <div class="stat-card"><div class="stat-label">Efectivo</div><div class="stat-value">$${fmt(totalEf)}</div></div>
    <div class="stat-card"><div class="stat-label">Transferencias</div><div class="stat-value">$${fmt(totalTr)}</div></div>
    <div class="stat-card"><div class="stat-label">Comisión total</div><div class="stat-value stat-down">$${fmt(totalComision)}</div></div>
    <div class="stat-card"><div class="stat-label">Ingreso neto</div><div class="stat-value stat-up">$${fmt(totalNeto)}</div></div>
  </div>
  <div class="card">
    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <div class="search-wrap" style="flex:1;min-width:180px;margin-bottom:0">
        <div class="search-icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
        <input class="form-input" placeholder="Buscar servicio o cliente…" value="${cajaBusqueda}"
          oninput="cajaBusqueda=this.value;renderCaja()" style="padding-left:32px">
      </div>
      <input type="month" class="form-input" style="width:160px" value="${cajaMonth}"
        onchange="cajaMonth=this.value;renderCaja()">
    </div>
    ${filtrados.length === 0
      ? `<div class="empty"><h3>Sin movimientos</h3><p>Registrá un pago para comenzar</p></div>`
      : `<div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Servicio</th><th>Cliente</th><th>Forma</th><th>Efectivo</th><th>Transfer.</th><th>Total</th><th>Comisión</th><th>Neto</th><th style="width:50px"></th></tr></thead>
          <tbody>
            ${filtrados.map(p => `<tr>
              <td class="td-muted text-sm" style="white-space:nowrap">${new Date(p.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
              <td class="font-medium">${p.servicioNombre || 'Manual'}</td>
              <td class="td-muted">${p.clienteNombre || '—'}</td>
              <td><span class="pago-chip pago-${p.forma}">${p.forma === 'efectivo' ? 'Efectivo' : p.forma === 'transferencia' ? 'Transfer.' : 'Mixto'}</span></td>
              <td class="td-num">${p.efectivo ? '$' + fmt(p.efectivo) : '—'}</td>
              <td class="td-num">${p.transferencia ? '$' + fmt(p.transferencia) : '—'}</td>
              <td class="td-num font-medium">$${fmt(p.total)}</td>
              <td class="td-num text-danger text-sm">${p.comisionMonto ? '$' + fmt(p.comisionMonto) : '—'}</td>
              <td class="td-num text-success font-medium">$${fmt(p.total - (p.comisionMonto || 0))}</td>
              <td><button class="btn btn-danger btn-sm" onclick="deletePago('${p.id}')">${iconTrash()}</button></td>
            </tr>`).join('')}
          </tbody>
        </table></div>`
    }
  </div>`;
}

window.openNuevoPago = function () {
  pagoForma = 'efectivo';
  openModal(`
  <div class="modal-header">
    <div class="modal-title">Registrar pago</div>
    ${modalCloseBtn()}
  </div>
  <div class="modal-body">
    <div class="form-group">
      <label class="form-label">Servicio</label>
      <select class="form-input form-select" id="pago-svc" onchange="onPagoSvcChange(this.value)">
        <option value="">— Sin servicio asociado —</option>
        ${servicios.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('')}
      </select>
    </div>
    <div id="ps-row" style="display:none" class="calc-display mb-3">
      Precio sugerido: <strong id="ps-val">$0</strong>
      <span id="ps-comision" class="text-xs text-hint ml-auto" style="margin-left:auto;display:block;margin-top:2px"></span>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Cliente (opcional)</label>
        <input class="form-input" id="pago-cliente" placeholder="Nombre del cliente">
      </div>
      <div class="form-group">
        <label class="form-label">Fecha y hora</label>
        <input type="datetime-local" class="form-input" id="pago-fecha" value="${new Date().toISOString().slice(0, 16)}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Forma de pago</label>
      <div class="payment-method">
        <button type="button" class="method-btn active" id="mb-efectivo" onclick="setPagoForma('efectivo')">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7"><rect x="2" y="7" width="20" height="14" rx="2"/><circle cx="12" cy="14" r="3"/></svg>
          Efectivo
        </button>
        <button type="button" class="method-btn" id="mb-transferencia" onclick="setPagoForma('transferencia')">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          Transferencia
        </button>
        <button type="button" class="method-btn" id="mb-mixto" onclick="setPagoForma('mixto')">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7"><path d="M16 3h5v5M4 20 20.2 3.8M21 16v5h-5M15 15l5.1 5.1"/></svg>
          Combinado
        </button>
      </div>
    </div>
    <div id="pago-campos"></div>
    <div id="pago-total-preview" style="display:none" class="cost-breakdown">
      <div class="cost-row total">
        <span>Total cobrado</span>
        <span class="cost-val" id="pago-total-val">$0</span>
      </div>
      <div id="pago-comision-row" style="display:none" class="cost-row">
        <span class="cost-label" id="pago-comision-label">Comisión</span>
        <span id="pago-comision-val" class="text-danger"></span>
      </div>
      <div id="pago-neto-row" style="display:none" class="cost-row">
        <span class="cost-label text-success">Ingreso neto</span>
        <span id="pago-neto-val" class="text-success font-medium"></span>
      </div>
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="savePago()">Confirmar pago</button>
  </div>`);
  renderPagoCampos();
};

window.onPagoSvcChange = function (val) {
  const row = document.getElementById('ps-row');
  const ps = document.getElementById('ps-val');
  const psComision = document.getElementById('ps-comision');
  if (val) {
    const s = servicios.find(x => x.id === val);
    if (s) {
      const c = calcularServicio(s);
      row.style.display = 'block';
      ps.textContent = '$' + fmt(c.precioSugerido);
      if (config.comisionPct > 0) {
        psComision.textContent = `Comisión estimada: $${fmt(c.comisionMonto)} → Ingreso neto: $${fmt(c.ingresoNeto)}`;
      } else {
        psComision.textContent = '';
      }
    }
  } else {
    row.style.display = 'none';
  }
  updatePagoPreview();
};

window.setPagoForma = function (f) {
  pagoForma = f;
  ['efectivo', 'transferencia', 'mixto'].forEach(x => {
    document.getElementById('mb-' + x)?.classList.toggle('active', x === f);
  });
  renderPagoCampos();
};

function renderPagoCampos() {
  const el = document.getElementById('pago-campos');
  if (!el) return;
  if (pagoForma === 'efectivo') {
    el.innerHTML = `<div class="form-group"><label class="form-label">Monto efectivo ($) *</label><input class="form-input" type="number" id="pago-ef" placeholder="0" oninput="updatePagoPreview()"></div>`;
  } else if (pagoForma === 'transferencia') {
    el.innerHTML = `<div class="form-group"><label class="form-label">Monto transferencia ($) *</label><input class="form-input" type="number" id="pago-tr" placeholder="0" oninput="updatePagoPreview()"></div>`;
  } else {
    el.innerHTML = `<div class="form-row">
      <div class="form-group"><label class="form-label">Efectivo ($)</label><input class="form-input" type="number" id="pago-ef" placeholder="0" oninput="updatePagoPreview()"></div>
      <div class="form-group"><label class="form-label">Transferencia ($)</label><input class="form-input" type="number" id="pago-tr" placeholder="0" oninput="updatePagoPreview()"></div>
    </div>`;
  }
  updatePagoPreview();
}

window.updatePagoPreview = function () {
  const ef = parseFloat(document.getElementById('pago-ef')?.value) || 0;
  const tr = parseFloat(document.getElementById('pago-tr')?.value) || 0;
  const total = ef + tr;
  const preview = document.getElementById('pago-total-preview');
  if (total > 0) {
    preview.style.display = 'block';
    document.getElementById('pago-total-val').textContent = '$' + fmt(total);
    if (config.comisionPct > 0) {
      const { comisionMonto, ingresoNeto } = calcularConPrecioReal(total);
      document.getElementById('pago-comision-row').style.display = 'flex';
      document.getElementById('pago-neto-row').style.display = 'flex';
      document.getElementById('pago-comision-label').textContent = `Comisión manicurista (${config.comisionPct}%)`;
      document.getElementById('pago-comision-val').textContent = '— $' + fmt(comisionMonto);
      document.getElementById('pago-neto-val').textContent = '$' + fmt(ingresoNeto);
    }
  } else {
    preview.style.display = 'none';
  }
};

window.savePago = async function () {
  const ef = parseFloat(document.getElementById('pago-ef')?.value) || 0;
  const tr = parseFloat(document.getElementById('pago-tr')?.value) || 0;
  const total = ef + tr;
  if (!total) { toast('Ingresá el monto', 'error'); return; }

  const svcId = document.getElementById('pago-svc').value;
  const svc = servicios.find(s => s.id === svcId);
  const { comisionMonto } = config.comisionPct > 0
    ? calcularConPrecioReal(total)
    : { comisionMonto: 0 };

  const obj = {
    id: uid(),
    servicioId: svcId || null,
    servicioNombre: svc?.nombre || 'Manual',
    clienteNombre: document.getElementById('pago-cliente').value.trim(),
    fecha: document.getElementById('pago-fecha').value || new Date().toISOString(),
    forma: pagoForma,
    efectivo: ef || null,
    transferencia: tr || null,
    total,
    comisionMonto,
    ingresoNeto: total - comisionMonto
  };

  await saveDoc('pagos', obj);
  pagos.push(obj);
  closeModal();
  renderCaja();
  toast('Pago registrado');
};

window.deletePago = async function (id) {
  if (!confirm('¿Eliminar este registro?')) return;
  await deleteFireDoc('pagos', id);
  pagos = pagos.filter(p => p.id !== id);
  renderCaja();
  toast('Registro eliminado');
};

// ════════════════════════════════════════════════════════════
//  ARQUEO
// ════════════════════════════════════════════════════════════
function renderArqueo() {
  document.getElementById('topbarActions').innerHTML = `
    <button class="btn btn-secondary" onclick="exportarJSON()">${iconDownload()} Exportar JSON</button>`;

  const hoy = new Date().toDateString();
  const hoyPagos = pagos.filter(p => new Date(p.fecha).toDateString() === hoy);
  const efHoy = hoyPagos.reduce((a, p) => a + (p.efectivo || 0), 0);
  const trHoy = hoyPagos.reduce((a, p) => a + (p.transferencia || 0), 0);
  const comHoy = hoyPagos.reduce((a, p) => a + (p.comisionMonto || 0), 0);
  const totalHoy = efHoy + trHoy;

  const mes = new Date().getMonth();
  const anio = new Date().getFullYear();
  const mesPagos = pagos.filter(p => {
    const d = new Date(p.fecha);
    return d.getMonth() === mes && d.getFullYear() === anio;
  });
  const efMes = mesPagos.reduce((a, p) => a + (p.efectivo || 0), 0);
  const trMes = mesPagos.reduce((a, p) => a + (p.transferencia || 0), 0);
  const totalMes = mesPagos.reduce((a, p) => a + p.total, 0);
  const comMes = mesPagos.reduce((a, p) => a + (p.comisionMonto || 0), 0);
  const netoMes = totalMes - comMes;
  const gastosMes = totalGastosFijosM();
  const resultadoMes = netoMes - gastosMes;

  document.getElementById('mainContent').innerHTML = `
  <div class="grid-2">
    <div class="card">
      <div class="section-title mb-3">
        Arqueo de hoy · ${new Date().toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long' })}
      </div>
      <div class="cost-breakdown">
        <div class="cost-row"><span class="cost-label">Efectivo en caja</span><span>$${fmt(efHoy)}</span></div>
        <div class="cost-row"><span class="cost-label">Transferencias</span><span>$${fmt(trHoy)}</span></div>
        <div class="cost-row subtotal"><span class="cost-label">Total facturado</span><span class="font-medium">$${fmt(totalHoy)}</span></div>
        ${config.comisionPct > 0 ? `<div class="cost-row"><span class="cost-label">Comisión manicurista</span><span class="text-danger">— $${fmt(comHoy)}</span></div>` : ''}
        <div class="cost-row total"><span class="cost-label">Ingreso neto hoy</span><span class="cost-val">$${fmt(totalHoy - comHoy)}</span></div>
      </div>
      <div class="mt-3">
        <div class="text-sm text-muted mb-2 font-medium">Servicios de hoy</div>
        ${hoyPagos.length === 0
          ? `<p class="text-sm text-hint">Ningún pago registrado hoy</p>`
          : hoyPagos.map(p => `
            <div class="ingredient-row mb-2">
              <div class="flex1">
                <div class="text-sm font-medium">${p.servicioNombre || 'Manual'}</div>
                <div class="text-xs text-hint">${p.clienteNombre || 'Sin nombre'} · ${new Date(p.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              <span class="pago-chip pago-${p.forma}">${p.forma}</span>
              <div class="cost-tag font-medium">$${fmt(p.total)}</div>
            </div>`).join('')
        }
      </div>
    </div>
    <div class="card">
      <div class="section-title mb-3">
        Resumen mensual · ${new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
      </div>
      <div class="cost-breakdown">
        <div class="cost-section-label">Ingresos</div>
        <div class="cost-row"><span class="cost-label">Efectivo</span><span>$${fmt(efMes)}</span></div>
        <div class="cost-row"><span class="cost-label">Transferencias</span><span>$${fmt(trMes)}</span></div>
        <div class="cost-row subtotal"><span class="cost-label">Total facturado</span><span class="font-medium">$${fmt(totalMes)}</span></div>
        <div class="cost-section-label">Egresos estimados</div>
        ${config.comisionPct > 0 ? `<div class="cost-row"><span class="cost-label">Comisión manicurista (${config.comisionPct}%)</span><span class="text-danger">— $${fmt(comMes)}</span></div>` : ''}
        ${gastosFijos.map(g => `<div class="cost-row"><span class="cost-label">${g.nombre}</span><span class="text-danger">— $${fmt(g.monto)}</span></div>`).join('')}
        <div class="cost-row subtotal"><span class="cost-label">Total egresos</span><span class="text-danger font-medium">— $${fmt(comMes + gastosMes)}</span></div>
        <div class="cost-row total">
          <span class="cost-label">Resultado del mes</span>
          <span class="cost-val" style="color:${resultadoMes >= 0 ? 'var(--success)' : 'var(--danger)'}">
            ${resultadoMes >= 0 ? '' : '— '}$${fmt(Math.abs(resultadoMes))}
          </span>
        </div>
      </div>
      <div class="stats-grid mt-3" style="grid-template-columns:1fr 1fr">
        <div class="stat-card"><div class="stat-label">Servicios del mes</div><div class="stat-value">${mesPagos.length}</div></div>
        <div class="stat-card"><div class="stat-label">Ticket promedio</div><div class="stat-value">$${fmt(mesPagos.length ? totalMes / mesPagos.length : 0)}</div></div>
      </div>
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════
//  ESTADÍSTICAS
// ════════════════════════════════════════════════════════════
function renderEstadisticas() {
  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    const m = d.getMonth(), a = d.getFullYear();
    const ps = pagos.filter(p => { const pd = new Date(p.fecha); return pd.getMonth() === m && pd.getFullYear() === a; });
    const total = ps.reduce((s, p) => s + p.total, 0);
    const comision = ps.reduce((s, p) => s + (p.comisionMonto || 0), 0);
    meses.push({
      label: d.toLocaleDateString('es-AR', { month: 'short' }),
      total, comision, neto: total - comision, count: ps.length
    });
  }
  const maxTotal = Math.max(...meses.map(m => m.total), 1);

  const servicioCount = {};
  pagos.forEach(p => { if (p.servicioNombre) servicioCount[p.servicioNombre] = (servicioCount[p.servicioNombre] || 0) + 1; });
  const top5 = Object.entries(servicioCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCount = Math.max(...top5.map(x => x[1]), 1);

  const ef = pagos.reduce((a, p) => a + (p.efectivo || 0), 0);
  const tr = pagos.reduce((a, p) => a + (p.transferencia || 0), 0);
  const gt = ef + tr;

  const efPct = gt > 0 ? Math.round((ef / gt) * 100) : 0;
  const trPct = gt > 0 ? Math.round((tr / gt) * 100) : 0;

  document.getElementById('mainContent').innerHTML = `
  <div class="grid-2">
    <div class="card">
      <div class="section-title mb-4">Ingresos últimos 6 meses</div>
      <div class="bar-group">
        ${meses.map((m, idx) => `
          <div class="bar-col">
            <div class="bar-val">$${m.total >= 1000 ? Math.round(m.total / 1000) + 'k' : fmt(m.total)}</div>
            <div class="bar-fill ${idx === meses.length - 1 ? 'active' : ''}"
              style="height:${Math.max(6, Math.round((m.total / maxTotal) * 100))}px"></div>
            <div class="bar-label">${m.label}</div>
          </div>`).join('')}
      </div>
      <div class="divider"></div>
      <div style="font-size:11.5px;color:var(--text3)">Total 6 meses: <strong style="color:var(--text)">$${fmt(meses.reduce((a, m) => a + m.total, 0))}</strong></div>
    </div>
    <div class="card">
      <div class="section-title mb-3">Servicios más realizados</div>
      ${top5.length === 0
        ? `<p class="text-sm text-hint">Sin datos suficientes</p>`
        : top5.map(([nom, cnt]) => `
          <div style="margin-bottom:10px">
            <div class="flex justify-between text-sm mb-1"><span>${nom}</span><span class="font-medium">${cnt}×</span></div>
            <div style="height:5px;background:var(--bg2);border-radius:3px">
              <div style="height:5px;background:var(--accent);border-radius:3px;width:${Math.round((cnt / maxCount) * 100)}%"></div>
            </div>
          </div>`).join('')
      }
    </div>
  </div>

  <div class="grid-2 mt-4">
    <div class="card">
      <div class="section-title mb-3">Formas de pago (histórico)</div>
      <div class="ring-wrap">
        <svg width="90" height="90" viewBox="0 0 36 36" style="transform:rotate(-90deg);flex-shrink:0">
          <circle cx="18" cy="18" r="14" fill="none" stroke="var(--bg2)" stroke-width="4"/>
          ${gt > 0 ? `
          <circle cx="18" cy="18" r="14" fill="none" stroke="var(--accent)" stroke-width="4"
            stroke-dasharray="${efPct} ${100 - efPct}" stroke-dashoffset="0"/>
          <circle cx="18" cy="18" r="14" fill="none" stroke="var(--info)" stroke-width="4"
            stroke-dasharray="${trPct} ${100 - trPct}"
            stroke-dashoffset="${-efPct}"/>` : ''}
        </svg>
        <div class="ring-legend">
          <div class="ring-legend-item"><div class="ring-dot" style="background:var(--accent)"></div><div>Efectivo ${efPct}% — $${fmt(ef)}</div></div>
          <div class="ring-legend-item"><div class="ring-dot" style="background:var(--info)"></div><div>Transfer. ${trPct}% — $${fmt(tr)}</div></div>
          <div class="ring-legend-item"><div class="ring-dot" style="background:var(--bg2)"></div><div>Total — $${fmt(gt)}</div></div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="section-title mb-3">Resumen general</div>
      <div class="stats-grid" style="grid-template-columns:1fr 1fr">
        <div class="stat-card"><div class="stat-label">Insumos</div><div class="stat-value">${insumos.length}</div></div>
        <div class="stat-card"><div class="stat-label">Servicios</div><div class="stat-value">${servicios.length}</div></div>
        <div class="stat-card"><div class="stat-label">Pagos totales</div><div class="stat-value">${pagos.length}</div></div>
        <div class="stat-card"><div class="stat-label">Gastos fijos</div><div class="stat-value">${gastosFijos.length}</div></div>
      </div>
      <div class="cost-breakdown mt-3">
        <div class="cost-row"><span class="cost-label">Total gastos fijos/mes</span><span>$${fmt(totalGastosFijosM())}</span></div>
        <div class="cost-row"><span class="cost-label">Costo operativo/servicio</span><span>$${fmt(costoOperativoPorServicio())}</span></div>
        <div class="cost-row"><span class="cost-label">Comisión configurada</span><span>${config.comisionPct}% del precio final</span></div>
      </div>
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ════════════════════════════════════════════════════════════
function renderConfigPage() {
  document.getElementById('mainContent').innerHTML = `
  <div class="grid-2">
    <div class="card">
      <div class="section-title mb-3">Configuración de costos</div>
      <div class="form-group">
        <label class="form-label">Servicios disponibles por mes</label>
        <input class="form-input" type="number" id="cfg-svcmes" value="${config.serviciosMes}" placeholder="80" oninput="updateCfgCalc()">
        <div class="form-hint">Cantidad de turnos que se realizan por mes (se usa para distribuir gastos fijos)</div>
      </div>
      <div class="form-group">
        <label class="form-label">Margen de ganancia (%)</label>
        <input class="form-input" type="number" id="cfg-margen" value="${config.margenGanancia}" min="0" max="500" oninput="updateCfgCalc()">
        <div class="form-hint">Porcentaje que se agrega sobre el costo base para calcular el precio sugerido</div>
      </div>
      <div class="form-group">
        <label class="form-label">Comisión de la manicurista (% del precio final)</label>
        <input class="form-input" type="number" id="cfg-comision" value="${config.comisionPct || 0}" min="0" max="100" oninput="updateCfgCalc()">
        <div class="form-hint">Porcentaje del precio total que cobra la manicurista por cada servicio</div>
      </div>
      <div class="calc-display" id="cfg-calc">
        ${renderCfgCalc()}
      </div>
    </div>
    <div class="card">
      <div class="section-header">
        <div class="section-title">Gastos fijos mensuales</div>
        <button class="btn btn-secondary btn-sm" onclick="addGastoFijo()">${iconPlus()} Agregar</button>
      </div>
      <div id="gastos-list">
        ${renderGastosFijosList()}
      </div>
      <div class="calc-display mt-3" id="gastos-total-display">
        Total gastos fijos: <strong>$${fmt(totalGastosFijosM())}</strong>
        &nbsp;·&nbsp; Por servicio: <strong>$${fmt(costoOperativoPorServicio())}</strong>
      </div>
    </div>
  </div>

  <div class="card mt-4">
    <div class="section-title mb-3">Perfil del negocio</div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Nombre (usuario)</label>
        <input class="form-input" id="cfg-nombre" value="${config.userName || 'Barbi'}" placeholder="Tu nombre">
      </div>
      <div class="form-group">
        <label class="form-label">Rol</label>
        <select class="form-input form-select" id="cfg-rol">
          ${['Administradora', 'Manicurista', 'Dueña', 'Empleada'].map(r =>
            `<option ${(config.userRole || 'Administradora') === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </div>
    </div>
  </div>

  <div class="card mt-4">
    <div class="section-title mb-2">Backup de datos</div>
    <p class="text-sm text-muted mb-3">Exportá o importá todos los datos en formato JSON.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-secondary" onclick="exportarJSON()">${iconDownload()} Exportar JSON</button>
      <label class="btn btn-secondary" style="cursor:pointer">
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Importar JSON
        <input type="file" accept=".json" style="display:none" onchange="importarJSON(event)">
      </label>
    </div>
  </div>

  <div style="display:flex;justify-content:flex-end;margin-top:16px">
    <button class="btn btn-primary" onclick="saveConfigPage()">Guardar configuración</button>
  </div>`;
}

function renderCfgCalc() {
  const svcMes = parseFloat(document.getElementById('cfg-svcmes')?.value) || config.serviciosMes;
  const gastosTot = totalGastosFijosM();
  const opPorSvc = svcMes > 0 ? gastosTot / svcMes : 0;
  return `Costo operativo por servicio: <strong>$${fmt(opPorSvc)}</strong> (${fmt(gastosTot)} ÷ ${svcMes} servicios)`;
}

window.updateCfgCalc = function () {
  const el = document.getElementById('cfg-calc');
  if (el) el.innerHTML = renderCfgCalc();
};

function renderGastosFijosList() {
  if (gastosFijos.length === 0) {
    return '<p class="text-sm text-hint mb-2">Sin gastos fijos cargados. Agregá alquiler, luz, internet, etc.</p>';
  }
  return gastosFijos.map((g, i) => `
    <div class="gasto-row">
      <input class="form-input flex1" value="${g.nombre}" placeholder="Nombre del gasto"
        oninput="gastosFijos[${i}].nombre=this.value;updateGastosDisplay()">
      <input class="form-input" type="number" value="${g.monto}" placeholder="Monto $"
        style="width:110px" oninput="gastosFijos[${i}].monto=parseFloat(this.value)||0;updateGastosDisplay()">
      <button class="btn btn-danger btn-sm" onclick="removeGastoFijo(${i})">${iconTrash()}</button>
    </div>`).join('');
}

window.addGastoFijo = function () {
  gastosFijos.push({ id: uid(), nombre: '', monto: 0 });
  document.getElementById('gastos-list').innerHTML = renderGastosFijosList();
  updateGastosDisplay();
};

window.removeGastoFijo = function (i) {
  gastosFijos.splice(i, 1);
  document.getElementById('gastos-list').innerHTML = renderGastosFijosList();
  updateGastosDisplay();
};

window.updateGastosDisplay = function () {
  const el = document.getElementById('gastos-total-display');
  const svcMes = parseFloat(document.getElementById('cfg-svcmes')?.value) || config.serviciosMes;
  const total = totalGastosFijosM();
  const porSvc = svcMes > 0 ? total / svcMes : 0;
  if (el) el.innerHTML = `Total gastos fijos: <strong>$${fmt(total)}</strong> &nbsp;·&nbsp; Por servicio: <strong>$${fmt(porSvc)}</strong>`;
  updateCfgCalc();
};

window.saveConfigPage = async function () {
  config.serviciosMes = parseFloat(document.getElementById('cfg-svcmes').value) || 1;
  config.margenGanancia = parseFloat(document.getElementById('cfg-margen').value) || 0;
  config.comisionPct = parseFloat(document.getElementById('cfg-comision').value) || 0;
  config.userName = document.getElementById('cfg-nombre').value.trim() || 'Barbi';
  config.userRole = document.getElementById('cfg-rol').value;

  await saveGastosFijos();
  applyUserProfile();
  toast('Configuración guardada en Firebase');
  renderConfigPage();
};

// ════════════════════════════════════════════════════════════
//  BACKUP
// ════════════════════════════════════════════════════════════
window.exportarJSON = function () {
  const data = { insumos, servicios, pagos, gastosFijos, config, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `barbi-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  toast('Backup exportado');
};

window.importarJSON = async function (event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      const batch = writeBatch(db);

      if (data.insumos) {
        data.insumos.forEach(obj => batch.set(docRef('insumos', obj.id), obj));
        insumos = data.insumos;
      }
      if (data.servicios) {
        data.servicios.forEach(obj => batch.set(docRef('servicios', obj.id), obj));
        servicios = data.servicios;
      }
      if (data.pagos) {
        data.pagos.forEach(obj => batch.set(docRef('pagos', obj.id), obj));
        pagos = data.pagos;
      }
      if (data.gastosFijos) gastosFijos = data.gastosFijos;
      if (data.config) config = { ...config, ...data.config };

      await batch.commit();
      await saveGastosFijos();

      toast('Datos importados a Firebase');
      navigate(currentPage);
    } catch (err) {
      console.error(err);
      toast('Error al leer el archivo JSON', 'error');
    }
  };
  reader.readAsText(file);
};

// ════════════════════════════════════════════════════════════
//  EXPOSE GLOBALS
// ════════════════════════════════════════════════════════════
window.navigate = navigate;
window.toggleSidebar = toggleSidebar;
window.closeModal = closeModal;
window.openNuevoPago = window.openNuevoPago;
window.openNuevoServicio = window.openNuevoServicio;
window.renderIngList = renderIngList;
window.tempIngredientes = tempIngredientes;

// ── INIT ──────────────────────────────────────────────────
loadAll();
