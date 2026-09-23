# Registro de Cambios (Changelog) — Nudo Hub

Todos los cambios notables en este proyecto se documentan en este archivo.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y este proyecto se adhiere a un versionado incremental para producción (`v0.xxx`).

---

## [v0.209.6] - 2026-09-23

### Añadido (Added)
- **Tardanza** en Bitácora: elige a la persona y toca los minutos de retraso — **5, 10, 15, 30 u Otra** (esta última abre un campo para escribir los minutos). El **motivo es obligatorio**, igual que en Horas y faltas.
  - La tardanza capturada aparece en la revisión previa al envío y en el resumen (WhatsApp y correo). Antes de este cambio, las horas y faltas se guardaban pero **nunca se mostraban en el resumen** — ahora sí.

### Cambiado (Changed)
- **Orden de la Bitácora**: *Horas y faltas* y *Tardanza* ahora van **justo debajo de Personal**, antes de Servicio, para que los temas de asistencia queden agrupados con la persona a la que se refieren.
- **Se quitó el rótulo "Horas (opcional — ajustes o extras por persona)"**; la sección queda solo con el botón *＋ Agregar persona*.
- **Encabezado**: el logotipo oficial *Nudo* ahora se lee junto con **Hub** en texto normal debajo, formando "Nudo Hub". Reemplaza a "Bienvenido" (y a "Acceso del equipo" antes de iniciar sesión).
- **Inicio**: el bloque **Guía** se movió **debajo** del bloque **Seguimiento**.

---


## [v0.209.5] - 2026-09-23

### Cambiado (Changed)
- **Seguimiento de solicitudes ahora son DOS páginas separadas** (Ben): **🛒 Compras** y **🔧 Mantenimiento**, cada una con su propia tarjeta en Inicio. Antes eran dos pestañas dentro de una misma página, con dos controles de filtro apilados que se veían confusos y recargados.
  - Ya no se carga el contenido de ambas: cada página trae solo lo suyo.
  - Se eliminó el conmutador de pestañas y el filtro duplicado; cada página conserva **🔴 Pendientes / Todas**.
  - Cada tarjeta de Inicio muestra su **propio** contador de pendientes (antes el badge sumaba compras + mantenimiento en un solo lugar).
  - Los mensajes de error ahora aparecen en la página que el usuario está viendo (antes se escribían en la página oculta).
  - El auto-refresco en tiempo real respeta la página abierta: las compras solo recargan Compras y el mantenimiento solo Mantenimiento.

---

## [v0.209.4] - 2026-09-23

### Cambiado (Changed)
- **Íconos de la PWA reemplazados por el logotipo oficial de Nudo.** Los íconos anteriores eran marcadores de posición (659 B / 1.9 KB, un cuadro verde con una "N" diminuta) y eran lo que el equipo veía al instalar la app en su teléfono.

### Corregido (Fixed)
- **El ícono de notificación (`badge`) ahora es una silueta BLANCA.** Antes apuntaba al ícono a color; Android reduce el badge a una silueta, así que se veía como un bloque sólido en lugar del logotipo. Nuevo `badge-96.png` (blanco sobre transparente) en `app.html` y `sw.js`.
- **Ícono *maskable* separado del ícono normal.** Los íconos declaraban `"purpose": "any maskable"`, lo cual es incorrecto: una imagen *maskable* se recorta a un círculo del ~80% del diámetro, por lo que necesita margen propio. Ahora `icon-192`/`icon-512` son `"any"` y el nuevo `icon-maskable-512.png` es `"maskable"`, verificado midiendo que el monograma cae dentro de la zona segura (390 px vs 480 px de radio disponible).

---


### Añadido (Added)
- **Nuevos ingresos — modos de edición, documentos y ocultación**:
  - Diferenciación de edición: botón *"➕ Agregar puesto, sueldo y fecha de ingreso"* para el modal rápido de datos contractuales, y nuevo botón *"✏️ Editar"* que abre el formulario `./onboarding.html?onboarding_id=<id>` en una nueva pestaña para modificar el expediente completo.
  - Indicador de verificación de documentos (`onboarding_documents`): estado neutral (*"📎 Sin documentos subidos"*) para perfiles sin archivos y contador con distintivo dinámico (*"📎 Documentos: X/Y verificados ✅/⏳/⚠️"*) según validación de nivel 2.
  - Botón *"🗑️ Eliminar"* exclusivo para registros incompletos sin cuenta, realizando borrado lógico (`hidden_at`) con confirmación de usuario, verificación read-back inmediata y exclusión automática en la consulta de `loadNuevos()`.

