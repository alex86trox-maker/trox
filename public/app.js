// ==========================================
// CONFIGURACIÓN INICIAL
// ==========================================
const API_URL = window.location.origin;
const socket = io(API_URL);

// Variables de estado
let selectedNumber = null;
let selectedProvider = null;
let currentOTP = null;
let isMonitoring = false;
let messagePollingInterval = null;
let connectionRetries = 0;
const MAX_RETRIES = 5;

// ==========================================
// INICIALIZACIÓN
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 App iniciada');
    console.log('📍 API URL:', API_URL);
    
    // Cargar números al iniciar
    loadNumbers();
    
    // Configurar listeners de Socket.IO
    setupSocketListeners();
    
    // Configurar eventos de UI
    setupUIEvents();
    
    // Verificar salud del servidor
    checkServerHealth();
});

// ==========================================
// EVENTOS DE UI
// ==========================================
function setupUIEvents() {
    // Cambio de país
    const countrySelect = document.getElementById('countrySelect');
    if (countrySelect) {
        countrySelect.addEventListener('change', () => {
            stopMonitoring();
            loadNumbers();
        });
    }
    
    // Botón de actualizar
    const refreshBtn = document.querySelector('.btn-refresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando...';
            
            loadNumbers().finally(() => {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Actualizar';
            });
        });
    }
    
    // Tecla Escape para cerrar panel OTP
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideOTPPanel();
        }
    });
}

// ==========================================
// VERIFICAR SALUD DEL SERVIDOR
// ==========================================
async function checkServerHealth() {
    try {
        const response = await fetch(`${API_URL}/health`);
        const data = await response.json();
        
        console.log('✅ Servidor saludable:', data);
        updateConnectionStatus('connected');
        
        // Mostrar info en consola
        if (data.database === 'connected') {
            console.log('💾 Base de datos conectada');
        }
    } catch (error) {
        console.error('❌ Error de conexión:', error.message);
        updateConnectionStatus('error');
        
        // Reintentar conexión
        if (connectionRetries < MAX_RETRIES) {
            connectionRetries++;
            console.log(`🔄 Reintentando conexión (${connectionRetries}/${MAX_RETRIES})...`);
            setTimeout(checkServerHealth, 5000);
        }
    }
}

// ==========================================
// CARGAR NÚMEROS DISPONIBLES
// ==========================================
async function loadNumbers() {
    const country = document.getElementById('countrySelect')?.value || 'US';
    const numbersList = document.getElementById('numbersList');
    
    if (!numbersList) return;
    
    // Mostrar estado de carga
    showLoadingState(numbersList, `Buscando números en ${getCountryName(country)}...`);
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 segundos timeout
        
        const response = await fetch(`${API_URL}/api/numbers?country=${country}`, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Error desconocido');
        }
        
        if (data.numbers.length === 0) {
            showEmptyState(numbersList, country);
            return;
        }
        
        // Mostrar números
        displayNumbers(data.numbers);
        updateConnectionStatus('connected');
        connectionRetries = 0;
        
        console.log(`✅ ${data.numbers.length} números cargados de ${data.country}`);
        
    } catch (error) {
        console.error('❌ Error cargando números:', error.message);
        
        if (error.name === 'AbortError') {
            showErrorState(numbersList, 'Tiempo de espera agotado');
        } else if (!navigator.onLine) {
            showErrorState(numbersList, 'Sin conexión a internet');
        } else {
            showErrorState(numbersList, 'Error al cargar números');
        }
        
        updateConnectionStatus('error');
    }
}

// ==========================================
// ESTADOS DE LA LISTA DE NÚMEROS
// ==========================================
function showLoadingState(container, message) {
    container.innerHTML = `
        <div class="text-center py-5">
            <div class="spinner mx-auto mb-3"></div>
            <p class="placeholder-text">${message}</p>
            <small style="color: #555;">Consultando múltiples proveedores...</small>
        </div>
    `;
}

