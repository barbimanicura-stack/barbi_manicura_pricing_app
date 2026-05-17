// ══════════════════════════════════════════════════════════
//  BARBI — whatsapp-service.js
//  Generación de mensajes y enlaces wa.me para turnos
// ══════════════════════════════════════════════════════════

import { config } from './store.js';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
               'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fmtFechaTurno(isoStr) {
  const d = new Date(isoStr);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

function fmtHoraTurno(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function fmt(n) {
  return (Math.round(n) || 0).toLocaleString('es-AR');
}

// ── Generadores de mensajes ───────────────────────────────

export function mensajeConfirmacion(turno, cliente) {
  const fecha  = fmtFechaTurno(turno.fecha);
  const hora   = fmtHoraTurno(turno.fecha);
  const nombre = cliente?.nombre?.split(' ')[0] || turno.clienteNombre?.split(' ')[0] || 'hola';
  const durStr = turno.duracion ? ` (${turno.duracion} min)` : '';
  const precioStr = turno.precioEstimado ? `\n💰 $${fmt(turno.precioEstimado)}` : '';

  return (
    `Hola ${nombre}! 💅\n\n` +
    `Tu turno está agendado para:\n` +
    `📅 ${fecha} a las ${hora}\n` +
    `✨ ${turno.servicio}${durStr}` +
    precioStr +
    `\n\n¿Confirmás asistencia? Respondé este mensaje con *Sí* o *No* 🙏`
  );
}

export function mensajeRecordatorio(turno, cliente, horasAntes = 24) {
  const fecha  = fmtFechaTurno(turno.fecha);
  const hora   = fmtHoraTurno(turno.fecha);
  const nombre = cliente?.nombre?.split(' ')[0] || turno.clienteNombre?.split(' ')[0] || 'hola';

  return (
    `Hola ${nombre}! ⏰\n\n` +
    `Te recuerdo que mañana tenés turno:\n` +
    `📅 ${fecha} a las ${hora}\n` +
    `✨ ${turno.servicio}\n\n` +
    `Si no podés venir, avisanos lo antes posible para reagendar 🙏`
  );
}

export function mensajeCancelacion(turno, cliente) {
  const nombre = cliente?.nombre?.split(' ')[0] || turno.clienteNombre?.split(' ')[0] || 'hola';
  return (
    `Hola ${nombre}! \n\n` +
    `Lamentablemente tuvimos que cancelar tu turno del ` +
    `${fmtFechaTurno(turno.fecha)} a las ${fmtHoraTurno(turno.fecha)}.\n\n` +
    `¿Querés reagendar para otro día? ¡Escribinos y lo coordinamos! 💕`
  );
}

export function mensajeReagendamiento(turnoNuevo, cliente) {
  const fecha  = fmtFechaTurno(turnoNuevo.fecha);
  const hora   = fmtHoraTurno(turnoNuevo.fecha);
  const nombre = cliente?.nombre?.split(' ')[0] || turnoNuevo.clienteNombre?.split(' ')[0] || 'hola';

  return (
    `Hola ${nombre}! 💅\n\n` +
    `Tu turno fue reagendado para:\n` +
    `📅 ${fecha} a las ${hora}\n` +
    `✨ ${turnoNuevo.servicio}\n\n` +
    `¿Confirmás el nuevo horario? 🙏`
  );
}

export function mensajeReactivacion(cliente) {
  const nombre = cliente?.nombre?.split(' ')[0] || 'hola';
  return (
    `Hola ${nombre}! Hace un tiempo que no te vemos por el estudio 💕\n\n` +
    `¿Te gustaría agendar un turno? Escribinos y coordinamos 💅✨`
  );
}

// ── Generador de enlaces wa.me ────────────────────────────

export function enlaceWa(telefono, mensaje) {
  const tel = telefono.replace(/\D/g, '');
  const enc = encodeURIComponent(mensaje);
  return `https://wa.me/${tel}?text=${enc}`;
}

export function enlaceWaConfirmacion(turno, cliente) {
  const msg = mensajeConfirmacion(turno, cliente);
  const tel = cliente?.telefono || turno.clienteTelefono || config.telefonoBarbi;
  return enlaceWa(tel, msg);
}

export function enlaceWaRecordatorio(turno, cliente, horasAntes = 24) {
  const msg = mensajeRecordatorio(turno, cliente, horasAntes);
  const tel = cliente?.telefono || turno.clienteTelefono;
  return enlaceWa(tel, msg);
}

// ── Template personalizable (desde config) ───────────────

export function getTemplateConfirmacion() {
  return config.templateConfirmacion || null;
}

export function aplicarTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

// ── Verificar si el turno necesita recordatorio ───────────

export function necesitaRecordatorio48h(turno) {
  if (!turno?.fecha) return false;
  if (turno.confirmacion?.recordatorio1Enviado) return false;
  if (['cancelado', 'completado'].includes(turno.estado)) return false;
  const diff = new Date(turno.fecha) - new Date();
  return diff > 0 && diff <= 48 * 3600 * 1000;
}

export function necesitaRecordatorio24h(turno) {
  if (!turno?.fecha) return false;
  if (turno.confirmacion?.recordatorio2Enviado) return false;
  if (['cancelado', 'completado'].includes(turno.estado)) return false;
  const diff = new Date(turno.fecha) - new Date();
  return diff > 0 && diff <= 24 * 3600 * 1000;
}
