# BOTica Backend - Chatbot Clínico

Backend para el chatbot BOTica con integración a Google Calendar y OpenAI Assistant.

## Características

- ✅ Agendamiento de citas médicas con Google Calendar
- ✅ Consulta de stock de medicamentos
- ✅ Asistente de hábitos de higiene con OpenAI
- ✅ Árbol de decisiones conversacional
- ✅ Compatible con frontend React
- ✅ Despliegue en Render.com

## Requisitos Previos

1. Cuenta de [OpenAI](https://platform.openai.com/)
2. Proyecto en [Google Cloud Console](https://console.cloud.google.com/)
3. Cuenta en [Render.com](https://render.com/)
4. Cuenta de [GitHub](https://github.com/)

## Configuración Local

### 1. Clonar el repositorio

```bash
git clone <tu-repositorio>
cd botica-backend
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

Crea un archivo `.env` basado en `.env.example`:

```bash
cp .env.example .env
```

Edita el archivo `.env` con tus credenciales.

### 4. Ejecutar en modo desarrollo

```bash
npm run dev
```

El servidor estará disponible en `http://localhost:3000`

## Configuración de Google Calendar

### Paso 1: Crear proyecto en Google Cloud

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Crea un nuevo proyecto o selecciona uno existente
3. Habilita la API de Google Calendar:
   - Busca "Google Calendar API"
   - Haz clic en "Habilitar"

### Paso 2: Crear credenciales OAuth 2.0

1. Ve a "Credenciales" en el menú lateral
2. Haz clic en "Crear credenciales" > "ID de cliente de OAuth"
3. Tipo de aplicación: "Aplicación web"
4. URIs de redirección autorizados: `https://developers.google.com/oauthplayground`
5. Guarda el **Client ID** y **Client Secret**

### Paso 3: Obtener Refresh Token

1. Ve a [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
2. Haz clic en el ícono de configuración (⚙️) en la esquina superior derecha
3. Marca "Use your own OAuth credentials"
4. Ingresa tu Client ID y Client Secret
5. En "Step 1", selecciona "Google Calendar API v3"
6. Marca el scope: `https://www.googleapis.com/auth/calendar`
7. Haz clic en "Authorize APIs"
8. Autoriza el acceso a tu cuenta de Google
9. En "Step 2", haz clic en "Exchange authorization code for tokens"
10. Copia el **Refresh token**

### Paso 4: Agregar al .env

```env
GOOGLE_CLIENT_ID=tu_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=tu_client_secret
GOOGLE_REDIRECT_URI=https://developers.google.com/oauthplayground
GOOGLE_REFRESH_TOKEN=tu_refresh_token
GOOGLE_CALENDAR_ID=primary
```

## Configuración de OpenAI Assistant

### Paso 1: Crear API Key

1. Ve a [OpenAI Platform](https://platform.openai.com/api-keys)
2. Crea una nueva API key
3. Cópiala inmediatamente (no podrás verla después)

### Paso 2: Crear Asistente

1. Ve a [OpenAI Assistants](https://platform.openai.com/assistants)
2. Haz clic en "Create"
3. Configura el asistente:
   - **Name**: BOTica Higiene Assistant
   - **Instructions**: 
   ```
   Eres un asistente médico especializado en buenos hábitos de higiene.
   Proporciona consejos prácticos, científicos y fáciles de seguir sobre:
   - Higiene personal
   - Lavado de manos
   - Higiene dental
   - Limpieza de heridas
   - Prevención de infecciones
   - Hábitos saludables
   
   Sé amable, claro y profesional. Si detectas que la consulta no es sobre 
   higiene, indica que solo puedes ayudar con temas de hábitos de higiene.
   ```
   - **Model**: gpt-4-turbo-preview (o el más reciente disponible)
4. Haz clic en "Save"
5. Copia el **Assistant ID** (comienza con `asst_`)

### Paso 3: Agregar al .env

```env
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_ASSISTANT_ID=asst_xxxxxxxxxxxxxxxx
```

## Despliegue en Render.com

### Paso 1: Preparar el repositorio

1. Asegúrate de que tu código esté en GitHub
2. Incluye estos archivos:
   - `server.js`
   - `package.json`
   - `.env.example`
   - `README.md`
3. Crea un archivo `.gitignore`:

```
node_modules/
.env
.DS_Store
```

### Paso 2: Crear servicio en Render

1. Ve a [Render.com](https://render.com/) e inicia sesión
2. Haz clic en "New +" > "Web Service"
3. Conecta tu repositorio de GitHub
4. Configura el servicio:
   - **Name**: botica-backend
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (o el que prefieras)

### Paso 3: Configurar variables de entorno

En la sección "Environment Variables", agrega todas las variables del `.env`:

```
PORT=3000
OPENAI_API_KEY=tu_api_key
OPENAI_ASSISTANT_ID=tu_assistant_id
GOOGLE_CLIENT_ID=tu_client_id
GOOGLE_CLIENT_SECRET=tu_client_secret
GOOGLE_REDIRECT_URI=https://developers.google.com/oauthplayground
GOOGLE_REFRESH_TOKEN=tu_refresh_token
GOOGLE_CALENDAR_ID=primary
```

### Paso 4: Desplegar

1. Haz clic en "Create Web Service"
2. Render automáticamente construirá y desplegará tu aplicación
3. Una vez completado, obtendrás una URL como: `https://botica-backend.onrender.com`

## Configurar Frontend

Actualiza tu frontend para usar la URL de Render:

```env
# En tu archivo .env del frontend
VITE_API_URL=https://botica-backend.onrender.com
```

## Testing

### Test del servidor

```bash
curl https://botica-backend.onrender.com/health
```

Respuesta esperada:
```json
{
  "status": "OK",
  "timestamp": "2024-12-05T..."
}
```

### Test del chat

```bash
curl -X POST https://botica-backend.onrender.com/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hola", "threadId": null}'
```

## Estructura del Proyecto

```
botica-backend/
├── server.js           # Servidor principal
├── package.json        # Dependencias
├── .env               # Variables de entorno (no subir a git)
├── .env.example       # Ejemplo de variables
├── .gitignore         # Archivos ignorados
└── README.md          # Esta documentación
```

## API Endpoints

### POST /api/chat

Endpoint principal del chatbot.

**Request:**
```json
{
  "message": "Hola",
  "threadId": "session_1234567890" // opcional
}
```

**Response:**
```json
{
  "response": "¡Hola! Te saluda BOTica...",
  "threadId": "session_1234567890"
}
```

### GET /health

Health check del servidor.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-12-05T10:30:00.000Z"
}
```

## Flujo de Conversación

1. **Menú Principal**: Usuario selecciona opción (1, 2 o 3)
2. **Agendar Cita**:
   - Solicita fecha
   - Muestra horarios disponibles
   - Solicita email
   - Crea evento en Google Calendar
3. **Consultar Medicamentos**:
   - Solicita nombre
   - Busca en inventario
   - Informa disponibilidad
4. **Hábitos de Higiene**:
   - Consulta al Assistant de OpenAI
   - Mantiene contexto de conversación
   - Detecta navegación a otras opciones

## Troubleshooting

### Error: "OPENAI_API_KEY not configured"
- Verifica que la variable esté en Render
- Asegúrate de que no tenga espacios extras

### Error: "Google Calendar API error"
- Verifica que el refresh token sea válido
- Asegúrate de que la API esté habilitada
- Revisa los scopes del token

### El servidor no responde
- Verifica los logs en Render Dashboard
- Asegúrate de que el servicio esté "Running"
- Verifica que PORT esté correctamente configurado

### Frontend no conecta con backend
- Verifica CORS en server.js
- Asegúrate de usar la URL correcta de Render
- Revisa la consola del navegador

## Personalización

### Agregar más medicamentos

Edita el array `medicamentos` en `server.js`:

```javascript
const medicamentos = [
  'Paracetamol',
  'Tu Medicamento',
  // ... más medicamentos
];
```

### Cambiar horarios de atención

Modifica las constantes en `buscarHorariosDisponibles()`:

```javascript
const horaInicio = 8;  // 8 AM
const horaFin = 18;    // 6 PM
```

### Personalizar mensajes

Todos los mensajes están en español y pueden editarse directamente en el código.

## Seguridad

⚠️ **IMPORTANTE**:
- Nunca subas el archivo `.env` a GitHub
- Usa variables de entorno en Render
- Rota tus API keys periódicamente
- Limita los scopes de Google Calendar al mínimo necesario

## Soporte

Para problemas o preguntas:
1. Revisa la documentación
2. Verifica los logs en Render
3. Consulta la documentación de las APIs

## Licencia

MIT