function showEmptyState(container, country) {
    container.innerHTML = `
        <div class="text-center py-5">
            <i class="fas fa-inbox" style="font-size: 3rem; color: #ffa500;"></i>
            <p class="placeholder-text mt-3">No hay números disponibles en ${getCountryName(country)}</p>
            <small style="color: #888;">Esto puede deberse a alta demanda. Intenta con otro país.</small>
            <br>
            <button class="btn-refresh mt-3" onclick="loadNumbers()">
                <i class="fas fa-redo"></i> Reintentar
            </button>
            <br>
            <small style="color: #555; margin-top: 8px; display: block;">
                <i class="fas fa-lightbulb"></i> Consejo: Los números de UK suelen tener mejor disponibilidad
            </small>
        </div>
    `;
}

function showErrorState(container, message) {
    container.innerHTML = `
        <div class="text-center py-5">
            <i class="fas fa-exclamation-circle" style="font-size: 3rem; color: #e74c3c;"></i>
            <p class="placeholder-text mt-3">${message}</p>
            <small style="color: #888;">Verifica tu conexión e intenta de nuevo</small>
            <br>
            <button class="btn-refresh mt-3" onclick="loadNumbers()">
                <i class="fas fa-redo"></i> Reintentar
            </button>
            ${!navigator.onLine ? `
                <br>
                <small style="color: #e74c3c; margin-top: 8px; display: block;">
                    <i class="fas fa-wifi"></i> Sin conexión a internet
                </small>
            ` : ''}
        </div>
    `;
}

// ==========================================
// MOSTRAR NÚMEROS EN LA LISTA
// ==========================================
function displayNumbers(numbers) {
    const numbersList = document.getElementById('numbersList');
    if (!numbersList) return;
    
    // Agrupar por proveedor
    const grouped = groupBy(numbers, 'provider');
    
    let html = '';
    let totalCount = 0;
    
    for (const [provider, nums] of Object.entries(grouped)) {
        const providerName = getProviderDisplayName(provider);
        
        html += `
            <div class="mb-3">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <small style="color: #888; text-transform: uppercase; letter-spacing: 1px; font-size: 0.7rem;">
                        <i class="fas fa-server"></i> ${providerName}
                    </small>
                    <small style="color: #555; font-size: 0.7rem;">${nums.length} números</small>
                </div>
        `;
        
        nums.forEach(num => {
            totalCount++;
            const isActive = selectedNumber === num.number && selectedProvider === num.provider;
            
            html += `
                <div class="number-card ${isActive ? 'active' : ''}" 
                     onclick="selectNumber('${escapeHtml(num.number)}', '${escapeHtml(num.provider)}')"
                     title="Clic para seleccionar este número">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <div class="phone-number">
                                <i class="fas fa-phone-alt" style="font-size: 0.7rem; color: #25D366; margin-right: 5px;"></i>
                                ${num.number}
                            </div>
                            ${num.lastMessage ? `
                                <small style="color: #888; font-size: 0.7rem; display: block; margin-top: 4px;">
                                    <i class="fas fa-comment"></i> ${num.lastMessage.substring(0, 50)}...
                                </small>
                            ` : `
                                <small style="color: #555; font-size: 0.7rem; display: block; margin-top: 4px;">
                                    <i class="fas fa-clock"></i> Sin mensajes recientes
                                </small>
                            `}
                        </div>
                        <div class="text-end">
                            <span class="status-badge status-available">
                                <i class="fas fa-check-circle"></i> Disponible
                            </span>
                            ${num.service ? `
                                <br>
                                <small style="color: #888; font-size: 0.65rem;">${num.service}</small>
                            ` : ''}
                        </div>
                    </div>
                    ${isActive ? `
                        <div style="margin-top: 8px;">
                            <small style="color: #25D366;">
                                <i class="fas fa-broadcast-tower"></i> Monitoreando en tiempo real...
                            </small>
                        </div>
                    ` : ''}
                </div>
            `;
        });
        
        html += '</div>';
    }
    
    numbersList.innerHTML = html;
    
    console.log(`📊 Mostrando ${totalCount} números de ${Object.keys(grouped).length} proveedores`);
}

