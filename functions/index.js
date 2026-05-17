// ══════════════════════════════════════════════════════════
//  BARBI — Firebase Cloud Functions
//  Webhook para recibir eventos de ManyChat y actualizarlos
//  en Firestore (disponible para la web en tiempo real).
//
//  Deploy: firebase deploy --only functions
//  Docs:   README-CRM.md
// ══════════════════════════════════════════════════════════

const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const cors      = require('cors')({ origin: true });

admin.initializeApp();
const db = admin.firestore();

const NS = 'barbi';
const col  = (name) => db.collection(NS).doc('data').collection(name);
const dref = (name, id) => col(name).doc(id);

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ── Auth token ────────────────────────────────────────────
function authOk(req) {
  const secret = functions.config().manychat?.webhook_secret || '';
  if (!secret) return true; // sin secret configurado, permitir (solo dev)
  return req.headers['x-barbi-secret'] === secret;
}

// ══════════════════════════════════════════════════════════
//  WEBHOOK PRINCIPAL
//  Recibe todos los eventos de ManyChat en un solo endpoint
// ══════════════════════════════════════════════════════════
exports.manychatWebhook = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!authOk(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = req.body;
    const type    = payload?.type;

    try {
      switch (type) {
        case 'new_booking':
          return res.json(await handleNuevoTurno(payload));
        case 'confirm_booking':
          return res.json(await handleConfirmarTurno(payload));
        case 'cancel_booking':
          return res.json(await handleCancelarTurno(payload));
        case 'reschedule_booking':
          return res.json(await handleReagendar(payload));
        default:
          return res.status(400).json({ error: `Tipo desconocido: ${type}` });
      }
    } catch (e) {
      console.error('Webhook error:', e);
      return res.status(500).json({ error: 'Error interno', detail: e.message });
    }
  });
});

// ══════════════════════════════════════════════════════════
//  HANDLER: Nuevo turno desde ManyChat
// ══════════════════════════════════════════════════════════
async function handleNuevoTurno(payload) {
  const { manychatUserId, clienteNombre, clienteTelefono, servicio, fechaPreferida, horarioPreferido, origen } = payload;

  // 1. Buscar o crear cliente
  let cliente = null;
  const cliSnap = await col('clientes')
    .where('telefono', '==', clienteTelefono)
    .limit(1).get();

  if (!cliSnap.empty) {
    cliente = { id: cliSnap.docs[0].id, ...cliSnap.docs[0].data() };
  } else {
    const ahora = new Date().toISOString();
    cliente = {
      id: uid(),
      nombre: clienteNombre,
      telefono: clienteTelefono,
      email: '',
      totalGastado: 0,
      estadisticas: { totalTurnos: 0, ticketPromedio: 0 },
      origenAgendamiento: origen || 'manychat',
      manychatId: manychatUserId || '',
      fechaCreacion: ahora,
      ultimaActualizacion: ahora
    };
    await dref('clientes', cliente.id).set(cliente);
  }

  // 2. Buscar disponibilidad (próximos 3 slots libres)
  const slots = await _buscarSlots(fechaPreferida, horarioPreferido, 3);

  if (slots.length === 0) {
    return {
      ok: false,
      action: 'no_availability',
      message: 'No hay turnos disponibles en las próximas 2 semanas.',
      clienteId: cliente.id
    };
  }

  // 3. Retornar slots para que ManyChat los muestre
  return {
    ok: true,
    action: 'offer_slots',
    clienteId: cliente.id,
    clienteNombre: cliente.nombre,
    servicio,
    slots: slots.map(s => ({
      fecha: s,
      label: _labelFecha(s)
    }))
  };
}

// ══════════════════════════════════════════════════════════
//  HANDLER: Confirmar turno (clienta elige slot)
// ══════════════════════════════════════════════════════════
async function handleConfirmarTurno(payload) {
  const { clienteId, turnoId, servicio, fecha, manychatUserId } = payload;

  if (turnoId) {
    // Turno ya existente — solo confirmar
    const t = await dref('turnos', turnoId).get();
    if (!t.exists) return { ok: false, error: 'Turno no encontrado' };

    await dref('turnos', turnoId).update({
      estado: 'confirmado',
      'confirmacion.confirmadoPor': 'manychat',
      'confirmacion.fechaConfirmacion': new Date().toISOString(),
      ultimaActualizacion: new Date().toISOString()
    });

    return { ok: true, action: 'confirmed', turnoId };
  }

  // Crear turno nuevo con el slot elegido
  const cliDoc = await dref('clientes', clienteId).get();
  if (!cliDoc.exists) return { ok: false, error: 'Cliente no encontrado' };
  const c = cliDoc.data();

  const ahora = new Date().toISOString();
  const turno = {
    id: uid(),
    clienteId,
    clienteNombre: c.nombre,
    clienteTelefono: c.telefono,
    servicio: servicio || 'Servicio agendado por ManyChat',
    servicioId: '',
    fecha: new Date(fecha).toISOString(),
    duracion: 90,
    precioEstimado: 0,
    estado: 'confirmado',
    manychatOrigin: true,
    manychatUserId: manychatUserId || '',
    confirmacion: {
      enviado: true,
      confirmadoPor: 'manychat',
      fechaConfirmacion: ahora,
      recordatorio1Enviado: false,
      recordatorio2Enviado: false
    },
    fechaCreacion: ahora,
    ultimaActualizacion: ahora,
    creadoPor: 'manychat'
  };

  await dref('turnos', turno.id).set(turno);

  return {
    ok: true,
    action: 'booked',
    turnoId: turno.id,
    fecha: turno.fecha,
    label: _labelFecha(turno.fecha)
  };
}

