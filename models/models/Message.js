const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  number: {
    type: String,
    required: true,
    index: true
  },
  provider: {
    type: String,
    required: true
  },
  from: {
    type: String,
    default: 'Unknown'
  },
  text: {
    type: String,
    required: true
  },
  otp: {
    type: String,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

messageSchema.index({ number: 1, timestamp: -1 });

module.exports = mongoose.model('Message', messageSchema);
