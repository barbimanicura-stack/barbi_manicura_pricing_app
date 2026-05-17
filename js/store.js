// ══════════════════════════════════════════════════════════
//  BARBI — store.js
//  Estado compartido entre módulos. Todos los arrays son
//  mutados en-place (push/splice/length=0) para que las
//  referencias importadas en cada módulo sigan siendo válidas.
// ══════════════════════════════════════════════════════════

// ── Datos existentes ──────────────────────────────────────
export const insumos    = [];
export const servicios  = [];
export const pagos      = [];
export const movimientos = [];
export const gastosFijos = [];

export const config = {
  serviciosMes: 80,
  margenGanancia: 40,
  comisionPct: 0,
  userName: 'Barbi',
  userRole: 'Administradora',
  saldoEfectivo: 0,
  saldoCuenta: 0,
  salarioObjetivoManicurista: 0,
  categorias: ['Geles', 'Tips', 'Primers', 'Limas', 'Pinturas', 'Equipamiento', 'Otros'],
  telefonoBarbi: '',
  manychatToken: '',
  manychatPageId: '',
};

// ── Nuevos datos CRM ──────────────────────────────────────
export const clientes      = [];
export const turnos        = [];
export const disponibilidad = [];