// ==========================================
// SELECCIONAR NÚMERO PARA MONITOREAR
// ==========================================
function selectNumber(number, provider) {
    console.log(`📱 Seleccionando número: ${number} (${provider})`);
    
    // Detener monitoreo anterior
    if (isMonitoring) {
        stopMonitoring();
    }
    
    // Actualizar selección
    selectedNumber = number;
    selectedProvider = provider;
    
    // Actualizar UI
    updateSelectedNumberDisplay(number);
    
    // Limpiar área de mensajes
    clearMessagesArea();
    
    // Ocultar panel OTP
    hideOTPPanel();
    
    // Actualizar clases activas en la lista
    updateActiveNumberCard();
    
    // Iniciar monitoreo con Socket.IO
    startMonitoring(number, provider);
    
    // Cargar mensajes existentes desde la API
    loadExistingMessages(number, provider);
    
    // Scroll al área de mensajes en móvil
    if (window.innerWidth < 768) {
        document.getElementById('messagesArea')?.scrollIntoView({ behavior: 'smooth' });
    }
}

// ==========================================
// INICIAR MONITOREO
// ==========================================
function startMonitoring(number, provider) {
    if (isMonitoring) {
        stopMonitoring();
    }
    
    isMonitoring = true;
    
    // Emitir evento de Socket.IO
    socket.emit('monitor-number', { 
        number: number, 
        provider: provider 
    });
    
    console.log(`🔍 Monitoreo iniciado: ${number} (${provider})`);
    
    // También hacer polling cada 5 segundos como respaldo
    messagePollingInterval = setInterval(() => {
        if (selectedNumber && selectedProvider) {
            pollNewMessages(selectedNumber, selectedProvider);
        }
    }, 5000);
}

// ==========================================
// DETENER MONITOREO
// ==========================================
function stopMonitoring() {
    if (selectedNumber && selectedProvider) {
        socket.emit('stop-monitoring', {
            number: selectedNumber,
            provider: selectedProvider
        });
        
        console.log(`⏹️ Monitoreo detenido: ${selectedNumber}`);
    }
    
    isMonitoring = false;
    
    // Limpiar intervalo de polling
    if (messagePollingInterval) {
        clearInterval(messagePollingInterval);
        messagePollingInterval = null;
    }
}

// ==========================================
// POLLING DE NUEVOS MENSAJES (RESPALDO)
// ==========================================
let lastMessageTexts = new Set();

async function pollNewMessages(number, provider) {
    try {
        const response = await fetch(`${API_URL}/api/messages/${encodeURIComponent(number)}?provider=${encodeURIComponent(provider)}`);
        
        if (!response.ok) return;
        
        const data = await response.json();
        
        if (data.success && data.messages) {
            data.messages.forEach(msg => {
                const msgKey = `${msg.from}-${msg.text}-${msg.time}`;
                
                // Solo mostrar mensajes nuevos
                if (!lastMessageTexts.has(msgKey)) {
                    lastMessageTexts.add(msgKey);
                    
                    // Verificar OTP
                    const otp = msg.otp || extractOTPFromText(msg.text);
                    
                    displayMessage({
                        ...msg,
                        otp: otp
                    });
                    
                    if (otp) {
                        showOTPPanel(otp);
                    }
                }
            });
            
            // Limpiar set si crece mucho
            if (lastMessageTexts.size > 100) {
                lastMessageTexts = new Set([...lastMessageTexts].slice(-50));
            }
        }
    } catch (error) {
        // Silencioso - el Socket.IO es el método principal
    }
}

// ==========================================
// CARGAR MENSAJES EXISTENTES
// ==========================================
async function loadExistingMessages(number, provider) {
    try {
        const response = await fetch(
            `${API_URL}/api/messages/${encodeURIComponent(number)}?provider=${encodeURIComponent(provider)}`
        );
        
        if (!response.ok) return;
        
        const data = await response.json();
        
        if (data.success && data.messages.length > 0) {
            const messagesArea = document.getElementById('messagesArea');
            if (messagesArea) {
                messagesArea.innerHTML = '';
            }
            
            // Inicializar set de mensajes conocidos
            lastMessageTexts.clear();
            
            data.messages.forEach(msg => {
                const msgKey = `${msg.from}-${msg.text}-${msg.time}`;
                lastMessageTexts.add(msgKey);
                
                const otp = msg.otp || extractOTPFromText(msg.text);
                
                displayMessage({
                    ...msg,
                    otp: otp
                });
            });
            
            updateMessageCount(data.messages.length);
            console.log(`📬 ${data.messages.length} mensajes cargados`);
        }
    } catch (error) {
        console.error('Error cargando mensajes existentes:', error.message);
    }
}

