// ══════════════════════════════════════════════════════════
//  BARBI MANICURA — app.js v3.0
//  Lógica completa, Firebase, todas las páginas
//  Fixes: insumos en recetas, desglose de costos, movimientos, financiero
// ══════════════════════════════════════════════════════════

import { db } from './firebase-config.js';
import {
  collection, doc, getDocs, setDoc, deleteDoc, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const NS = 'barbi';
const col = (name) => collection(db, NS, 'data', name);
const docRef = (name, id) => doc(db, NS, 'data', name, id);
const configDocRef = () => doc(db, NS, 'data', 'config', 'main');

let insumos  = [];
let servicios = [];
let pagos    = [];
let movimientos = []; // Nuevo: compras, gastos, transferencias
let gastosFijos = [];
let config   = {
  serviciosMes: 80,
  margenGanancia: 40,
  comisionPct: 0,
  userName: 'Barbi',
  userRole: 'Administradora',
  saldoEfectivo: 0,
  saldoCuenta: 0,
  salarioObjetivoManicurista: 0
};

let dbReady = false;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmt = (n) => (Math.round(n) || 0).toLocaleString('es-AR');
const fmtDec = (n) => (Math.round(n * 10) / 10).toFixed(1);

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

async function saveGastosFijos() {
  try {
    await setDoc(configDocRef(), { ...config, gastosFijos });
  } catch (e) {
    console.error('saveGastosFijos error', e);
  }
}

async function loadAll() {
  setDbStatus('connecting', 'Conectando con Firebase…');
  try {
    const [insSnap, svcSnap, pagSnap, movSnap, cfgSnap] = await Promise.all([
      getDocs(col('insumos')),
      getDocs(col('servicios')),
      getDocs(col('pagos')),
      getDocs(col('movimientos')),
      getDocs(collection(db, NS, 'data', 'config'))
    ]);

    insumos   = insSnap.docs.map(d => d.data());
    servicios = svcSnap.docs.map(d => d.data());
    pagos     = pagSnap.docs.map(d => d.data());
    movimientos = movSnap.docs.map(d => d.data());

    const cfgDoc = cfgSnap.docs.find(d => d.id === 'main');
    if (cfgDoc) {
      const data = cfgDoc.data();
      gastosFijos = data.gastosFijos || [];
      config = { ...config, ...data };
      delete config.gastosFijos;
    }

    dbReady = true;
    setDbStatus('connected', `✓ Firebase conectado`);
    applyUserProfile();
    navigate(currentPage);
  } catch (e) {
    console.error('loadAll error', e);
    setDbStatus('error', '✗ Error de conexión con Firebase');
    document.getElementById('mainContent').innerHTML = `
      <div class="card mt-4">
        <div class="section-title mb-2" style="color:var(--danger)">Error de conexión</div>
        <p class="text-sm text-muted">Revisá firebase-config.js y que Firestore esté habilitado.</p>
        <button class="btn btn-primary mt-3" onclick="location.reload()">Reintentar</button>
      </div>`;
  }
}

// ── CALCULATIONS ──────────────────────────────────────────
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
  const comisionMonto = precioSugerido * ((config.comisionPct || 0) / 100);
  const gananciaNeta = precioSugerido - costoMateriales - costoOperativo - comisionMonto;

  return {
    costoMateriales,
    costoOperativo,
    costoBase,
    margen,
    precioSugerido,
    comisionMonto,
    gananciaNeta
  };
}

function calcularConPrecioReal(precioReal) {
  const comisionMonto = precioReal * ((config.comisionPct || 0) / 100);
  const gananciaNeta = precioReal - comisionMonto;
  return { comisionMonto, gananciaNeta };
}

// ── NAVIGATION ────────────────────────────────────────────
let currentPage = 'dashboard';

const pageTitles = {
  dashboard: 'Dashboard',
  insumos: 'Insumos',
  servicios: 'Servicios',
  caja: 'Caja',
  movimientos: 'Movimientos',
  arqueo: 'Arqueo de Caja',
  estadisticas: 'Estadísticas',
  config: 'Configuración'
};