### Modificado (Changed)
- **Nuevos ingresos — etiquetas y visibilidad**:
  - Renombrados los botones de contrato a *"📄 Contrato con resaltado"* (revisión) y *"✍️ Contrato sin resaltado"* (firma).
  - Renombrado botón de reenvío a *"✉️ Enviar correo con link para corrección"*, restringido a registros no activados o incompletos con guardia de modo de prueba intacta.
- **Estatus — Solicitud de compras**:
  - Eliminada la opción de descarga/visualización de PDF para compras (`row.table !== 'purchases'`), manteniéndola disponible únicamente para mantenimiento.
- **Selectores de calendario (Date pickers)**:
  - Estilo CSS unificado en `app.html` y `onboarding.html` para campos `input[type="date"]`: icono de calendario SVG amplio a la derecha, objetivo táctil cómodo (≥44px, fuente 16px anti-zoom iOS), bordes redondeados, anillo de enfoque accesible y apertura nativa al hacer clic en cualquier parte del campo en escritorio.

---

## [v0.203] - 2026-09-22

### Modificado (Changed)
- **Solicitud de compras y reposición**:
  - Desglose no ambiguo del monto en dos campos: unidades (`c-units`, por defecto 1) y monto aproximado por unidad (`c-amount`), manteniendo `amount` como el total (`units * amount_per_unit`).
  - Indicador dinámico en vivo bajo el formulario que muestra el cálculo del total aproximado (`Total aproximado: $X MXN (N × $Y)`).
  - Actualización consistente en todos los puntos de visualización y exportación: modal de revisión previa, tarjetas de seguimiento (`loadEstatus`), modal de detalle (`estatus-detail`), modal de edición (`estatus-edit` con verificación read-back) y descarga de PDF (`downloadPdf`).
- **Control "Visto como" (impersonación)**:
  - Visible para todos los usuarios autenticados pero deshabilitado mediante constante centralizada (`VIEW_AS_ENABLED = false`), con estilo visual atenuado, atributo `disabled`, tooltip explicativo y guardia funcional para prevenir aperturas no deseadas.

---

## [v0.202] - 2026-09-22

### Añadido (Added)
- **Nuevos ingresos — contratos, edición rápida y reenvío**:
  - Descarga de contratos en PDF desde Supabase Storage (`onboarding-documents`): versión con resaltado (`revision`) para impresión/revisión y versión sin resaltado (`firma`) para firma.
  - Modal de edición rápida (`nuevo-editor-modal`) para modificar puesto, salario semanal y fecha de ingreso, con verificación de RLS contra la base de datos.
  - Modo B de reenvío para corrección: envía enlace al aspirante mediante `signInWithOtp` (con confirmación previa y guard de seguridad en modo de prueba).
  - Unificación de definición de gestión (`isManagement`) alineada con la regla del servidor (`is_dueno() OR is_gerente() OR is_agf()`), permitiendo acceso a perfiles de nivel <= 2.

---

## [v0.140] - 2026-09-17

### Modificado (Changed)
- **Tema y colores en página de incorporación**:
  - `onboarding.html` ahora adopta el tema visual completo de Nudo Hub (modo claro, modo oscuro y automático de sistema).
  - Incluye selector de tema en la cabecera sincronizado con la preferencia guardada en `localStorage`.
- **Copia y terminología**:
  - Actualizado el texto de acceso en pantalla de inicio de sesión a **"¿Eres nuevo al equipo? Regístrate aquí →"**.
  - En la página de incorporación se reemplazó la terminología de "empleado" por **"nuevo ingreso al equipo"**.
- **Service Worker**:
  - Añadido `/Nudo-hub/onboarding.html` a la lista de recursos precacheados (`ASSETS`) y cache actualizado a `nudo-hub-v37`.

---

## [v0.139] - 2026-09-17

