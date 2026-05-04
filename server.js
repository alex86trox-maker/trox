require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ MONGODB ============
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.log('⚠️ MongoDB:', err.message));
}

// ============ SERVICIO SMS COMPLETO ============
class TempSmsService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 30000;
  }

  // Proveedor 1: ReceiveSMS.co
  async getReceiveSmsNumbers(country = 'US') {
    const countryCodes = { 'US': '1', 'UK': '44', 'ES': '34', 'CA': '1', 'FR': '33' };
    
    try {
      const response = await axios.get(
        `https://www.receivesms.co/api/numbers/${countryCodes[country] || '1'}`,
        { timeout: 8000 }
      );
      
      if (response.data && response.data.numbers) {
        return response.data.numbers.map(num => ({
          number: num.phoneNumber || num.number,
          country: country,
          provider: 'receivesms',
          lastMessage: num.lastMessage || ''
        }));
      }
      return [];
    } catch (error) {
      console.log('ReceiveSMS.co no disponible:', error.message);
      return [];
    }
  }

  // Proveedor 2: SMS24.info
  async getFreeSmsNumbers(country = 'US') {
    try {
      const response = await axios.get(
        'https://sms24.info/api/v1/numbers',
        { timeout: 8000 }
      );
      
      if (response.data && response.data.numbers) {
        return response.data.numbers
          .filter(n => n.country === country || !n.country)
          .map(num => ({
            number: num.number,
            country: country,
            provider: 'sms24'
          }));
      }
      return [];
    } catch (error) {
      console.log('SMS24 no disponible:', error.message);
      return [];
    }
  }

  // Proveedor 3: SMS-Activate (números reales para Telegram)
  async getSmsActivateNumbers(country = 'US') {
    const countryMap = {
      'US': 'us', 'UK': 'gb', 'ES': 'es', 'CA': 'ca', 'FR': 'fr'
    };
    
    try {
      const response = await axios.get(
        `https://api.sms-activate.org/stubs/handler_api.php?api_key=&action=getNumbersStatus&country=${countryMap[country] || 'us'}`,
        { timeout: 8000 }
      );
      
      const numbers = [];
      if (response.data && typeof response.data === 'object') {
        for (const [service, count] of Object.entries(response.data)) {
          if (count > 0 && service.startsWith('tg')) {
            numbers.push({
              service: 'Telegram',
              available: count,
              provider: 'sms-activate',
              country: country,
              note: 'Números reales - requieren compra'
            });
          }
        }
      }
      return numbers;
    } catch (error) {
      console.log('SMS-Activate consulta:', error.message);
      return [];
    }
  }

  // Obtener TODOS los números disponibles
  async getAllNumbers(country = 'US') {
    const cacheKey = `numbers_${country}`;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        console.log('📦 Usando caché');
        return cached.data;
      }
    }
    
    console.log(`🔍 Buscando números en ${country}...`);
    
    const results = await Promise.allSettled([
      this.getReceiveSmsNumbers(country),
      this.getFreeSmsNumbers(country),
      this.getSmsActivateNumbers(country)
    ]);
    
    const allNumbers = [];
    
    results.forEach((result, index) => {
      const sources = ['receivesms', 'sms24', 'sms-activate'];
      if (result.status === 'fulfilled' && result.value.length > 0) {
        console.log(`✅ ${sources[index]}: ${result.value.length} números`);
        allNumbers.push(...result.value);
      } else {
        console.log(`❌ ${sources[index]}: No disponible`);
      }
    });
    
    this.cache.set(cacheKey, { data: allNumbers, timestamp: Date.now() });
    
    return allNumbers;
  }

  // Obtener mensajes de un número
  async getMessages(number, provider) {
    try {
      const cleanNumber = number.replace(/[^\d]/g, '');
      const response = await axios.get(
        `https://www.receivesms.co/api/messages/${cleanNumber}`,
        { timeout: 5000 }
      );
      
      if (response.data && response.data.messages) {
        return response.data.messages.map(msg => ({
          from: msg.sender || msg.from || 'Unknown',
          text: msg.text || msg.body || msg.message || '',
          time: msg.time || msg.date || new Date().toISOString()
        }));
      }
      return [];
    } catch (error) {
      return [];
    }
  }

  // Extraer código OTP
  extractOTP(message) {
    const text = message.text || message.body || message || '';
    const patterns = [
      /Telegram.*?code[:\s]*(\d{5,6})/i,
      /(\d{5,6})/g,
      /code[:\s]*(\d{4,8})/i,
      /otp[:\s]*(\d{4,8})/i,
      /verification[:\s]*(\d{4,8})/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0].replace(/[^\d]/g, '');
    }
    return null;
  }

  // Limpiar caché
  clearCache() {
    this.cache.clear();
  }
}

const tempSmsService = new TempSmsService();
console.log('✅ Servicio SMS inicializado (3 proveedores)');

// ============ RUTAS API ============

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    smsService: 'loaded (inline - 3 providers)',
    providers: ['receivesms', 'sms24', 'sms-activate'],
    timestamp: new Date().toISOString()
  });
});

