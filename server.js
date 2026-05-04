require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.log('⚠️ MongoDB:', err.message));
}

// ============ SERVICIO SMS INCORPORADO ============
// Para evitar problemas de carga de archivos, el servicio está aquí mismo

const axios = require('axios');

class TempSmsService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 30000;
  }

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

  async getAllNumbers(country = 'US') {
    const cacheKey = `numbers_${country}`;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
    }
    
    console.log(`🔍 Buscando números en ${country}...`);
    
    const results = await Promise.allSettled([
      this.getReceiveSmsNumbers(country),
      this.getFreeSmsNumbers(country)
    ]);
    
    const allNumbers = [];
    
    results.forEach((result, index) => {
      const sources = ['receivesms', 'sms24'];
      if (result.status === 'fulfilled' && result.value.length > 0) {
        console.log(`✅ ${sources[index]}: ${result.value.length} números`);
        allNumbers.push(...result.value);
      } else {
        console.log(`❌ ${sources[index]}: No disponible`);
      }
    });
    
    // Guardar en caché
    this.cache.set(cacheKey, { data: allNumbers, timestamp: Date.now() });
    
    return allNumbers;
  }

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

  extractOTP(message) {
    const text = message.text || message.body || message || '';
    const patterns = [
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
}

const tempSmsService = new TempSmsService();
console.log('✅ Servicio SMS inicializado');

// ============ RUTAS ============

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    smsService: 'loaded (inline)',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/numbers', async (req, res) => {
  try {
    const country = req.query.country || 'US';
    const numbers = await tempSmsService.getAllNumbers(country);
    
    if (numbers.length > 0) {
      return res.json({ success: true, country, numbers, total: numbers.length });
    }
    
    // Solo si no hay números reales, usar backup
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
      note: 'Números de respaldo - servicio externo no disponible'
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.json({
      success: true,
      country: req.query.country || 'US',
      numbers: [{ number: '+447123456789', country: 'UK', provider: 'emergency' }],
      total: 1
    });
  }
});

// API de mensajes con monitoreo real
app.get('/api/messages/:number', async (req, res) => {
  try {
    const { number } = req.params;
    const { provider } = req.query;
    const messages = await tempSmsService.getMessages(number, provider);
    
    const messagesWithOTP = messages.map(msg => ({
      ...msg,
      otp: tempSmsService.extractOTP(msg)
    }));
    
    res.json({ success: true, number, messages: messagesWithOTP, total: messagesWithOTP.length });
  } catch (error) {
    res.json({ success: true, number: req.params.number, messages: [], total: 0 });
  }
});

// Socket.IO con monitoreo real
const activeMonitors = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Cliente conectado:', socket.id);
  
  socket.on('monitor-number', (data) => {
    const { number, provider } = data;
    const monitorKey = `${number}-${provider}`;
    
    if (activeMonitors.has(monitorKey)) {
      clearInterval(activeMonitors.get(monitorKey));
    }
    
    console.log(`📱 Iniciando monitoreo: ${number}`);
    
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
        // Silencioso
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
    }
  });
  
  socket.on('disconnect', () => {
    for (const [key, interval] of activeMonitors.entries()) {
      clearInterval(interval);
    }
    activeMonitors.clear();
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
});
