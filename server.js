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

// Configuración de Google Services (Calendar y Sheets) con Service Account
let calendar;
let sheets;

try {
  let credentials;
  
  console.log('🔍 Iniciando configuración de Google Services...');
  console.log('🔍 GOOGLE_SERVICE_ACCOUNT_KEY existe?', !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  console.log('🔍 GOOGLE_CLIENT_EMAIL existe?', !!process.env.GOOGLE_CLIENT_EMAIL);
  console.log('🔍 GOOGLE_PRIVATE_KEY existe?', !!process.env.GOOGLE_PRIVATE_KEY);
  
  // Intentar diferentes formas de parsear las credenciales
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    console.log('📄 Usando GOOGLE_SERVICE_ACCOUNT_KEY (JSON completo)');
    try {
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
      console.log('✅ JSON parseado correctamente');
      console.log('📋 project_id:', credentials.project_id);
      console.log('📋 client_email:', credentials.client_email);
      
      if (credentials.private_key) {
        credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
      }
      
    } catch (parseError) {
      console.error('❌ Error parseando GOOGLE_SERVICE_ACCOUNT_KEY:', parseError.message);
      throw parseError;
    }
  } 
  // Opción alternativa: usar variables individuales
  else if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    console.log('📝 Usando credenciales individuales (variables separadas)');
    
    credentials = {
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID,
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      token_uri: 'https://oauth2.googleapis.com/token'
    };
  } else {
    throw new Error('No se encontraron credenciales de Google');
  }

  console.log('🔧 Creando GoogleAuth...');
  const auth = new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/spreadsheets.readonly'
    ]
  });

  // Configurar Calendar
  calendar = google.calendar({ version: 'v3', auth });
  console.log('✅ Google Calendar configurado correctamente');
  
  // Configurar Sheets
  sheets = google.sheets({ version: 'v4', auth });
  console.log('✅ Google Sheets configurado correctamente');
  
  console.log('📧 Service Account Email:', credentials.client_email);
  
} catch (error) {
  console.error('❌ Error al configurar Google Services:', error.message);
  console.error('💡 Verifica que las credenciales estén correctamente configuradas');
}

// Almacenamiento temporal de estados de conversación
const conversationStates = new Map();

// Función para buscar medicamento en Google Sheets
async function buscarMedicamentoEnSheet(nombreBuscado) {
  try {
    if (!sheets) {
      throw new Error('Google Sheets no está configurado');
    }

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const range = process.env.GOOGLE_SHEET_RANGE || 'Sheet1!A:O'; // Rango por defecto
    
    console.log('📊 Consultando Google Sheet:', spreadsheetId);
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: range,
    });

    const rows = response.data.values;
    
    if (!rows || rows.length === 0) {
      console.log('⚠️ No se encontraron datos en la hoja');
      return null;
    }

    // Saltar la primera fila (encabezados)
    const dataRows = rows.slice(1);
    
    const nombreBuscadoLower = nombreBuscado.toLowerCase().trim();
    
    // Buscar en los datos
    for (const row of dataRows) {
      const nombreMedicamento = row[1] ? row[1].toString().trim() : ''; // Columna B (índice 1)
      const stock = row[10] ? row[10].toString().trim() : '0'; // Columna K (índice 10)
      const requiereReceta = row[14] ? row[14].toString().trim() : 'No'; // Columna O (índice 14)
      
      // Búsqueda flexible: permite coincidencias parciales
      if (nombreMedicamento.toLowerCase().includes(nombreBuscadoLower) || 
          nombreBuscadoLower.includes(nombreMedicamento.toLowerCase())) {
        
        const stockNumerico = parseInt(stock) || 0;
        
        return {
          nombre: nombreMedicamento,
          stock: stockNumerico,
          enStock: stockNumerico > 0,
          requiereReceta: requiereReceta.toLowerCase() === 'si' || requiereReceta.toLowerCase() === 'sí'
        };
      }
    }
    
    // No se encontró el medicamento
    return null;
    
  } catch (error) {
    console.error('❌ Error al buscar en Google Sheets:', error.message);
    throw error;
  }
}

