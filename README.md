# Barbi Manicura — Sistema de Gestión

SPA para gestión de costos, servicios, caja y estadísticas de un salón de manicura.
Datos persistidos en **Firebase Firestore** (multi-dispositivo, tiempo real).

---

## Estructura del proyecto

```
barbi-manicura/
├── index.html              ← Entrada principal
├── css/
│   └── app.css             ← Todos los estilos
├── js/
│   ├── firebase-config.js  ← ⚠️ Configurar con tus datos
│   └── app.js              ← Toda la lógica
└── README.md
```

---

## 1 · Configurar Firebase (5 minutos)

### Paso 1 — Crear proyecto
1. Ir a https://console.firebase.google.com
2. Clic en **Crear proyecto** → ponerle nombre (ej: `barbi-manicura`) → Continuar
3. Desactivar Google Analytics si no lo necesitás → Crear proyecto

### Paso 2 — Crear base de datos Firestore
1. En el menú lateral → **Firestore Database**
2. Clic en **Crear base de datos**
3. Seleccionar **Iniciar en modo de producción** → Elegir región (nam5 o southamerica-east1) → Habilitar

### Paso 3 — Configurar reglas de Firestore
1. En Firestore → pestaña **Reglas**
2. Reemplazá todo con esto y publicá:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

> ⚠️ Esta regla es para uso privado/familiar. Si en el futuro necesitás login, avisame y lo agrego.

### Paso 4 — Obtener credenciales
1. En el menú lateral → ⚙️ **Configuración del proyecto**
2. Ir a la pestaña **General** → scroll hasta "Tus apps"
3. Clic en el ícono web **</>** → ponerle un nombre → Registrar app
4. Te va a mostrar un objeto `firebaseConfig` con todos los valores

### Paso 5 — Pegarlo en el proyecto
Abrí `js/firebase-config.js` y reemplazá:

```javascript
const firebaseConfig = {
  apiKey: "TU_API_KEY",           // ← tu valor real
  authDomain: "...",              // ← tu valor real
  projectId: "...",               // ← tu valor real
  storageBucket: "...",           // ← tu valor real
  messagingSenderId: "...",       // ← tu valor real
  appId: "..."                    // ← tu valor real
};
```

---

## 2 · Subir a GitHub Pages

```bash
# Si ya tenés el repo
git add .
git commit -m "Update: firebase + nueva lógica de costos"
git push origin main
```

Luego en GitHub:
- Settings → Pages → Source: **Deploy from branch** → `main` / `root`
- La URL quedará: `https://tuusuario.github.io/nombre-repo/`

> **Importante:** GitHub Pages sirve archivos estáticos. Como el proyecto usa `type="module"` en los scripts,
> tiene que servirse desde un servidor HTTP real (GitHub Pages sí lo hace, pero abrir el `index.html` 
> directamente desde el explorador de archivos NO va a funcionar).
> Para probar en local usá: `npx serve .` o la extensión **Live Server** de VS Code.

---

## 3 · Lógica de costos implementada

### Cálculo de precio sugerido

```
Costo materiales  = Σ (costo/unidad × cantidad usada) por ingrediente
Costo operativo   = Total gastos fijos mensuales ÷ Servicios disponibles por mes
─────────────────────────────────────────────────────────
Costo base        = Materiales + Operativo
Margen            = Costo base × (% margen / 100)
Precio sugerido   = Costo base + Margen
```

### Cálculo de comisión e ingreso neto

```
Comisión manicurista = Precio cobrado al cliente × (% comisión / 100)
Ingreso neto         = Precio cobrado − Comisión
```

La comisión se calcula sobre el **precio final cobrado**, no sobre el costo.
Cada pago registrado guarda la comisión y el ingreso neto para estadísticas.

### Resultado mensual (Arqueo)

```
Resultado = Total facturado − Comisiones del mes − Gastos fijos mensuales
```

---

## 4 · Funcionalidades incluidas

| Módulo | Funcionalidades |
|--------|-----------------|
| Dashboard | Resumen del día, del mes, ingreso neto, top servicios, accesos rápidos |
| Insumos | ABM completo, búsqueda, costo/unidad automático |
| Servicios | Recetas con insumos, cálculo en tiempo real, precio sugerido, comisión e ingreso neto |
| Caja | Registro de pagos (efectivo / transferencia / mixto), filtros, comisión calculada |
| Arqueo | Cierre del día, resumen mensual con resultado neto real |
| Estadísticas | Gráfico 6 meses, top servicios, distribución de cobros, métricas |
| Configuración | Gastos fijos detallados, servicios/mes, margen, comisión %, perfil |
| Backup | Exportar/Importar JSON completo (sube a Firebase en la importación) |

---

## 5 · Notas técnicas

- **Sin frameworks** — HTML + CSS + JS vanilla con ES Modules
- **Firebase SDK v10** cargado desde CDN (sin bundler necesario)
- **Responsive** — sidebar colapsable en mobile con hamburger menu
- **Sin build step** — funciona directamente como archivos estáticos