const pageRenderers = {
  dashboard: renderDashboard,
  insumos: renderInsumos,
  servicios: renderServicios,
  caja: renderCaja,
  movimientos: renderMovimientos,
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
  const comisionHoy = pagosHoy.reduce((a, p) => a + (p.comisionMonto || 0), 0);
  const gananciaNetaHoy = pagosHoy.reduce((a, p) => a + (p.gananciaNeta || 0), 0);
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
  const gananciaNetaMes = pagosMes.reduce((a, p) => a + (p.gananciaNeta || 0), 0);

  const servicioCount = {};
  pagosMes.forEach(p => {
    if (p.servicioNombre) servicioCount[p.servicioNombre] = (servicioCount[p.servicioNombre] || 0) + 1;
  });
  const top3 = Object.entries(servicioCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const ultimos5 = [...pagos].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 5);

  const totalGastosMes = totalGastosFijosM();
  const gastosInsumosMes = movimientos
    .filter(m => m.tipo === 'compra' && new Date(m.fecha).getMonth() === mes && new Date(m.fecha).getFullYear() === anio)
    .reduce((a, m) => a + m.monto, 0);
  const otrosGastosMes = movimientos
    .filter(m => m.tipo === 'gasto' && new Date(m.fecha).getMonth() === mes && new Date(m.fecha).getFullYear() === anio)
    .reduce((a, m) => a + m.monto, 0);
  const egresosTotalesMes = comisionMes + totalGastosMes + gastosInsumosMes + otrosGastosMes;
  const resultadoMes = gananciaNetaMes - egresosTotalesMes;

  // ── Objetivos mensuales ──────────────────────────────────────
  // Punto de equilibrio: servicios para cubrir gastos fijos
  // Contribution = gananciaNeta + costoOperativo (precio - materiales - comision)
  let avgContrib = 0;
  if (pagosMes.length > 0) {
    avgContrib = pagosMes.reduce((a, p) => a + (p.gananciaNeta || 0) + (p.costoOperativo || 0), 0) / pagosMes.length;
  } else if (servicios.length > 0) {
    avgContrib = servicios.reduce((a, s) => {
      const c = calcularServicio(s);
      return a + c.gananciaNeta + c.costoOperativo;
    }, 0) / servicios.length;
  }
  const breakEvenCount = (avgContrib > 0 && totalGastosMes > 0) ? Math.ceil(totalGastosMes / avgContrib) : 0;
  const breakEvenRestantes = Math.max(0, breakEvenCount - pagosMes.length);
  const breakEvenAlcanzado = breakEvenCount > 0 && pagosMes.length >= breakEvenCount;

  // Salario objetivo manicurista
  const salarioObj = config.salarioObjetivoManicurista || 0;
  const salarioActualMes = pagosMes.reduce((a, p) => a + (p.comisionMonto || 0), 0);
  let turnosNecesarios = 0, turnosRestantes = 0;
  if (salarioObj > 0 && config.comisionPct > 0) {
    let avgCom = 0;
    if (pagosMes.length > 0) {
      avgCom = salarioActualMes / pagosMes.length;
    } else if (servicios.length > 0) {
      avgCom = servicios.reduce((a, s) => a + calcularServicio(s).comisionMonto, 0) / servicios.length;
    }
    turnosNecesarios = avgCom > 0 ? Math.ceil(salarioObj / avgCom) : 0;
    turnosRestantes = Math.max(0, turnosNecesarios - pagosMes.length);
  }
  const salarioPct = salarioObj > 0 ? Math.min(100, Math.round((salarioActualMes / salarioObj) * 100)) : 0;

  // Meta de servicios del mes
  const metaSvc = config.serviciosMes || 0;
  const svcRestantes = Math.max(0, metaSvc - pagosMes.length);
  const progPct = metaSvc > 0 ? Math.min(100, Math.round((pagosMes.length / metaSvc) * 100)) : 0;

  const objCardStyle = 'background:var(--bg2);border-radius:var(--radius);padding:16px;display:flex;flex-direction:column;gap:6px';

  function progBar(pct, color) {
    return `<div style="height:5px;background:var(--border);border-radius:3px;margin-top:6px">
      <div style="height:5px;background:${color};border-radius:3px;width:${pct}%;transition:width .3s"></div>
    </div>`;
  }

  document.getElementById('mainContent').innerHTML = `
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Ingresos de hoy</div>
      <div class="stat-value">$${fmt(totalHoy)}</div>
      <div class="stat-sub">${pagosHoy.length} servicio${pagosHoy.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Ganancia neta hoy</div>
      <div class="stat-value stat-up">$${fmt(gananciaNetaHoy)}</div>
      <div class="stat-sub">studio (sin comisiones)</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Comisión manicurista hoy</div>
      <div class="stat-value stat-down">$${fmt(comisionHoy)}</div>
      <div class="stat-sub">${config.comisionPct}% a Barbi</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Ingresos del mes</div>
      <div class="stat-value">$${fmt(totalMes)}</div>
      <div class="stat-sub">${pagosMes.length} servicios</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Ganancia studio este mes</div>
      <div class="stat-value stat-up">$${fmt(gananciaNetaMes)}</div>
      <div class="stat-sub">antes de egresos</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Resultado del mes</div>
      <div class="stat-value ${resultadoMes >= 0 ? 'stat-up' : 'stat-down'}">$${fmt(resultadoMes)}</div>
      <div class="stat-sub">${resultadoMes >= 0 ? 'Beneficio' : 'Pérdida'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Saldo en efectivo</div>
      <div class="stat-value">$${fmt(config.saldoEfectivo || 0)}</div>
      <div class="stat-sub">en caja</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Saldo en cuenta</div>
      <div class="stat-value">$${fmt(config.saldoCuenta || 0)}</div>
      <div class="stat-sub">banco</div>
    </div>
  </div>

  <div class="card mt-4">
    <div class="section-header" style="margin-bottom:12px">
      <div class="section-title">Objetivos del mes</div>
      <button class="btn btn-ghost btn-sm" onclick="navigate('config')">Configurar →</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px">

      <!-- Punto de equilibrio -->
      <div style="${objCardStyle}">
        <div style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">Punto de equilibrio</div>
        ${totalGastosMes === 0
          ? `<div style="font-size:13px;color:var(--text3)">Sin gastos fijos configurados</div>`
          : breakEvenCount === 0
          ? `<div style="font-size:13px;color:var(--text3)">Sin servicios para calcular</div>`
          : breakEvenAlcanzado
          ? `<div style="font-size:20px;font-weight:500;color:var(--success)">✓ Alcanzado</div>
             <div style="font-size:12px;color:var(--text3)">${pagosMes.length} / ${breakEvenCount} servicios — gastos cubiertos</div>
             ${progBar(100, 'var(--success)')}`
          : `<div style="font-size:20px;font-weight:500;color:var(--warn)">${breakEvenRestantes} turno${breakEvenRestantes !== 1 ? 's' : ''}</div>
             <div style="font-size:12px;color:var(--text3)">${pagosMes.length} / ${breakEvenCount} para cubrir $${fmt(totalGastosMes)} de gastos fijos</div>
             ${progBar(Math.round((pagosMes.length / breakEvenCount) * 100), 'var(--accent)')}`
        }
      </div>

      <!-- Salario manicurista -->
      <div style="${objCardStyle}">
        <div style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">Salario manicurista</div>
        ${config.comisionPct === 0
          ? `<div style="font-size:13px;color:var(--text3)">Configurá la comisión primero</div>`
          : salarioObj === 0
          ? `<div style="font-size:13px;color:var(--text3)">Sin objetivo configurado</div>
             <div style="font-size:11px;color:var(--text3);margin-top:2px">Ingresalo en Configuración</div>`
          : turnosNecesarios === 0
          ? `<div style="font-size:13px;color:var(--text3)">Sin datos suficientes</div>`
          : salarioActualMes >= salarioObj
          ? `<div style="font-size:20px;font-weight:500;color:var(--success)">✓ Meta alcanzada</div>
             <div style="font-size:12px;color:var(--text3)">$${fmt(salarioActualMes)} de $${fmt(salarioObj)}</div>
             ${progBar(100, 'var(--success)')}`
          : `<div style="font-size:20px;font-weight:500;color:var(--accent)">${turnosRestantes} turno${turnosRestantes !== 1 ? 's' : ''}</div>
             <div style="font-size:12px;color:var(--text3)">$${fmt(salarioActualMes)} de $${fmt(salarioObj)} objetivo</div>
             ${progBar(salarioPct, 'var(--accent)')}`
        }
      </div>

      <!-- Meta de servicios del mes -->
      <div style="${objCardStyle}">
        <div style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">Meta de servicios</div>
        <div style="font-size:20px;font-weight:500;color:var(--text)">${pagosMes.length} <span style="font-size:14px;color:var(--text3);font-weight:400">/ ${metaSvc}</span></div>
        <div style="font-size:12px;color:var(--text3)">${svcRestantes > 0 ? svcRestantes + ' servicio' + (svcRestantes !== 1 ? 's' : '') + ' restantes' : '✓ Meta alcanzada'}</div>
        ${progBar(progPct, progPct >= 100 ? 'var(--success)' : 'var(--accent)')}
      </div>

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
          <thead><tr><th>Servicio</th><th>Ganancia studio</th><th>Comisión</th><th>Total</th></tr></thead>
          <tbody>
            ${ultimos5.map(p => `<tr>
              <td>
                <div class="font-medium">${p.servicioNombre || 'Manual'}</div>
                <div class="text-xs text-hint">${new Date(p.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</div>
              </td>
              <td class="td-num text-success font-medium">$${fmt(p.gananciaNeta || 0)}</td>
              <td class="td-num text-danger">$${fmt(p.comisionMonto || 0)}</td>
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
      <button class="btn btn-secondary" onclick="navigate('movimientos');setTimeout(openNuevoMovimiento,80)">${iconPlus()} Nuevo movimiento</button>
      <button class="btn btn-secondary" onclick="navigate('insumos');setTimeout(openNuevoInsumo,80)">${iconPlus()} Nuevo insumo</button>
      <button class="btn btn-secondary" onclick="navigate('servicios');setTimeout(openNuevoServicio,80)">${iconPlus()} Nuevo servicio</button>
      <button class="btn btn-secondary" onclick="navigate('arqueo')">Ver arqueo</button>
      <button class="btn btn-secondary" onclick="navigate('config')">Configuración</button>
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════
//  INSUMOS (sin cambios, funciona bien)
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
//  SERVICIOS — FIX: DEEP COPY DE INGREDIENTES
// ════════════════════════════════════════════════════════════
let tempIngredientes = [];

function renderServicios() {
  document.getElementById('topbarActions').innerHTML = `
    <button class="btn btn-primary" onclick="openNuevoServicio()">${iconPlus()} Nuevo servicio</button>`;

  document.getElementById('mainContent').innerHTML = `
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">
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
            <div class="cost-breakdown" style="margin-top: 10px; margin-bottom: 0;">
              <div class="cost-section-label">Desglose de costos</div>
              <div class="cost-row"><span class="cost-label">Materiales</span><span>$${fmt(c.costoMateriales)}</span></div>
              <div class="cost-row"><span class="cost-label">Operativo</span><span>$${fmt(c.costoOperativo)}</span></div>
              <div class="cost-row subtotal"><span class="cost-label">Costo base</span><span class="font-medium">$${fmt(c.costoBase)}</span></div>
              <div class="cost-row"><span class="cost-label">Margen ${config.margenGanancia}%</span><span>$${fmt(c.margen)}</span></div>
              <div class="cost-row total"><span class="cost-label">Precio cobrado</span><span class="cost-val">$${fmt(c.precioSugerido)}</span></div>
              ${config.comisionPct > 0 ? `
              <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--accent2);">
                <div class="cost-section-label">Distribución</div>
                <div class="cost-row"><span class="cost-label text-danger">Comisión manicurista (${config.comisionPct}%)</span><span class="text-danger">— $${fmt(c.comisionMonto)}</span></div>
                <div class="cost-row"><span class="cost-label text-success">Ganancia studio</span><span class="text-success font-medium">$${fmt(c.gananciaNeta)}</span></div>
              </div>` : ''}
            </div>
          </div>`;
        }).join('')
    }
  </div>`;
}

window.openNuevoServicio = function (id) {
  const s = id ? servicios.find(sv => sv.id === id) : null;
  // FIX: Deep copy de ingredientes para evitar mutaciones
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
        onchange="setIngInsumo(${i},this.value)">
        <option value="">Seleccionar insumo…</option>
        ${insumos.map(x => `<option value="${x.id}" ${x.id === ing.insumoId ? 'selected' : ''}>${x.nombre} (${x.unidad})</option>`).join('')}
      </select>
      <input type="number" class="form-input" style="width:76px;font-size:13px"
        value="${ing.cantidad || ''}" placeholder="Cant."
        oninput="setIngCant(${i},this.value)">
      <div class="cost-tag">$${fmtDec(cost)}</div>
      <button class="btn btn-ghost btn-sm" onclick="removeIng(${i})">
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  }).join('');
  updateSvcPreview();
}

window.setIngInsumo = function (i, val) { tempIngredientes[i].insumoId = val; renderIngList(); };
window.setIngCant = function (i, val) { tempIngredientes[i].cantidad = parseFloat(val) || 0; renderIngList(); };
window.removeIng = function (i) { tempIngredientes.splice(i, 1); renderIngList(); };

function updateSvcPreview() {
  const el = document.getElementById('svc-preview');
  if (!el) return;
  const c = calcularServicio({ ingredientes: tempIngredientes });
  if (c.costoBase <= 0) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="cost-breakdown">
    <div class="cost-section-label">Cálculo en tiempo real</div>
    <div class="cost-row"><span class="cost-label">Materiales</span><span>$${fmt(c.costoMateriales)}</span></div>
    <div class="cost-row"><span class="cost-label">Operativo</span><span>$${fmt(c.costoOperativo)}</span></div>
    <div class="cost-row subtotal"><span class="cost-label">Costo base</span><span>$${fmt(c.costoBase)}</span></div>
    <div class="cost-row"><span class="cost-label">Margen ${config.margenGanancia}%</span><span>$${fmt(c.margen)}</span></div>
    <div class="cost-row total"><span class="cost-label">Precio sugerido</span><span class="cost-val">$${fmt(c.precioSugerido)}</span></div>
    ${config.comisionPct > 0 ? `
    <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--accent2);">
      <div class="cost-row"><span class="cost-label text-danger">Comisión manicurista ${config.comisionPct}%</span><span class="text-danger">— $${fmt(c.comisionMonto)}</span></div>
      <div class="cost-row"><span class="cost-label text-success">Ganancia studio</span><span class="text-success font-medium">$${fmt(c.gananciaNeta)}</span></div>
    </div>
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
//  CAJA — PAGOS (con desglose completo)
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
  const totalGananciaNeta = filtrados.reduce((a, p) => a + (p.gananciaNeta || 0), 0);

  document.getElementById('mainContent').innerHTML = `
  <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
    <div class="stat-card"><div class="stat-label">Total ingresos</div><div class="stat-value">$${fmt(totalGen)}</div><div class="stat-sub">${filtrados.length} servicios</div></div>
    <div class="stat-card"><div class="stat-label">Ganancia studio</div><div class="stat-value stat-up">$${fmt(totalGananciaNeta)}</div></div>
    <div class="stat-card"><div class="stat-label">Comisión manicurista</div><div class="stat-value stat-down">$${fmt(totalComision)}</div></div>
    <div class="stat-card"><div class="stat-label">Efectivo</div><div class="stat-value">$${fmt(totalEf)}</div></div>
    <div class="stat-card"><div class="stat-label">Transferencias</div><div class="stat-value">$${fmt(totalTr)}</div></div>
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
          <thead><tr><th>Fecha</th><th>Servicio</th><th>Cliente</th><th>Materiales</th><th>Operativo</th><th>Comisión</th><th>Ganancia studio</th><th>Total</th><th>Forma</th><th></th></tr></thead>
          <tbody>
            ${filtrados.map(p => `<tr>
              <td class="td-muted text-sm" style="white-space:nowrap">${new Date(p.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
              <td class="font-medium">${p.servicioNombre || 'Manual'}</td>
              <td class="td-muted">${p.clienteNombre || '—'}</td>
              <td class="td-num text-sm">$${fmt(p.costoMateriales || 0)}</td>
              <td class="td-num text-sm">$${fmt(p.costoOperativo || 0)}</td>
              <td class="td-num text-danger text-sm">$${fmt(p.comisionMonto || 0)}</td>
              <td class="td-num text-success font-medium">$${fmt(p.gananciaNeta || 0)}</td>
              <td class="td-num font-medium">$${fmt(p.total)}</td>
              <td><span class="pago-chip pago-${p.forma}">${p.forma === 'efectivo' ? 'Efectivo' : p.forma === 'transferencia' ? 'Transfer.' : 'Mixto'}</span></td>
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
    <div id="ps-row" style="display:none" class="cost-breakdown mb-3">
      <div class="cost-section-label">Cálculo sugerido del servicio</div>
      <div class="cost-row"><span class="cost-label">Materiales</span><span id="ps-mat">$0</span></div>
      <div class="cost-row"><span class="cost-label">Operativo</span><span id="ps-op">$0</span></div>
      <div class="cost-row"><span class="cost-label">Comisión (${config.comisionPct}%)</span><span id="ps-com" class="text-danger">$0</span></div>
      <div class="cost-row total"><span class="cost-label">Precio sugerido</span><span id="ps-val" class="cost-val">$0</span></div>
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
        <span class="cost-label text-danger">Comisión manicurista</span>
        <span id="pago-comision-val" class="text-danger"></span>
      </div>
      <div id="pago-neto-row" style="display:none" class="cost-row">
        <span class="cost-label text-success">Ganancia studio</span>
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
  if (val) {
    const s = servicios.find(x => x.id === val);
    if (s) {
      const c = calcularServicio(s);
      row.style.display = 'block';
      document.getElementById('ps-mat').textContent = '$' + fmt(c.costoMateriales);
      document.getElementById('ps-op').textContent = '$' + fmt(c.costoOperativo);
      document.getElementById('ps-com').textContent = '$' + fmt(c.comisionMonto);
      document.getElementById('ps-val').textContent = '$' + fmt(c.precioSugerido);
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
      const { comisionMonto } = calcularConPrecioReal(total);
      const gananciaNeta = total - comisionMonto;
      document.getElementById('pago-comision-row').style.display = 'flex';
      document.getElementById('pago-neto-row').style.display = 'flex';
      document.getElementById('pago-comision-val').textContent = '— $' + fmt(comisionMonto);
      document.getElementById('pago-neto-val').textContent = '$' + fmt(gananciaNeta);
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
  const calc = svc ? calcularServicio(svc) : { costoMateriales: 0, costoOperativo: 0, comisionMonto: 0, gananciaNeta: total };
  
  // Si es manual (sin servicio), calcular solo comisión
  const comisionMonto = config.comisionPct > 0 ? total * (config.comisionPct / 100) : 0;
  const gananciaNeta = svc ? calc.gananciaNeta : total - comisionMonto;

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
    costoMateriales: calc.costoMateriales || 0,
    costoOperativo: calc.costoOperativo || 0,
    comisionMonto,
    gananciaNeta
  };

  await saveDoc('pagos', obj);
  pagos.push(obj);

  // Actualizar saldo en caja
  if (ef > 0) config.saldoEfectivo = (config.saldoEfectivo || 0) + ef;
  if (tr > 0) config.saldoCuenta = (config.saldoCuenta || 0) + tr;
  await saveConfig();

  closeModal();
  renderCaja();
  toast('Pago registrado');
};

window.deletePago = async function (id) {
  if (!confirm('¿Eliminar este registro?')) return;
  const pago = pagos.find(p => p.id === id);
  if (pago) {
    if (pago.efectivo) config.saldoEfectivo = Math.max(0, (config.saldoEfectivo || 0) - pago.efectivo);
    if (pago.transferencia) config.saldoCuenta = Math.max(0, (config.saldoCuenta || 0) - pago.transferencia);
    await saveConfig();
  }
  await deleteFireDoc('pagos', id);
  pagos = pagos.filter(p => p.id !== id);
  renderCaja();
  toast('Registro eliminado');
};

// ════════════════════════════════════════════════════════════
//  MOVIMIENTOS — NUEVO MÓDULO
// ════════════════════════════════════════════════════════════
function renderMovimientos() {
  document.getElementById('topbarActions').innerHTML = `
    <button class="btn btn-primary" onclick="openNuevoMovimiento()">${iconPlus()} Nuevo movimiento</button>`;

  const filtrados = movimientos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const compras = filtrados.filter(m => m.tipo === 'compra').reduce((a, m) => a + m.monto, 0);
  const gastos = filtrados.filter(m => m.tipo === 'gasto').reduce((a, m) => a + m.monto, 0);
  const transfers = filtrados.filter(m => m.tipo === 'transfer');

  document.getElementById('mainContent').innerHTML = `
  <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
    <div class="stat-card"><div class="stat-label">Total compras insumos</div><div class="stat-value stat-down">— $${fmt(compras)}</div></div>
    <div class="stat-card"><div class="stat-label">Total gastos</div><div class="stat-value stat-down">— $${fmt(gastos)}</div></div>
  </div>
  <div class="card">
    <div style="margin-bottom: 16px;">
      <button class="btn btn-secondary btn-sm" onclick="openNuevoMovimiento('compra')">Compra de insumos</button>
      <button class="btn btn-secondary btn-sm" onclick="openNuevoMovimiento('gasto')">Gasto operativo</button>
      <button class="btn btn-secondary btn-sm" onclick="openNuevoMovimiento('transfer')">Transferencia interna</button>
    </div>
    ${filtrados.length === 0
      ? `<div class="empty"><h3>Sin movimientos</h3><p>Registrá compras, gastos o transferencias</p></div>`
      : `<div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Monto</th><th>Notas</th><th></th></tr></thead>
          <tbody>
            ${filtrados.map(m => {
              let icono = '💰', color = 'text-muted';
              if (m.tipo === 'compra') { icono = '📦'; color = 'text-danger'; }
              else if (m.tipo === 'gasto') { icono = '🔌'; color = 'text-danger'; }
              else if (m.tipo === 'transfer') { icono = '↔️'; }
              return `<tr>
                <td class="td-muted text-sm">${new Date(m.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</td>
                <td><span class="badge ${color === 'text-danger' ? 'badge-danger' : 'badge-neutral'}">${icono} ${m.tipo}</span></td>
                <td class="font-medium">${m.descripcion}</td>
                <td class="td-num font-medium ${color}">— $${fmt(m.monto)}</td>
                <td class="td-muted text-sm">${m.notas || '—'}</td>
                <td><button class="btn btn-danger btn-sm" onclick="deleteMovimiento('${m.id}')">${iconTrash()}</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>`
    }
  </div>`;
}

window.openNuevoMovimiento = function (tipo) {
  openModal(`
  <div class="modal-header">
    <div class="modal-title">${tipo === 'compra' ? 'Compra de insumos' : tipo === 'gasto' ? 'Gasto operativo' : 'Transferencia interna'}</div>
    ${modalCloseBtn()}
  </div>
  <div class="modal-body">
    ${tipo ? '' : `
    <div class="form-group">
      <label class="form-label">Tipo de movimiento *</label>
      <select class="form-input form-select" id="mov-tipo">
        <option value="">— Seleccionar —</option>
        <option value="compra">Compra de insumos</option>
        <option value="gasto">Gasto operativo</option>
        <option value="transfer">Transferencia interna</option>
      </select>
    </div>
    `}
    <div class="form-group">
      <label class="form-label">Descripción *</label>
      <input class="form-input" id="mov-desc" placeholder="Ej: Compra de geles en ByFama">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Monto ($) *</label>
        <input class="form-input" type="number" id="mov-monto" placeholder="0">
      </div>
      <div class="form-group">
        <label class="form-label">Fecha</label>
        <input type="date" class="form-input" id="mov-fecha" value="${new Date().toISOString().slice(0, 10)}">
      </div>
    </div>
    ${tipo === 'transfer' ? `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">De (origen) *</label>
        <select class="form-input form-select" id="mov-desde">
          <option value="">— Seleccionar —</option>
          <option value="efectivo">Efectivo</option>
          <option value="cuenta">Cuenta bancaria</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">A (destino) *</label>
        <select class="form-input form-select" id="mov-hacia">
          <option value="">— Seleccionar —</option>
          <option value="efectivo">Efectivo</option>
          <option value="cuenta">Cuenta bancaria</option>
        </select>
      </div>
    </div>
    ` : ''}
    <div class="form-group">
      <label class="form-label">Notas (opcional)</label>
      <input class="form-input" id="mov-notas" placeholder="Observaciones">
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="saveMovimiento('${tipo || ''}')">${tipo ? 'Registrar' : 'Guardar'}</button>
  </div>`);
};

window.saveMovimiento = async function (tipoFijo) {
  const tipo = tipoFijo || document.getElementById('mov-tipo').value;
  const desc = document.getElementById('mov-desc').value.trim();
  const monto = parseFloat(document.getElementById('mov-monto').value);
  const fecha = document.getElementById('mov-fecha').value;

  if (!tipo || !desc || !monto) { toast('Completá los campos obligatorios', 'error'); return; }

  const obj = {
    id: uid(), tipo, descripcion: desc, monto, fecha: fecha + 'T00:00:00',
    notas: document.getElementById('mov-notas')?.value.trim() || ''
  };

  if (tipo === 'transfer') {
    const desde = document.getElementById('mov-desde').value;
    const hacia = document.getElementById('mov-hacia').value;
    if (!desde || !hacia || desde === hacia) { toast('Selecciona origen y destino diferente', 'error'); return; }
    obj.desde = desde;
    obj.hacia = hacia;
    // Actualizar saldos
    if (desde === 'efectivo') config.saldoEfectivo = Math.max(0, (config.saldoEfectivo || 0) - monto);
    else config.saldoCuenta = Math.max(0, (config.saldoCuenta || 0) - monto);
    if (hacia === 'efectivo') config.saldoEfectivo = (config.saldoEfectivo || 0) + monto;
    else config.saldoCuenta = (config.saldoCuenta || 0) + monto;
  } else if (tipo === 'compra' || tipo === 'gasto') {
    config.saldoEfectivo = Math.max(0, (config.saldoEfectivo || 0) - monto);
  }

  await saveDoc('movimientos', obj);
  await saveConfig();
  movimientos.push(obj);
  closeModal();
  renderMovimientos();
  toast('Movimiento registrado');
};

window.deleteMovimiento = async function (id) {
  if (!confirm('¿Eliminar este movimiento?')) return;
  const mov = movimientos.find(m => m.id === id);
  if (mov && mov.tipo === 'transfer') {
    // Reversar transferencia
    if (mov.desde === 'efectivo') config.saldoEfectivo = (config.saldoEfectivo || 0) + mov.monto;
    else config.saldoCuenta = (config.saldoCuenta || 0) + mov.monto;
    if (mov.hacia === 'efectivo') config.saldoEfectivo = Math.max(0, (config.saldoEfectivo || 0) - mov.monto);
    else config.saldoCuenta = Math.max(0, (config.saldoCuenta || 0) - mov.monto);
    await saveConfig();
  }
  await deleteFireDoc('movimientos', id);
  movimientos = movimientos.filter(m => m.id !== id);
  renderMovimientos();
  toast('Movimiento eliminado');
};

// ════════════════════════════════════════════════════════════
//  ARQUEO
// ════════════════════════════════════════════════════════════
function renderArqueo() {
  document.getElementById('topbarActions').innerHTML = `
    <button class="btn btn-secondary" onclick="exportarJSON()">${iconDownload()} Exportar JSON</button>`;

  const mes = new Date().getMonth();
  const anio = new Date().getFullYear();

  const mesPagos = pagos.filter(p => {
    const d = new Date(p.fecha);
    return d.getMonth() === mes && d.getFullYear() === anio;
  });

  const totalIngresos = mesPagos.reduce((a, p) => a + p.total, 0);
  const efMes = mesPagos.reduce((a, p) => a + (p.efectivo || 0), 0);
  const trMes = mesPagos.reduce((a, p) => a + (p.transferencia || 0), 0);

  const comisionMes = mesPagos.reduce((a, p) => a + (p.comisionMonto || 0), 0);
  const gananciaNetaMes = mesPagos.reduce((a, p) => a + (p.gananciaNeta || 0), 0);

  const mesMov = movimientos.filter(m => {
    const d = new Date(m.fecha);
    return d.getMonth() === mes && d.getFullYear() === anio;
  });

  const comprasMes = mesMov.filter(m => m.tipo === 'compra').reduce((a, m) => a + m.monto, 0);
  const gastosMes = mesMov.filter(m => m.tipo === 'gasto').reduce((a, m) => a + m.monto, 0);
  const gastosFijosMes = totalGastosFijosM();

  const egresosTotales = comisionMes + comprasMes + gastosMes + gastosFijosMes;
  const resultadoFinal = gananciaNetaMes - egresosTotales;

  document.getElementById('mainContent').innerHTML = `
  <div class="grid-2">
    <div class="card">
      <div class="section-title mb-3">Ingresos del mes</div>
      <div class="cost-breakdown">
        <div class="cost-row"><span class="cost-label">Efectivo</span><span>$${fmt(efMes)}</span></div>
        <div class="cost-row"><span class="cost-label">Transferencias</span><span>$${fmt(trMes)}</span></div>
        <div class="cost-row total"><span class="cost-label">Total facturado</span><span class="cost-val">$${fmt(totalIngresos)}</span></div>
      </div>
      <div class="mt-3">
        <div class="text-sm font-medium mb-2">Balance de caja actual</div>
        <div class="ingredient-row mb-2">
          <div class="flex1">Efectivo en caja</div>
          <div class="cost-tag font-medium">$${fmt(config.saldoEfectivo || 0)}</div>
        </div>
        <div class="ingredient-row">
          <div class="flex1">Saldo en cuenta</div>
          <div class="cost-tag font-medium">$${fmt(config.saldoCuenta || 0)}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="section-title mb-3">Egresos del mes</div>
      <div class="cost-breakdown">
        <div class="cost-section-label">Distribución</div>
        ${config.comisionPct > 0 ? `<div class="cost-row"><span class="cost-label">Comisión manicurista (${config.comisionPct}%)</span><span class="text-danger">— $${fmt(comisionMes)}</span></div>` : ''}
        <div class="cost-row"><span class="cost-label">Compra de insumos</span><span class="text-danger">— $${fmt(comprasMes)}</span></div>
        <div class="cost-row"><span class="cost-label">Gastos operativos varios</span><span class="text-danger">— $${fmt(gastosMes)}</span></div>
        <div class="cost-row"><span class="cost-label">Gastos fijos mensuales</span><span class="text-danger">— $${fmt(gastosFijosMes)}</span></div>
        <div class="cost-row total"><span class="cost-label">Total egresos</span><span class="cost-val" style="color:var(--danger)">— $${fmt(egresosTotales)}</span></div>
      </div>
    </div>
  </div>

  <div class="card mt-4">
    <div class="section-title mb-3">Resultado final del mes</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div style="background:var(--success-bg);border-radius:var(--border-radius);padding:1rem;border-left:3px solid var(--success)">
        <div class="text-xs text-success font-medium mb-2">INGRESOS</div>
        <div style="font-size:24px;font-weight:500;color:var(--success)">+$${fmt(totalIngresos)}</div>
      </div>
      <div style="background:var(--danger-bg);border-radius:var(--border-radius);padding:1rem;border-left:3px solid var(--danger)">
        <div class="text-xs text-danger font-medium mb-2">EGRESOS</div>
        <div style="font-size:24px;font-weight:500;color:var(--danger)">— $${fmt(egresosTotales)}</div>
      </div>
    </div>
    <div style="background:${resultadoFinal >= 0 ? 'var(--success-bg)' : 'var(--danger-bg)'};border-radius:var(--border-radius);padding:1.5rem;margin-top:16px;border-left:4px solid ${resultadoFinal >= 0 ? 'var(--success)' : 'var(--danger)'}">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:${resultadoFinal >= 0 ? 'var(--success)' : 'var(--danger)'};margin-bottom:8px;font-weight:500">Resultado neto</div>
      <div style="font-size:32px;font-weight:500;color:${resultadoFinal >= 0 ? 'var(--success)' : 'var(--danger)'}">${resultadoFinal >= 0 ? '+' : '— '}$${fmt(Math.abs(resultadoFinal))}</div>
      <div style="font-size:13px;color:${resultadoFinal >= 0 ? 'var(--success)' : 'var(--danger)'};margin-top:4px">${resultadoFinal >= 0 ? '✓ Ganancia' : '✗ Pérdida'}</div>
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════
//  ESTADÍSTICAS (mejoradas)
// ════════════════════════════════════════════════════════════
function renderEstadisticas() {
  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    const m = d.getMonth(), a = d.getFullYear();
    const ps = pagos.filter(p => { const pd = new Date(p.fecha); return pd.getMonth() === m && pd.getFullYear() === a; });
    const total = ps.reduce((s, p) => s + p.total, 0);
    const comision = ps.reduce((s, p) => s + (p.comisionMonto || 0), 0);
    const ganancia = ps.reduce((s, p) => s + (p.gananciaNeta || 0), 0);
    meses.push({
      label: d.toLocaleDateString('es-AR', { month: 'short' }),
      total, comision, ganancia, count: ps.length
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
      <div class="section-title mb-3">Distribución de pagos</div>
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
        </div>
      </div>
    </div>
    <div class="card">
      <div class="section-title mb-3">Métricas</div>
      <div class="stats-grid" style="grid-template-columns:1fr 1fr">
        <div class="stat-card"><div class="stat-label">Insumos</div><div class="stat-value">${insumos.length}</div></div>
        <div class="stat-card"><div class="stat-label">Servicios</div><div class="stat-value">${servicios.length}</div></div>
        <div class="stat-card"><div class="stat-label">Pagos totales</div><div class="stat-value">${pagos.length}</div></div>
        <div class="stat-card"><div class="stat-label">Gastos fijos</div><div class="stat-value">${gastosFijos.length}</div></div>
      </div>
      <div class="cost-breakdown mt-3">
        <div class="cost-row"><span class="cost-label">Costo operativo/servicio</span><span>$${fmt(costoOperativoPorServicio())}</span></div>
        <div class="cost-row"><span class="cost-label">Ticket promedio</span><span>$${fmt(pagos.length ? pagos.reduce((a, p) => a + p.total, 0) / pagos.length : 0)}</span></div>
      </div>
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════
//  CONFIGURACIÓN (con nuevos campos)
// ════════════════════════════════════════════════════════════
function renderConfigPage() {
  document.getElementById('mainContent').innerHTML = `
  <div class="grid-2">
    <div class="card">
      <div class="section-title mb-3">Configuración de costos</div>
      <div class="form-group">
        <label class="form-label">Servicios disponibles por mes</label>
        <input class="form-input" type="number" id="cfg-svcmes" value="${config.serviciosMes}" placeholder="80">
      </div>
      <div class="form-group">
        <label class="form-label">Margen de ganancia (%)</label>
        <input class="form-input" type="number" id="cfg-margen" value="${config.margenGanancia}" min="0" max="500">
      </div>
      <div class="form-group">
        <label class="form-label">Comisión manicurista (% del precio final)</label>
        <input class="form-input" type="number" id="cfg-comision" value="${config.comisionPct || 0}" min="0" max="100">
      </div>
      <div class="form-group">
        <label class="form-label">Salario objetivo manicurista ($/mes)</label>
        <input class="form-input" type="number" id="cfg-salario-obj" value="${config.salarioObjetivoManicurista || 0}" placeholder="0">
        <div class="form-hint">Usado para calcular cuántos turnos faltan para llegar a la meta</div>
      </div>
      <div class="calc-display">
        Costo operativo por servicio: <strong>$${fmt(costoOperativoPorServicio())}</strong>
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
      <div class="calc-display mt-3">
        Total gastos fijos: <strong>$${fmt(totalGastosFijosM())}</strong>
      </div>
    </div>
  </div>

  <div class="card mt-4">
    <div class="section-title mb-3">Balance de caja (manual)</div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Saldo en efectivo ($)</label>
        <input class="form-input" type="number" id="cfg-saldo-ef" value="${config.saldoEfectivo || 0}" placeholder="0">
        <div class="form-hint">Dinero en caja física</div>
      </div>
      <div class="form-group">
        <label class="form-label">Saldo en cuenta ($)</label>
        <input class="form-input" type="number" id="cfg-saldo-ct" value="${config.saldoCuenta || 0}" placeholder="0">
        <div class="form-hint">Dinero en el banco</div>
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
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-secondary" onclick="exportarJSON()">${iconDownload()} Exportar JSON</button>
      <label class="btn btn-secondary" style="cursor:pointer">
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Importar JSON
        <input type="file" accept=".json" style="display:none" onchange="importarJSON(event)">
      </label>
    </div>
  </div>

  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
    <button class="btn btn-secondary" onclick="location.reload()">Descartar cambios</button>
    <button class="btn btn-primary" onclick="saveConfigPage()">Guardar configuración</button>
  </div>`;
}

function renderGastosFijosList() {
  if (gastosFijos.length === 0) {
    return '<p class="text-sm text-hint mb-2">Sin gastos fijos cargados. Agregá alquiler, luz, internet, etc.</p>';
  }
  return gastosFijos.map((g, i) => `
    <div class="gasto-row">
      <input class="form-input flex1" value="${g.nombre}" placeholder="Nombre del gasto"
        oninput="setGastoNombre(${i},this.value)">
      <input class="form-input" type="number" value="${g.monto}" placeholder="Monto $"
        style="width:110px" oninput="setGastoMonto(${i},this.value)">
      <button class="btn btn-danger btn-sm" onclick="removeGastoFijo(${i})">${iconTrash()}</button>
    </div>`).join('');
}

window.setGastoNombre = function (i, val) { gastosFijos[i].nombre = val; };
window.setGastoMonto = function (i, val) { gastosFijos[i].monto = parseFloat(val) || 0; };

window.addGastoFijo = function () {
  gastosFijos.push({ id: uid(), nombre: '', monto: 0 });
  document.getElementById('gastos-list').innerHTML = renderGastosFijosList();
};

window.removeGastoFijo = function (i) {
  gastosFijos.splice(i, 1);
  document.getElementById('gastos-list').innerHTML = renderGastosFijosList();
};

window.saveConfigPage = async function () {
  config.serviciosMes = parseFloat(document.getElementById('cfg-svcmes').value) || 1;
  config.margenGanancia = parseFloat(document.getElementById('cfg-margen').value) || 0;
  config.comisionPct = parseFloat(document.getElementById('cfg-comision').value) || 0;
  config.salarioObjetivoManicurista = parseFloat(document.getElementById('cfg-salario-obj').value) || 0;
  config.saldoEfectivo = parseFloat(document.getElementById('cfg-saldo-ef').value) || 0;
  config.saldoCuenta = parseFloat(document.getElementById('cfg-saldo-ct').value) || 0;
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
  const data = { insumos, servicios, pagos, gastosFijos, movimientos, config, exportedAt: new Date().toISOString() };
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
      if (data.movimientos) {
        data.movimientos.forEach(obj => batch.set(docRef('movimientos', obj.id), obj));
        movimientos = data.movimientos;
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
window.renderIngList = renderIngList;
window.tempIngredientes = tempIngredientes;

// ── INIT ──────────────────────────────────────────────────
loadAll();
