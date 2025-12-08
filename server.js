import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configuración de OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configuración de Google Calendar con Service Account (manejo mejorado)
let calendar;

try {
  let credentials;
  
  // Intentar diferentes formas de parsear las credenciales
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      // Parsear el JSON
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
      
      // CRÍTICO: Asegurar que el private_key tenga los saltos de línea correctos
      if (credentials.private_key) {
        // Si el private_key tiene \\n literales, convertirlos a saltos de línea reales
        credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
        
        console.log('🔑 Private key verificado - longitud:', credentials.private_key.length);
        console.log('🔑 Tiene saltos de línea:', credentials.private_key.includes('\n'));
      }
      
    } catch (parseError) {
      console.error('❌ Error parseando GOOGLE_SERVICE_ACCOUNT_KEY:', parseError.message);
      throw parseError;
    }
  } 
  // Opción alternativa: usar variables individuales
  else if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    console.log('📝 Usando credenciales individuales');
    credentials = {
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID,
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      token_uri: 'https://oauth2.googleapis.com/token'
    };
  } else {
    throw new Error('No se encontraron credenciales de Google Calendar');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: ['https://www.googleapis.com/auth/calendar']
  });

  calendar = google.calendar({ version: 'v3', auth });
  console.log('✅ Google Calendar configurado correctamente');
  console.log('📧 Service Account Email:', credentials.client_email);
  
} catch (error) {
  console.error('❌ Error al configurar Google Calendar:', error.message);
  console.error('💡 Verifica que GOOGLE_SERVICE_ACCOUNT_KEY esté correctamente configurado');
}

// Almacenamiento temporal de estados de conversación
const conversationStates = new Map();

// Lista de medicamentos (simulada - puedes reemplazar con una base de datos)
const medicamentos = [
  'Paracetamol', 'Ibuprofeno', 'Amoxicilina', 'Aspirina', 'Omeprazol',
  'Loratadina', 'Diclofenaco', 'Ranitidina', 'Metformina', 'Atorvastatina'
];

// Función para buscar horarios disponibles en Google Calendar
async function buscarHorariosDisponibles(fecha) {
  try {
    if (!calendar) {
      throw new Error('Google Calendar no está configurado');
    }

    const startOfDay = new Date(fecha);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(fecha);
    endOfDay.setHours(23, 59, 59, 999);

    const response = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });

    const eventos = response.data.items || [];
    const horariosOcupados = eventos.map(e => ({
      inicio: new Date(e.start.dateTime || e.start.date),
      fin: new Date(e.end.dateTime || e.end.date)
    }));

    // Generar horarios disponibles entre 9 AM y 5 PM
    const horariosDisponibles = [];
    const horaInicio = 9; // 9 AM
    const horaFin = 17; // 5 PM
    
    for (let hora = horaInicio; hora < horaFin; hora++) {
      for (let minuto = 0; minuto < 60; minuto += 30) {
        const horario = new Date(fecha);
        horario.setHours(hora, minuto, 0, 0);
        
        const horarioFin = new Date(horario);
        horarioFin.setMinutes(horarioFin.getMinutes() + 30);
        
        const estaOcupado = horariosOcupados.some(ocupado => 
          (horario >= ocupado.inicio && horario < ocupado.fin) ||
          (horarioFin > ocupado.inicio && horarioFin <= ocupado.fin) ||
          (horario <= ocupado.inicio && horarioFin >= ocupado.fin)
        );
        
        if (!estaOcupado && horariosDisponibles.length < 3) {
          horariosDisponibles.push(horario);
        }
        
        if (horariosDisponibles.length >= 3) break;
      }
      if (horariosDisponibles.length >= 3) break;
    }
    
    return horariosDisponibles;
  } catch (error) {
    console.error('Error al buscar horarios:', error);
    throw error;
  }
}

// Función para crear evento en Google Calendar
async function crearEvento(fecha, email) {
  try {
    if (!calendar) {
      throw new Error('Google Calendar no está configurado');
    }

    const evento = {
      summary: 'Cita Médica - BOTica',
      description: 'Cita agendada a través del chatbot BOTica',
      start: {
        dateTime: fecha.toISOString(),
        timeZone: 'America/Lima'
      },
      end: {
        dateTime: new Date(fecha.getTime() + 30 * 60000).toISOString(),
        timeZone: 'America/Lima'
      },
      attendees: [{ email: email }],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 30 }
        ]
      }
    };

    const response = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      resource: evento,
      sendUpdates: 'all'
    });

    return response.data;
  } catch (error) {
    console.error('Error al crear evento:', error);
    throw error;
  }
}