// Función para buscar horarios disponibles en Google Calendar
async function buscarHorariosDisponibles(fecha) {
  try {
    if (!calendar) {
      throw new Error('Google Calendar no está configurado');
    }

    // Obtener año, mes y día de la fecha recibida
    const year = fecha.getFullYear();
    const month = fecha.getMonth();
    const day = fecha.getDate();
    
    // Crear inicio y fin del día en hora de Lima
    // 00:00 Lima = 05:00 UTC del mismo día
    const startOfDay = new Date(Date.UTC(year, month, day, 5, 0, 0, 0));
    // 23:59 Lima = 04:59 UTC del día siguiente
    const endOfDay = new Date(Date.UTC(year, month, day + 1, 4, 59, 59, 999));

    const response = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: 'America/Lima'
    });

    const eventos = response.data.items || [];
    const horariosOcupados = eventos.map(e => ({
      inicio: new Date(e.start.dateTime || e.start.date),
      fin: new Date(e.end.dateTime || e.end.date)
    }));

    // Generar horarios disponibles entre 9 AM y 5 PM (hora de Lima)
    const horariosDisponibles = [];
    const horaInicio = 9; // 9 AM Lima
    const horaFin = 17; // 5 PM Lima
    
    for (let hora = horaInicio; hora < horaFin; hora++) {
      for (let minuto = 0; minuto < 60; minuto += 30) {
        // Crear horario en UTC: hora de Lima + 5 horas
        // Por ejemplo: 9 AM Lima = 14:00 UTC (9 + 5)
        const horario = new Date(Date.UTC(year, month, day, hora + 5, minuto, 0, 0));
        const horarioFin = new Date(horario.getTime() + 30 * 60000);
        
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
      description: `Cita agendada a través del chatbot BOTica\nPaciente: ${email}`,
      start: {
        dateTime: fecha.toISOString(),
        timeZone: 'America/Lima'
      },
      end: {
        dateTime: new Date(fecha.getTime() + 30 * 60000).toISOString(),
        timeZone: 'America/Lima'
      },
      // No incluimos attendees para evitar el error de Service Account
      // El email del paciente se guarda en la descripción
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 1440 }, // 1 día antes
          { method: 'popup', minutes: 30 }    // 30 minutos antes
        ]
      }
    };

    const response = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      resource: evento,
      sendUpdates: 'none' // Cambiado de 'all' a 'none'
    });

    console.log('✅ Evento creado exitosamente:', response.data.id);
    return response.data;
  } catch (error) {
    console.error('Error al crear evento:', error);
    throw error;
  }
}

// Función para normalizar texto (quitar tildes y caracteres especiales)
function normalizarTexto(texto) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar tildes
    .toLowerCase()
    .trim();
}