// ══════════════════════════════════════════════════════════
//  HANDLER: Cancelar turno
// ══════════════════════════════════════════════════════════
async function handleCancelarTurno(payload) {
  const { turnoId, razon } = payload;

  const t = await dref('turnos', turnoId).get();
  if (!t.exists) return { ok: false, error: 'Turno no encontrado' };

  await dref('turnos', turnoId).update({
    estado: 'cancelado',
    cancelacion: { razon: razon || '', fecha: new Date().toISOString() },
    ultimaActualizacion: new Date().toISOString()
  });

  // Ofrecer reagendamiento (próximos 3 slots)
  const turnoData = t.data();
  const slots = await _buscarSlots(null, null, 3);

  return {
    ok: true,
    action: 'cancelled',
    turnoId,
    slots: slots.map(s => ({ fecha: s, label: _labelFecha(s) })),
    servicio: turnoData.servicio
  };
}

// ══════════════════════════════════════════════════════════
//  HANDLER: Reagendar turno
// ══════════════════════════════════════════════════════════
async function handleReagendar(payload) {
  const { turnoId, nuevaFecha, clienteId, servicio } = payload;

  // Marcar el turno original como reagendado
  if (turnoId) {
    await dref('turnos', turnoId).update({
      estado: 'reagendado',
      ultimaActualizacion: new Date().toISOString()
    });
  }

  // Crear turno nuevo
  const result = await handleConfirmarTurno({
    clienteId,
    servicio,
    fecha: nuevaFecha,
    manychatUserId: payload.manychatUserId
  });

  return { ...result, action: 'rescheduled', turnoAnteriorId: turnoId };
}

// ══════════════════════════════════════════════════════════
//  SCHEDULED: Recordatorios automáticos (corre cada mañana)
// ══════════════════════════════════════════════════════════
exports.enviarRecordatorios = functions.pubsub
  .schedule('every day 08:00')
  .timeZone('America/Argentina/Buenos_Aires')
  .onRun(async (context) => {
    const ahora = new Date();
    const en24h = new Date(ahora.getTime() + 24 * 3600 * 1000);
    const en48h = new Date(ahora.getTime() + 48 * 3600 * 1000);

    const turnosSnap = await col('turnos')
      .where('estado', 'in', ['pendiente', 'confirmado'])
      .get();

    const batch = db.batch();
    let count = 0;

    turnosSnap.docs.forEach(d => {
      const t = d.data();
      const fecha = new Date(t.fecha);
      const diff  = fecha - ahora;

      if (diff <= 0) return;

      // Recordatorio 48h
      if (!t.confirmacion?.recordatorio1Enviado && diff <= 48 * 3600 * 1000 && diff > 24 * 3600 * 1000) {
        batch.update(d.ref, { 'confirmacion.recordatorio1Enviado': true, ultimaActualizacion: new Date().toISOString() });
        count++;
        // Aquí se llamaría a la API de ManyChat para enviar el mensaje
        // _notificarManyChat(t, 'recordatorio_48h');
      }

      // Recordatorio 24h
      if (!t.confirmacion?.recordatorio2Enviado && diff <= 24 * 3600 * 1000) {
        batch.update(d.ref, { 'confirmacion.recordatorio2Enviado': true, ultimaActualizacion: new Date().toISOString() });
        count++;
        // _notificarManyChat(t, 'recordatorio_24h');
      }
    });

    await batch.commit();
    console.log(`Recordatorios procesados: ${count}`);
    return null;
  });

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
async function _buscarSlots(fechaPreferida, horarioPref, maxSlots = 3) {
  const base = fechaPreferida ? new Date(fechaPreferida) : new Date();
  const dispSnap = await col('disponibilidad').get();
  const dispMap  = {};
  dispSnap.docs.forEach(d => { dispMap[d.data().diaSemana] = d.data(); });

  const turnosSnap = await col('turnos')
    .where('estado', 'in', ['pendiente', 'confirmado'])
    .get();
  const turnosExistentes = turnosSnap.docs.map(d => d.data());

  const DIAS = ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
  const slots = [];

  for (let i = 0; i < 14 && slots.length < maxSlots; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    const dowIdx = (d.getDay() + 6) % 7;
    const diaNombre = DIAS[dowIdx];
    const disp = dispMap[diaNombre];

    if (!disp?.activo || disp.noDisponible) continue;

    for (const bloque of (disp.bloques || [])) {
      const [hI, mI] = bloque.inicio.split(':').map(Number);
      let t = new Date(d); t.setHours(hI, mI, 0, 0);
      const [hF, mF] = bloque.fin.split(':').map(Number);
      const fin = new Date(d); fin.setHours(hF, mF, 0, 0);

      while (t < fin && slots.length < maxSlots) {
        if (t > new Date()) {
          const ocupado = turnosExistentes.some(turno =>
            Math.abs(new Date(turno.fecha) - t) < (bloque.duracionMinutos + (disp.descansoEntreServicios || 15)) * 60000
          );
          if (!ocupado) slots.push(t.toISOString());
        }
        t = new Date(t.getTime() + bloque.duracionMinutos * 60000);
      }
    }
  }

  return slots;
}

function _labelFecha(isoStr) {
  const d = new Date(isoStr);
  const DIAS   = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const MESES  = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} a las ${d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}`;
}