### Modificado (Changed)
- **Área segura superior en iOS PWA (safe-area-inset-top)**:
  - Añadido soporte de insets de área segura en `body` (`padding-top: env(safe-area-inset-top, 0px)`), `.push-toast`, `.back` y cabeceras sticky.
  - Corrige el oscurecimiento y corte del encabezado ("Nudo Hub" y "Bienvenido") que ocurría bajo la barra de estado y Dynamic Island / notch al instalar como PWA independiente en iPhone.
  - Aumentado el contraste del título en modo oscuro con `--accent2`.
- **Claridad de envío en formularios**:
  - En **Bitácora**, **Mantenimiento**, **Compras** y **Entrevistas**, el botón de acción cambia de *"Enviar..."* / *"Registrar..."* a **"Revisar antes de enviar"**, alineando la acción con la apertura de la ventana modal de revisión previa (`openReview`).
  - El indicador en vivo de Bitácora cambia de *"✅ Listo para enviar"* a **"✅ Listo para revisar"**.
  - La acción de envío definitivo permanece sin cambios dentro del diálogo de revisión (**"✅ Enviar"**).

---

## [v0.138] - 2026-09-17

### Añadido (Added)
- **Soporte completo de Web Push en iOS (iPhone/iPad)**:
  - Metadatos Apple PWA en `<head>`: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title` e icono `apple-touch-icon` para garantizar que la app se instale como PWA aislada con sandbox de notificaciones propio.
  - Detección de modo independiente en iOS (`checkIOSStandalone`): Si un usuario en Safari toca el interruptor de notificaciones, se le guía paso a paso para añadir la app a su pantalla de inicio (`Compartir ↑ → Añadir a inicio`) en lugar de mostrar un error confuso.
  - Banner de verificación local inmediata (`reg.showNotification`) al activar las notificaciones en el dispositivo.
  - Sección y modal interactivo de **Novedades y Registro de Cambios** en la app (accesible tocando la versión en el pie de página).
  - Archivo de documentación integral `CHANGELOG.md`.

### Corregido (Fixed)
- **Pérdida de gesto de usuario en WebKit (iOS)**: Eliminadas llamadas intermedias redundantes (`await getPushSubscription`) antes de `reg.pushManager.subscribe()`, previniendo que expire la activación transitoria de iOS.
- **Formato de claves para Apple APNs**: Extracción de credenciales usando `sub.toJSON().keys` con formato base64url conforme a RFC 8291.
- **Registro robusto de Service Worker**: Comprobación de `document.readyState === 'complete'` para asegurar que el Service Worker se registre aún cuando la página ya haya terminado de cargar.
- **Manejo de mensajes en SW**: Añadido listener para `SKIP_WAITING` y tolerancia a payloads de texto plano o vacíos en el evento `push`.

---

## [v0.137] - 2026-09-16
- **Login con tecla ENTER**: Se permite pulsar Enter tanto en el campo de correo (*Enviar código*) como en el campo de código de 6 dígitos (*Entrar*), enfocando automáticamente la caja de código al pasar al segundo paso.

## [v0.136] - 2026-09-16
- **Subtítulos organizadores en Bitácora**: Se agregaron 6 divisores visuales (`.form-subhead`) para organizar los 16 campos en áreas claras: *Turno*, *Equipo y servicio*, *Producto*, *Instalaciones*, *Operación y caja*, y *Cierre*, sin alterar el esquema de datos ni el orden obligatorio de campos.

## [v0.135] - 2026-09-16
- **Recordatorios de Limpieza en Bitácora**: Texto de ayuda ampliado para solicitar explícitamente reportes de fauna, servicio de fumigación y limpieza de trampa de grasa.

## [v0.134] - 2026-09-15
- **Seguridad de Códigos de Acceso**: Eliminación de códigos de puertas y alarma de los archivos públicos del repositorio. Ahora se cargan de forma segura desde la tabla Supabase `access_codes`, protegida por Row-Level Security (RLS) solo para personal autenticado con perfil activo.

## [v0.133] - 2026-09-15
- Tarjeta de códigos de acceso visible con códigos reales pre-migración a servidor.

## [v0.132] - 2026-09-15
- Eliminado el enlace visible de vista previa (`Página de pruebas`) de la pantalla de inicio de sesión.

## [v0.131] - 2026-09-14
- **Tarjeta "Instalar la app"**: Añadida tarjeta en Inicio para guiar a los usuarios a agregar Nudo Hub a la pantalla de inicio (con soporte de diálogo nativo en Android y pasos explicados en iOS).

## [v0.130] - 2026-09-14
- **Uniformidad en Bitácora**: Botones de radio simplificados a estados limpios (✅ / ⚠️) en Propinas y Descuentos/Cortesías.

## [v0.129] - 2026-09-14
- **Bitácora — Corte de Caja**: Añadida categoría de 2 estados (`¿Salió bien?` ✅ / ⚠️ + nota) inmediatamente después de Reservaciones.

## [v0.128] - 2026-09-13
- **Cuentas de Vista Previa Dedicadas**: Palabras clave de acceso (`capitan`, `mesero`, `cocina`, `barra`, `encargado`, `gerente`, `gerenteregional`, `dueno`) ahora inician sesión en perfiles de prueba aislados sin interferir con cuentas reales.

## [v0.127] - 2026-09-13
- **Modal de Revisión**: Botones de acción (`✏️ Editar` / `✅ Enviar`) fijados en la parte superior (sticky) para facilitar la confirmación en reportes largos.

## [v0.126] - 2026-09-13
- **Dock Inferior Simplificado**: Barra flotante reducida a 2 accesos esenciales: *Inicio* y *Seguimiento*. Bitácora, Planear y Guía se acceden directamente desde las tarjetas de Inicio.

## [v0.119] - 2026-09-12
- Filas de solicitante y fecha en el modal de revisión (Mantenimiento y Compras); opción de sucursal libre "Otra"; vista de solicitudes no estándar en Estatus.

## [v0.118] - 2026-09-12
- **Planificador de Horarios**: Pestañas de ancho completo Semana/Día; asignación táctil emergente de personal y horas en sustitución de menús desplegables en línea.

## [v0.116] - 2026-09-12
- **Encabezado Unificado**: Barra de usuario integrada dentro de la tarjeta de encabezado con separador sutil; eliminada la barra cuadrada flotante independiente.

## [v0.115] - 2026-09-12
- **Selector de Puesto**: Rueda táctil compacta vertical tipo iOS (112px con barra de selección centrada) para el registro de entrevistas.

## [v0.114] - 2026-09-12
- Corrección de superposición de capas en móviles: elevación de modales a `z-index: 70` sobre el dock flotante (`z: 50`) con atenuación automática mediante `body.modal-open`.

## [v0.113] - 2026-09-11
- Vocabulario y diseño móvil: barras de envío adherentes (sticky), contador de campos faltantes en Bitácora, botones paso a paso (±) y micro-interacciones hápticas.

## [v0.109] - 2026-09-11
- Planificador: Producción como grupo de rol independiente; asignaciones exclusivas por sucursal; vista Día por defecto en pantallas `<700px`.

## [v0.107] - 2026-09-11
- Sistema de Auto-Actualización (`version.json`): Detección automática de nuevas versiones para sanar clientes con caché desactualizada.
- Corrección de redirección OTP: uso de `emailRedirectTo` en `signInWithOtp` para evitar pérdidas de parámetros de enlace mágico tras migración a PKCE.

## [v0.103] - 2026-09-10
- **Gestión de Usuarios (Dueño)**: Módulo de administración de personal con creación, edición de roles/sucursales y activación/desactivación vía función server-side.

## [v0.94 - v0.100] - 2026-09-09
- **Módulo de Entrevistas**: Registro de candidatos, calificación por estrellas, panelistas, estatus del proceso de contratación y visualización de historial.

## [v0.85] - 2026-09-09
- Barra flotante de navegación y mejoras de navegación móvil.

## [v0.56] - 2026-09-08
- Modal de pre-revisión antes de enviar reportes; interacciones táctiles y soporte de notificaciones push.

## [v0.10 - v0.55] - 2026-09-06 a 2026-09-08
- Creación de Bitácora operativa, solicitudes de compras y mantenimiento, temas claros/oscuros y migración a autenticación por correo OTP.