// ==========================================
// MOSTRAR MENSAJE EN LA INTERFAZ
// ==========================================
function displayMessage(message) {
    const messagesArea = document.getElementById('messagesArea');
    if (!messagesArea) return;
    
    // Limpiar placeholder
    const placeholder = messagesArea.querySelector('.text-center');
    if (placeholder && placeholder.querySelector('.placeholder-icon')) {
        messagesArea.innerHTML = '';
    }
    
    // Crear elemento de mensaje
    const messageElement = document.createElement('div');
    messageElement.className = 'message-bubble fade-in';
    
    const time = message.timestamp 
        ? formatTime(message.timestamp)
        : formatTime(new Date().toISOString());
    
    const fromDisplay = message.from && message.from !== 'Unknown' 
        ? message.from 
        : 'Servicio de verificación';
    
    messageElement.innerHTML = `
        <div class="msg-header">
            <span class="msg-from">
                <i class="fas fa-user-circle"></i> ${escapeHtml(fromDisplay)}
            </span>
            <span class="msg-time">
                <i class="far fa-clock"></i> ${time}
            </span>
        </div>
        <div class="msg-text">${escapeHtml(message.text)}</div>
        ${message.otp ? `
            <div class="otp-badge" onclick="copyOTPFromBadge('${message.otp}')" 
                 title="Clic para copiar" style="cursor: pointer;">
                <i class="fas fa-key"></i> Código: ${message.otp}
                <i class="fas fa-copy" style="margin-left: 8px; font-size: 0.7rem;"></i>
            </div>
        ` : ''}
        ${message.mediaUrl ? `
            <div style="margin-top: 8px;">
                <small style="color: #888;">
                    <i class="fas fa-paperclip"></i> Archivo adjunto
                </small>
            </div>
        ` : ''}
    `;
    
    // Insertar al principio
    messagesArea.insertBefore(messageElement, messagesArea.firstChild);
    
    // Limitar número de mensajes en pantalla
    const maxMessages = 50;
    while (messagesArea.children.length > maxMessages) {
        messagesArea.removeChild(messagesArea.lastChild);
    }
    
    // Actualizar contador
    const count = messagesArea.querySelectorAll('.message-bubble').length;
    updateMessageCount(count);
    
    // Si tiene OTP, mostrarlo
    if (message.otp) {
        showOTPPanel(message.otp);
    }
    
    // Scroll al último mensaje
    messagesArea.scrollTop = 0;
}

// ==========================================
// MOSTRAR PANEL DE OTP
// ==========================================
function showOTPPanel(otp) {
    if (!otp || otp.length < 4) return;
    
    currentOTP = otp;
    
    const otpPanel = document.getElementById('otpPanel');
    const otpCode = document.getElementById('otpCode');
    
    if (!otpPanel || !otpCode) return;
    
    otpCode.textContent = otp;
    otpPanel.classList.add('show');
    
    // Scroll hacia el panel
    setTimeout(() => {
        otpPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    
    // Auto-copiar
    copyToClipboard(otp, true);
    
    // Notificación
    showToast('🎉 ¡Código detectado y copiado!', 'success');
    
    // Vibración en móvil si está disponible
    if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100]);
    }
}

function hideOTPPanel() {
    const otpPanel = document.getElementById('otpPanel');
    if (otpPanel) {
        otpPanel.classList.remove('show');
    }
    currentOTP = null;
}

// ==========================================
// COPIAR AL PORTAPAPELES
// ==========================================
async function copyToClipboard(text, silent = false) {
    try {
        await navigator.clipboard.writeText(text);
        
        const btnCopy = document.getElementById('btnCopy');
        if (btnCopy) {
            const originalHTML = btnCopy.innerHTML;
            btnCopy.innerHTML = '<i class="fas fa-check"></i> ¡Copiado!';
            btnCopy.classList.add('copied');
            
            setTimeout(() => {
                btnCopy.innerHTML = originalHTML;
                btnCopy.classList.remove('copied');
            }, 2000);
        }
        
        if (!silent) {
            showToast('✅ Código copiado al portapapeles', 'success');
        }
        
        return true;
    } catch (error) {
        console.error('Error al copiar:', error);
        
        // Fallback: seleccionar texto manualmente
        const otpCode = document.getElementById('otpCode');
        if (otpCode) {
            const range = document.createRange();
            range.selectNode(otpCode);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            
            showToast('📋 Selecciona y copia el código manualmente', 'warning');
        }
        
        return false;
    }
}

