// ══════════════════════════════════════════════════════════
//  BARBI — utils.js
//  Utilidades compartidas entre módulos
// ══════════════════════════════════════════════════════════

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const fmt = (n) => (Math.round(n) || 0).toLocaleString('es-AR');
export const fmtDec = (n) => (Math.round(n * 10) / 10).toFixed(1);

export function fmtFecha(isoStr, opts = {}) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d)) return '—';
  const defaults = { day: '2-digit', month: '2-digit', year: 'numeric' };
  return d.toLocaleDateString('es-AR', { ...defaults, ...opts });
}

export function fmtFechaHora(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export function fmtHora(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d)) return '—';
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export function diasDesde(isoStr) {
  if (!isoStr) return Infinity;
  const d = new Date(isoStr);
  const hoy = new Date();
  return Math.floor((hoy - d) / 86400000);
}

export function toast(msg, type = 'success') {
  const tc = document.getElementById('toastContainer');
  if (!tc) return;
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

export function openModal(html, lg = false) {
  document.getElementById('modalContainer').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal${lg ? ' modal-lg' : ''}">${html}</div>
    </div>`;
}

export function closeModal() {
  document.getElementById('modalContainer').innerHTML = '';
}

export function modalCloseBtn() {
  return `<button class="modal-close" onclick="closeModal()">
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg></button>`;
}

export const iconEdit = () =>
  `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

export const iconTrash = () =>
  `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>`;

export const iconPlus = () =>
  `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

export const iconCheck = () =>
  `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polyline points="20,6 9,17 4,12"/></svg>`;

export const iconWhatsapp = () =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M11.999 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.985-1.31A9.945 9.945 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.946 7.946 0 0 1-4.073-1.118l-.292-.173-3.017.791.806-2.946-.19-.303A7.944 7.944 0 0 1 4 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/></svg>`;

export const ESTADO_LABELS = {
  pendiente:    { label: 'Pendiente',    cls: 'badge-warn'    },
  confirmado:   { label: 'Confirmado',   cls: 'badge-success' },
  cancelado:    { label: 'Cancelado',    cls: 'badge-danger'  },
  reagendado:   { label: 'Reagendado',  cls: 'badge-info'    },
  completado:   { label: 'Completado',  cls: 'badge-neutral' },
  no_confirmado:{ label: 'Sin confirmar',cls: 'badge-warn'    },
};

export function estadoBadge(estado) {
  const e = ESTADO_LABELS[estado] || { label: estado, cls: 'badge-neutral' };
  return `<span class="badge ${e.cls}">${e.label}</span>`;
}

export function segmentoCliente(cliente) {
  const totalGastado = cliente.totalGastado || 0;
  const diasUltimo = diasDesde(cliente.ultimoTurnoFecha);
  const totalTurnos = cliente.estadisticas?.totalTurnos || 0;

  if (totalGastado >= 50000) return { label: 'VIP', cls: 'seg-vip' };
  if (diasUltimo > 60)       return { label: 'Dormida', cls: 'seg-dormida' };
  if (totalTurnos <= 2 && diasDesde(cliente.fechaCreacion) < 90)
                             return { label: 'Nueva', cls: 'seg-nueva' };
  return                            { label: 'Frecuente', cls: 'seg-frecuente' };
}