// Obtener números disponibles
app.get('/api/numbers', async (req, res) => {
  try {
    const country = req.query.country || 'US';
    const numbers = await tempSmsService.getAllNumbers(country);
    
    if (numbers.length > 0) {
      return res.json({ 
        success: true, 
        country, 
        numbers, 
        total: numbers.length,
        source: 'live'
      });
    }
    
    // Números de respaldo SOLO si no hay números reales
    const backup = {
      'ES': [
        { number: '+34612345678', country: 'ES', provider: 'backup' },
        { number: '+34687654321', country: 'ES', provider: 'backup' }
      ],
      'US': [
        { number: '+12345678901', country: 'US', provider: 'backup' }
      ],
      'UK': [
        { number: '+447123456789', country: 'UK', provider: 'backup' }
      ]
    };
    
    res.json({ 
      success: true, 
      country, 
      numbers: backup[country] || backup['US'], 
      total: backup[country]?.length || 1,
      source: 'backup',
      note: 'Servicio externo no disponible - números de respaldo'
    });
    
  } catch (error) {
    console.error('Error en /api/numbers:', error.message);
    res.json({
      success: true,
      country: req.query.country || 'US',
      numbers: [{ number: '+447123456789', country: 'UK', provider: 'emergency' }],
      total: 1,
      source: 'emergency'
    });
  }
});

// Obtener mensajes de un número
app.get('/api/messages/:number', async (req, res) => {
  try {
    const { number } = req.params;
    const { provider } = req.query;
    const messages = await tempSmsService.getMessages(number, provider);
    
    const messagesWithOTP = messages.map(msg => ({
      ...msg,
      otp: tempSmsService.extractOTP(msg)
    }));
    
    res.json({ 
      success: true, 
      number, 
      messages: messagesWithOTP, 
      total: messagesWithOTP.length 
    });
  } catch (error) {
    res.json({ 
      success: true, 
      number: req.params.number, 
      messages: [], 
      total: 0 
    });
  }
});

// ============ SOCKET.IO - MONITOREO EN TIEMPO REAL ============
const activeMonitors = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Cliente conectado:', socket.id);
  
  socket.on('monitor-number', (data) => {
    const { number, provider } = data;
    const monitorKey = `${number}-${provider}`;
    
    // Limpiar monitoreo anterior
    if (activeMonitors.has(monitorKey)) {
      clearInterval(activeMonitors.get(monitorKey));
    }
    
    console.log(`📱 Iniciando monitoreo: ${number} (${provider})`);
    
    // Enviar mensajes existentes
    tempSmsService.getMessages(number, provider).then(messages => {
      if (messages.length > 0) {
        messages.forEach(msg => {
          const otp = tempSmsService.extractOTP(msg);
          socket.emit('new-message', {
            from: msg.from || 'Unknown',
            text: msg.text || '',
            otp: otp,
            number: number,
            provider: provider,
            timestamp: new Date().toISOString()
          });
          if (otp) {
            socket.emit('otp-detected', { number, otp, fullMessage: msg.text });
          }
        });
      }
    });
    
    // Monitorear nuevos mensajes cada 3 segundos
    const intervalId = setInterval(async () => {
      try {
        const messages = await tempSmsService.getMessages(number, provider);
        
        for (const msg of messages) {
          const otp = tempSmsService.extractOTP(msg);
          const messageData = {
            from: msg.from || 'Unknown',
            text: msg.text || '',
            otp: otp,
            number: number,
            provider: provider,
            timestamp: new Date().toISOString()
          };
          
          socket.emit('new-message', messageData);
          
          if (otp) {
            socket.emit('otp-detected', { number, otp, fullMessage: msg.text });
          }
        }
      } catch (error) {
        // Silencioso - el proveedor puede no responder
      }
    }, 3000);
    
    activeMonitors.set(monitorKey, intervalId);
    socket.emit('monitoring-started', { number, provider });
  });
  
  socket.on('stop-monitoring', (data) => {
    const { number, provider } = data;
    const monitorKey = `${number}-${provider}`;
    
    if (activeMonitors.has(monitorKey)) {
      clearInterval(activeMonitors.get(monitorKey));
      activeMonitors.delete(monitorKey);
      socket.emit('monitoring-stopped', { number, provider });
      console.log(`⏹️ Monitoreo detenido: ${number}`);
    }
  });
  
  socket.on('disconnect', () => {
    for (const [key, interval] of activeMonitors.entries()) {
      clearInterval(interval);
    }
    activeMonitors.clear();
    console.log('🔌 Cliente desconectado:', socket.id);
  });
});

// ============ RUTA PRINCIPAL ============
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ INICIAR SERVIDOR ============
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📱 Panel: http://localhost:${PORT}`);
  console.log(`💾 MongoDB: ${MONGODB_URI ? 'Configurado' : 'No configurado'}`);
  console.log(`📡 Proveedores SMS: receivesms, sms24, sms-activate`);
});

// Manejo de errores no capturados
process.on('unhandledRejection', (error) => {
  console.error('Error no manejado:', error.message);
});

process.on('uncaughtException', (error) => {
  console.error('Excepción no capturada:', error.message);
});