function copyOTP() {
    if (currentOTP) {
        copyToClipboard(currentOTP);
    }
}

function copyOTPFromBadge(otp) {
    if (otp) {
        copyToClipboard(otp);
        showToast('✅ Código copiado', 'success');
    }
}

// ==========================================
// SOCKET.IO LISTENERS
// ==========================================
function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('🔌 Conectado al servidor via WebSocket');
        updateConnectionStatus('connected');
        connectionRetries = 0;
    });
    
    socket.on('disconnect', (reason) => {
        console.log('🔌 Desconectado del servidor:', reason);
        updateConnectionStatus('error');
        
        // Reconectar automáticamente
        if (reason === 'io server disconnect') {
            socket.connect();
        }
    });
    
    socket.on('connect_error', (error) => {
        console.error('Error de conexión:', error.message);
        updateConnectionStatus('error');
    });
    
    socket.on('monitoring-started', (data) => {
        console.log('✅ Monitoreo iniciado:', data);
        showToast(`📱 Monitoreando ${data.number}`, 'info');
    });
    
    socket.on('monitoring-stopped', (data) => {
        console.log('⏹️ Monitoreo detenido:', data);
    });
    
    socket.on('existing-messages', (messages) => {
        if (messages && messages.length > 0) {
            const messagesArea = document.getElementById('messagesArea');
            if (messagesArea) {
                messagesArea.innerHTML = '';
            }
            
            lastMessageTexts.clear();
            
            messages.forEach(msg => {
                const msgKey = `${msg.from}-${msg.text}-${msg.time}`;
                lastMessageTexts.add(msgKey);
                displayMessage(msg);
            });
        }
    });
    
    socket.on('new-message', (message) => {
        console.log('📨 Nuevo mensaje recibido:', message);
        
        const msgKey = `${message.from}-${message.text}-${message.timestamp}`;
        if (!lastMessageTexts.has(msgKey)) {
            lastMessageTexts.add(msgKey);
            displayMessage(message);
        }
    });
    
    socket.on('otp-detected', (data) => {
        console.log('🔑 OTP detectado:', data);
        showOTPPanel(data.otp);
    });
    
    socket.on('error', (error) => {
        console.error('Error del servidor:', error);
        showToast('❌ Error del servidor', 'error');
    });
}

// ==========================================
// UTILIDADES
// ==========================================
function updateSelectedNumberDisplay(number) {
    const element = document.getElementById('currentNumber');
    if (element) {
        element.innerHTML = `
            <i class="fas fa-broadcast-tower" style="color: #25D366;"></i> 
            Monitoreando: <strong>${number}</strong>
        `;
    }
}

function clearMessagesArea() {
    const messagesArea = document.getElementById('messagesArea');
    if (messagesArea) {
        messagesArea.innerHTML = `
            <div class="text-center py-5">
                <div class="spinner mx-auto mb-3"></div>
                <p class="placeholder-text">Esperando mensajes entrantes...</p>
                <small style="color: #888;">
                    <i class="fas fa-info-circle"></i> 
                    Usa este número para registrarte en el servicio deseado
                </small>
                <br>
                <small style="color: #555; margin-top: 8px; display: block;">
                    <i class="fas fa-lightbulb"></i> 
                    Consejo: El código suele llegar en 10-30 segundos
                </small>
            </div>
        `;
    }
    
    updateMessageCount(0);
    lastMessageTexts.clear();
}

function updateActiveNumberCard() {
    document.querySelectorAll('.number-card').forEach(card => {
        card.classList.remove('active');
    });
    
    if (selectedNumber) {
        const cards = document.querySelectorAll('.number-card');
        cards.forEach(card => {
            if (card.textContent.includes(selectedNumber)) {
                card.classList.add('active');
            }
        });
    }
}

function updateMessageCount(count) {
    const element = document.getElementById('messageCount');
    if (element) {
        element.textContent = `${count} mensaje${count !== 1 ? 's' : ''}`;
    }
}

