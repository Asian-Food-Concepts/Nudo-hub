# Registro de Cambios (Changelog) — Nudo Hub

Todos los cambios notables en este proyecto se documentan en este archivo.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y este proyecto se adhiere a un versionado incremental para producción (`v0.xxx`).

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
