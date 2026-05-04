// Dentro de la clase TempSmsService, añade este método:

async getSmsActivateNumbers(country = 'US') {
  const countryMap = {
    'US': 'us', 'UK': 'gb', 'ES': 'es', 'CA': 'ca', 'FR': 'fr'
  };
  
  try {
    // API gratuita de consulta de disponibilidad
    const response = await axios.get(
      `https://api.sms-activate.org/stubs/handler_api.php?api_key=&action=getNumbersStatus&country=${countryMap[country] || 'us'}`,
      { timeout: 8000 }
    );
    
    const numbers = [];
    if (response.data && typeof response.data === 'object') {
      // Buscar disponibilidad para Telegram (tg)
      for (const [service, count] of Object.entries(response.data)) {
        if (count > 0 && service.startsWith('tg')) {
          numbers.push({
            service: 'Telegram',
            available: count,
            provider: 'sms-activate',
            country: country,
            note: 'Requiere compra ($0.30-$0.50)'
          });
        }
      }
    }
    return numbers;
  } catch (error) {
    console.log('SMS-Activate consulta gratuita:', error.message);
    return [];
  }
}