function updateConnectionStatus(status) {
    const element = document.getElementById('connectionStatus');
    if (!element) return;
    
    const statusConfig = {
        'connected': {
            color: '#25D366',
            icon: 'fa-circle',
            text: 'Conectado'
        },
        'connecting': {
            color: '#ffa500',
            icon: 'fa-circle',
            text: 'Conectando...'
        },
        'error': {
            color: '#e74c3c',
            icon: 'fa-exclamation-circle',
            text: 'Desconectado'
        }
    };
    
    const config = statusConfig[status] || statusConfig['connecting'];
    
    element.innerHTML = `
        <i class="fas ${config.icon}" style="font-size: 0.5rem; color: ${config.color};"></i> 
        ${config.text}
    `;
}

function showToast(message, type = 'info') {
    // Eliminar toast anterior
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) {
        existingToast.remove();
    }
    
    const colors = {
        'success': '#25D366',
        'error': '#e74c3c',
        'warning': '#ffa500',
        'info': '#0088cc'
    };
    
    const icons = {
        'success': 'fa-check-circle',
        'error': 'fa-times-circle',
        'warning': 'fa-exclamation-triangle',
        'info': 'fa-info-circle'
    };
    
    const toast = document.createElement('div');
    toast.className = 'toast-notification fade-in';
    toast.style.borderColor = colors[type] || colors['info'];
    toast.innerHTML = `
        <i class="fas ${icons[type] || icons['info']}" style="color: ${colors[type]};"></i>
        ${message}
    `;
    
    document.body.appendChild(toast);
    
    // Auto-eliminar
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

function getCountryName(code) {
    const countries = {
        'US': 'Estados Unidos 🇺🇸',
        'UK': 'Reino Unido 🇬🇧',
        'ES': 'España 🇪🇸',
        'CA': 'Canadá 🇨🇦',
        'FR': 'Francia 🇫🇷',
        'DE': 'Alemania 🇩🇪'
    };
    return countries[code] || code;
}

function getProviderDisplayName(provider) {
    const names = {
        'receivesms': 'ReceiveSMS.co',
        'receivesmscc': 'ReceiveSMS.cc',
        'sms-activate': 'SMS-Activate',
        'backup': 'Respaldo',
        'desconocido': 'Otro proveedor'
    };
    return names[provider] || provider;
}

function formatTime(timestamp) {
    try {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        // Si es hoy, mostrar solo hora
        if (diff < 24 * 60 * 60 * 1000 && date.getDate() === now.getDate()) {
            return date.toLocaleTimeString('es-ES', { 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit'
            });
        }
        
        // Si es ayer
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.getDate() === yesterday.getDate()) {
            return `Ayer ${date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
        }
        
        // Fecha completa
        return date.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return timestamp;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function extractOTPFromText(text) {
    if (!text) return null;
    
    const patterns = [
        /(\d{5,6})/g,
        /code[:\s]*(\d{4,8})/i,
        /otp[:\s]*(\d{4,8})/i,
        /verification[:\s]*(\d{4,8})/i
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const cleaned = match[0].replace(/[^\d]/g, '');
            if (cleaned.length >= 4 && cleaned.length <= 8) {
                return cleaned;
            }
        }
    }
    
    return null;
}

function groupBy(array, key) {
    return array.reduce((result, item) => {
        const groupKey = item[key] || 'desconocido';
        if (!result[groupKey]) {
            result[groupKey] = [];
        }
        result[groupKey].push(item);
        return result;
    }, {});
}

// ==========================================
// LIMPIEZA AL CERRAR
// ==========================================
window.addEventListener('beforeunload', () => {
    stopMonitoring();
    socket.disconnect();
});

// Detectar cambios de conexión a internet
window.addEventListener('online', () => {
    console.log('🌐 Conexión restaurada');
    updateConnectionStatus('connected');
    showToast('Conexión restaurada', 'success');
    loadNumbers();
});

window.addEventListener('offline', () => {
    console.log('🔴 Sin conexión a internet');
    updateConnectionStatus('error');
    showToast('Sin conexión a internet', 'error');
});

// ==========================================
// EXPORTAR PARA USO GLOBAL
// ==========================================
window.loadNumbers = loadNumbers;
window.selectNumber = selectNumber;
window.copyOTP = copyOTP;
window.copyOTPFromBadge = copyOTPFromBadge;

console.log('✅ app.js cargado correctamente');