// Función para validar email
function esEmailValido(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

// Función para buscar medicamento
function buscarMedicamento(nombre) {
  const nombreLower = nombre.toLowerCase();
  return medicamentos.find(med => 
    med.toLowerCase().includes(nombreLower) || 
    nombreLower.includes(med.toLowerCase())
  );
}

// Función para formatear fecha
function formatearFecha(fecha) {
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Lima'
  }).format(fecha);
}

// Función para consultar al asistente de OpenAI
async function consultarAsistente(mensaje, threadId) {
  try {
    let thread;
    
    if (threadId) {
      thread = { id: threadId };
    } else {
      thread = await openai.beta.threads.create();
    }

    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: mensaje
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID
    });

    // Esperar a que el run se complete
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    
    while (runStatus.status !== 'completed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      
      if (runStatus.status === 'failed' || runStatus.status === 'expired') {
        throw new Error('El asistente no pudo procesar la consulta');
      }
    }

    const messages = await openai.beta.threads.messages.list(thread.id);
    const respuesta = messages.data[0].content[0].text.value;

    return { respuesta, threadId: thread.id };
  } catch (error) {
    console.error('Error al consultar asistente:', error);
    throw error;
  }
}

// Endpoint principal de chat
app.post('/api/chat', async (req, res) => {
  try {
    const { message, threadId } = req.body;
    const sessionId = threadId || `session_${Date.now()}`;
    
    let state = conversationStates.get(sessionId) || {
      step: 'menu',
      data: {}
    };

    let response = '';
    
    // Detectar navegación forzada
    const mensajeLower = message.toLowerCase();
    if (mensajeLower.includes('menú principal') || 
        mensajeLower.includes('volver al inicio') || 
        mensajeLower === '0') {
      state = { step: 'menu', data: {} };
    } else if (mensajeLower.includes('agendar cita')) {
      state = { step: 'agendar_fecha', data: {} };
    } else if (mensajeLower.includes('consultar stock') || 
               mensajeLower.includes('stock de medicamentos')) {
      state = { step: 'medicamento_nombre', data: {} };
    } else if (mensajeLower.includes('hábitos de higiene') || 
               mensajeLower.includes('habitos de higiene')) {
      state = { step: 'higiene_consulta', data: {} };
    }

    // Máquina de estados
    switch (state.step) {
      case 'menu':
        response = `¡Hola! Te saluda BOTica, tu chatbot clínico favorito. Por favor indícame cómo te puedo ayudar:

1.- Agendar cita con alguna especialidad
2.- Consultar stock de medicamentos
3.- Consultar buenos hábitos de higiene`;
        
        if (message === '1') {
          state.step = 'agendar_fecha';
        } else if (message === '2') {
          state.step = 'medicamento_nombre';
        } else if (message === '3') {
          state.step = 'higiene_consulta';
        }
        break;

      case 'agendar_fecha':
        response = `Por favor indica en qué día deseas agendar la cita. Escribe la fecha en formato: DD/MM/YYYY

Ejemplo: 15/12/2024`;
        state.step = 'agendar_verificar_horarios';
        break;

      case 'agendar_verificar_horarios':
        try {
          const partes = message.split('/');
          if (partes.length !== 3) {
            response = 'Por favor ingresa la fecha en formato DD/MM/YYYY';
            break;
          }
          
          const fecha = new Date(partes[2], partes[1] - 1, partes[0]);
          
          if (isNaN(fecha.getTime())) {
            response = 'Fecha inválida. Por favor ingresa una fecha correcta en formato DD/MM/YYYY';
            break;
          }
          
          const horarios = await buscarHorariosDisponibles(fecha);
          
          if (horarios.length > 0) {
            state.data.fecha = fecha;
            state.data.horarios = horarios;
            
            response = `Los horarios disponibles son:\n\n`;
            horarios.forEach((h, i) => {
              response += `${i + 1}.- ${h.toLocaleTimeString('es-ES', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}\n`;
            });
            response += '\nPor favor elige un número del 1 al 3';
            
            state.step = 'agendar_seleccionar_horario';
          } else {
            response = 'Lo siento, no hay horarios disponibles para esa fecha. ¿Deseas elegir otra fecha? (Sí/No)';
            state.step = 'agendar_otra_fecha';
          }
        } catch (error) {
          console.error('Error en verificar horarios:', error);
          response = 'Ocurrió un error al verificar los horarios. Por favor intenta nuevamente más tarde.';
          state.step = 'menu';
        }
        break;

      case 'agendar_otra_fecha':
        if (mensajeLower.includes('sí') || mensajeLower.includes('si')) {
          state.step = 'agendar_fecha';
          response = 'Por favor indica en qué día deseas agendar la cita (formato DD/MM/YYYY)';
        } else {
          state.step = 'menu';
          response = 'De acuerdo. Por favor indícanos si hay algo más en lo que podamos ayudarte';
        }
        break;

      case 'agendar_seleccionar_horario':
        const seleccion = parseInt(message);
        if (seleccion >= 1 && seleccion <= 3 && state.data.horarios[seleccion - 1]) {
          state.data.horarioSeleccionado = state.data.horarios[seleccion - 1];
          response = 'Por favor indícame una dirección de email para generar la cita';
          state.step = 'agendar_email';
        } else {
          response = 'Por favor elige un número válido del 1 al 3';
        }
        break;

      case 'agendar_email':
        if (esEmailValido(message)) {
          try {
            await crearEvento(state.data.horarioSeleccionado, message);
            response = `Listo, la cita se agendó para el ${formatearFecha(state.data.horarioSeleccionado)}

¿Hay algo más en lo que pueda ayudarte?`;
            state.step = 'menu';
          } catch (error) {
            console.error('Error al crear evento:', error);
            response = 'Ocurrió un error al crear la cita. Por favor intenta nuevamente o contacta al administrador.';
            state.step = 'menu';
          }
        } else {
          response = 'Por favor indica una dirección de email válida';
        }
        break;

      case 'medicamento_nombre':
        response = 'Por favor escribe el nombre del medicamento que estás buscando';
        state.step = 'medicamento_buscar';
        break;

      case 'medicamento_buscar':
        const medicamento = buscarMedicamento(message);
        
        if (medicamento) {
          response = `El producto "${medicamento}" se encuentra en stock. Puedes acercarte a comprarlo.

Por favor indícame si te puedo ayudar en algo adicional`;
          state.step = 'menu';
        } else {
          response = 'El producto no se encuentra en stock. ¿Deseas probar con otro? (Sí/No)';
          state.step = 'medicamento_reintentar';
        }
        break;

      case 'medicamento_reintentar':
        if (mensajeLower.includes('sí') || mensajeLower.includes('si')) {
          response = 'Por favor escribe el nombre del medicamento que estás buscando';
          state.step = 'medicamento_buscar';
        } else {
          response = 'De acuerdo, por favor indícanos si te podemos ayudar en algo adicional';
          state.step = 'menu';
        }
        break;

      case 'higiene_consulta':
        try {
          // Verificar si quiere volver al menú o cambiar de opción
          if (mensajeLower.includes('agendar cita')) {
            state = { step: 'agendar_fecha', data: {} };
            response = 'Por favor indica en qué día deseas agendar la cita (formato DD/MM/YYYY)';
          } else if (mensajeLower.includes('consultar stock') || 
                     mensajeLower.includes('stock de medicamentos')) {
            state = { step: 'medicamento_nombre', data: {} };
            response = 'Por favor escribe el nombre del medicamento que estás buscando';
          } else {
            const resultado = await consultarAsistente(message, state.data.assistantThreadId);
            response = resultado.respuesta;
            state.data.assistantThreadId = resultado.threadId;
            // Mantener en el mismo estado para continuar la conversación
          }
        } catch (error) {
          response = 'Lo siento, ocurrió un error al procesar tu consulta sobre hábitos de higiene. Por favor intenta nuevamente.';
        }
        break;

      default:
        state.step = 'menu';
        response = `¡Hola! Te saluda BOTica, tu chatbot clínico favorito. Por favor indícame cómo te puedo ayudar:

1.- Agendar cita con alguna especialidad
2.- Consultar stock de medicamentos
3.- Consultar buenos hábitos de higiene`;
    }

    conversationStates.set(sessionId, state);

    res.json({
      response,
      threadId: sessionId
    });

  } catch (error) {
    console.error('Error en /api/chat:', error);
    res.status(500).json({
      response: 'Lo siento, ocurrió un error interno. Por favor intenta nuevamente.',
      error: error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    calendar: calendar ? 'Connected' : 'Not configured',
    openai: process.env.OPENAI_API_KEY ? 'Configured' : 'Not configured'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
