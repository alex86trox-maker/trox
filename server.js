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

// MongoDB - sin dependencia de modelos
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.log('⚠️ MongoDB:', err.message));
}

// Cargar servicio SMS
let tempSmsService = null;
try {
  tempSmsService = require('./services/tempSmsService');
  console.log('✅ Servicio SMS cargado');
} catch (error) {
  console.log('⚠️ Servicio SMS no disponible:', error.message);
}

// ============ RUTAS ============

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    smsService: tempSmsService ? 'loaded' : 'not loaded',
    timestamp: new Date().toISOString()
  });
});

// API: Números disponibles
app.get('/api/numbers', async (req, res) => {
  try {
    const country = req.query.country || 'US';
    
    if (tempSmsService) {
      const numbers = await tempSmsService.getAllNumbers(country);
      if (numbers.length > 0) {
        return res.json({ success: true, country, numbers, total: numbers.length });
      }
    }
    
    // Números de respaldo
    const backupNumbers = {
      'US': [
        { number: '+12345678901', country: 'US', provider: 'backup' },
        { number: '+12345678902', country: 'US', provider: 'backup' }
      ],
      'UK': [
        { number: '+447123456789', country: 'UK', provider: 'backup' },
        { number: '+447123456780', country: 'UK', provider: 'backup' }
      ],
      'ES': [
        { number: '+34612345678', country: 'ES', provider: 'backup' },
        { number: '+34612345679', country: 'ES', provider: 'backup' }
      ]
    };
    
    const numbers = backupNumbers[country] || backupNumbers['US'];
    res.json({ success: true, country, numbers, total: numbers.length });
    
  } catch (error) {
    console.error('Error:', error.message);
    // Respuesta de emergencia
    res.json({
      success: true,
      country: req.query.country || 'US',
      numbers: [
        { number: '+447123456789', country: 'UK', provider: 'emergency' }
      ],
      total: 1
    });
  }
});

// API: Mensajes (versión simplificada)
app.get('/api/messages/:number', (req, res) => {
  res.json({
    success: true,
    number: req.params.number,
    messages: [],
    total: 0
  });
});

// Socket.IO básico
io.on('connection', (socket) => {
  console.log('🔌 Cliente conectado:', socket.id);
  
  socket.on('monitor-number', (data) => {
    console.log('📱 Monitoreando:', data);
    socket.emit('monitoring-started', data);
  });
  
  socket.on('stop-monitoring', (data) => {
    socket.emit('monitoring-stopped', data);
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Cliente desconectado');
  });
});

// Ruta principal
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Puerto
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
});
