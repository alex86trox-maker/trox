require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const tempSmsService = require('./services/tempSmsService');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sms-verification';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Conectado a MongoDB'))
  .catch(err => console.error('❌ Error conectando a MongoDB:', err));

// Health check
app.get('/health', async (req, res) => {
  const dbState = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.json({
    status: 'ok',
    database: dbState,
    timestamp: new Date().toISOString()
  });
});

// API: Obtener números disponibles
app.get('/api/numbers', async (req, res) => {
  try {
    const country = req.query.country || 'US';
    const numbers = await tempSmsService.getAllNumbers(country);
    
    res.json({
      success: true,
      country,
      numbers,
      total: numbers.length
    });
  } catch (error) {
    console.error('Error en /api/numbers:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener números'
    });
  }
});

// API: Obtener mensajes guardados
app.get('/api/messages/:number', async (req, res) => {
  try {
    const { number } = req.params;
    const { provider } = req.query;
    
    const query = { number };
    if (provider) query.provider = provider;
    
    const messages = await Message.find(query)
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();
    
    res.json({
      success: true,
      number,
      messages,
      total: messages.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error al obtener mensajes'
    });
  }
});

// Socket.IO para monitoreo en tiempo real
const activeMonitors = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Cliente conectado:', socket.id);
  
  socket.on('monitor-number', async (data) => {
    const { number, provider } = data;
    const monitorKey = `${number}-${provider}`;
    
    if (activeMonitors.has(monitorKey)) {
      clearInterval(activeMonitors.get(monitorKey));
    }
    
    console.log(`📱 Monitoreando: ${number} (${provider})`);
    
    const intervalId = setInterval(async () => {
      try {
        const messages = await tempSmsService.getMessages(number, provider);
        
        for (const msg of messages) {
          const messageText = msg.text || msg.body || '';
          const otp = tempSmsService.extractOTP(messageText);
          
          const exists = await Message.findOne({
            number,
            text: messageText,
            timestamp: { $gte: new Date(Date.now() - 60000) }
          });
          
          if (!exists) {
            const newMessage = await Message.create({
              number,
              provider,
              from: msg.from || 'Unknown',
              text: messageText,
              otp
            });
            
            socket.emit('new-message', newMessage.toObject());
            
            if (otp) {
              socket.emit('otp-detected', {
                number,
                otp,
                fullMessage: messageText
              });
            }
          }
        }
      } catch (error) {
        console.error('Error en monitoreo:', error.message);
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
    }
  });
  
  socket.on('disconnect', () => {
    for (const [key, interval] of activeMonitors.entries()) {
      clearInterval(interval);
    }
    activeMonitors.clear();
  });
});

// Servir el frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log('💾 MongoDB conectado');
});

process.on('unhandledRejection', (error) => {
  console.error('Error:', error);
});