// Función para validar email
function esEmailValido(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

// Función para formatear fecha en hora de Lima
function formatearFecha(fecha) {
  // Formatear directamente en zona horaria de Lima
  return new Intl.DateTimeFormat('es-PE', {
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
    
    // Detectar navegación forzada y normalizar entrada
    const mensajeLower = message.toLowerCase().trim();
    const mensajeNormalizado = normalizarTexto(mensajeLower);
    
    // Detectar si quiere volver al menú
    if (mensajeNormalizado.includes('menu') || 
        mensajeNormalizado.includes('inicio') || 
        mensajeNormalizado.includes('volver') ||
        mensajeLower === '0') {
      state = { step: 'menu', data: {} };
    } 
    // Detectar si quiere agendar cita
    else if (mensajeLower === '1' || 
             mensajeNormalizado.includes('agendar') || 
             mensajeNormalizado.includes('cita') ||
             mensajeNormalizado.includes('especialidad')) {
      state = { step: 'agendar_fecha', data: {} };
    } 
    // Detectar si quiere consultar medicamentos
    else if (mensajeLower === '2' ||
             mensajeNormalizado.includes('stock') || 
             mensajeNormalizado.includes('medicamento') ||
             mensajeNormalizado.includes('medicina') ||
             mensajeNormalizado.includes('farmacia')) {
      state = { step: 'medicamento_nombre', data: {} };
    } 
    // Detectar si quiere consultar hábitos de higiene
    else if (mensajeLower === '3' ||
             mensajeNormalizado.includes('habito') || 
             mensajeNormalizado.includes('higiene') ||
             mensajeNormalizado.includes('limpieza') ||
             mensajeNormalizado.includes('limpiar') ||
             mensajeNormalizado.includes('aseo')) {
      state = { step: 'higiene_consulta', data: {} };
    }

    // Máquina de estados
    switch (state.step) {
      case 'menu':
        response = `¡Hola! Te saluda BOTica, tu chatbot clínico favorito. Por favor indícame cómo te puedo ayudar:

1.- Agendar cita con alguna especialidad
2.- Consultar stock de medicamentos
3.- Consultar buenos hábitos de higiene`;
        
        // Detectar selección por número o por palabras clave
        const opcionNormalizada = normalizarTexto(message);
        
        if (message.trim() === '1' || 
            opcionNormalizada.includes('agendar') || 
            opcionNormalizada.includes('cita') ||
            opcionNormalizada.includes('especialidad')) {
          state.step = 'agendar_fecha';
        } else if (message.trim() === '2' || 
                   opcionNormalizada.includes('stock') || 
                   opcionNormalizada.includes('medicamento') ||
                   opcionNormalizada.includes('medicina')) {
          state.step = 'medicamento_nombre';
        } else if (message.trim() === '3' || 
                   opcionNormalizada.includes('habito') || 
                   opcionNormalizada.includes('higiene') ||
                   opcionNormalizada.includes('limpieza')) {
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
              // Convertir UTC a hora de Lima para mostrar
              const horaLima = new Date(h.toLocaleString('en-US', { timeZone: 'America/Lima' }));
              response += `${i + 1}.- ${horaLima.toLocaleTimeString('es-PE', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: true
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
        try {
          const medicamento = await buscarMedicamentoEnSheet(message);
          
          if (medicamento && medicamento.enStock) {
            let respuesta = `El producto "${medicamento.nombre}" se encuentra en stock`;
            
            // Agregar información sobre cantidad si está disponible
            if (medicamento.stock > 0) {
              respuesta += ` (${medicamento.stock} unidades disponibles)`;
            }
            
            // Agregar información sobre receta médica
            if (medicamento.requiereReceta) {
              respuesta += `.\n\n⚠️ Este medicamento requiere receta médica para su venta`;
            }
            
            respuesta += `.\n\nPuedes acercarte a comprarlo. Por favor indícame si te puedo ayudar en algo adicional`;
            
            response = respuesta;
            state.step = 'menu';
          } else if (medicamento && !medicamento.enStock) {
            response = `El producto "${medicamento.nombre}" existe en nuestro catálogo pero actualmente no tiene stock disponible. ¿Deseas probar con otro medicamento? (Sí/No)`;
            state.step = 'medicamento_reintentar';
          } else {
            response = 'El producto no se encuentra en nuestro catálogo. ¿Deseas probar con otro? (Sí/No)';
            state.step = 'medicamento_reintentar';
          }
        } catch (error) {
          console.error('Error al buscar medicamento:', error);
          response = 'Ocurrió un error al consultar el inventario. Por favor intenta nuevamente.';
          state.step = 'menu';
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
          const consultaNormalizada = normalizarTexto(message);
          
          // Verificar si quiere volver al menú o cambiar de opción
          if (consultaNormalizada.includes('agendar') || consultaNormalizada.includes('cita')) {
            state = { step: 'agendar_fecha', data: {} };
            response = 'Por favor indica en qué día deseas agendar la cita (formato DD/MM/YYYY)';
          } else if (consultaNormalizada.includes('stock') || 
                     consultaNormalizada.includes('medicamento')) {
            state = { step: 'medicamento_nombre', data: {} };
            response = 'Por favor escribe el nombre del medicamento que estás buscando';
          } else {
            const resultado = await consultarAsistente(message, state.data.assistantThreadId);
            
            // Procesar la respuesta para limpiar listas numeradas mal formateadas
            let respuestaLimpia = resultado.respuesta;
            
            // Detectar y corregir listas numeradas que vienen del asistente
            // Patrón: líneas que empiezan con número seguido de punto
            const lineas = respuestaLimpia.split('\n');
            let dentroLista = false;
            let contadorLista = 1;
            
            const lineasProcesadas = lineas.map((linea, index) => {
              // Detectar si es un item de lista (formato: "1. texto" o "1) texto")
              const esItemLista = /^\s*\d+[\.\)]\s+/.test(linea);
              
              if (esItemLista) {
                if (!dentroLista) {
                  dentroLista = true;
                  contadorLista = 1;
                }
                // Reemplazar el número con el contador correcto
                const textoSinNumero = linea.replace(/^\s*\d+[\.\)]\s+/, '');
                const lineaCorregida = `${contadorLista}. ${textoSinNumero}`;
                contadorLista++;
                return lineaCorregida;
              } else {
                // Si no es item de lista, resetear el contador si estábamos en una lista
                if (dentroLista && linea.trim() !== '') {
                  dentroLista = false;
                  contadorLista = 1;
                }
                return linea;
              }
            });
            
            respuestaLimpia = lineasProcesadas.join('\n');
            
            response = respuestaLimpia;
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
    sheets: sheets ? 'Connected' : 'Not configured',
    openai: process.env.OPENAI_API_KEY ? 'Configured' : 'Not configured'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
