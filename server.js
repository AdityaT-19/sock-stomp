// Node.js STOMP server with SockJS implementation
const express = require('express');
const http = require('http');
const sockjs = require('sockjs');
const cors = require('cors');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Enable CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  credentials: true
}));

// Serve static files
app.use(express.static('public'));

// Add test endpoint
app.get('/api/test', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

// Create SockJS server
const sockjsServer = sockjs.createServer({
  prefix: '/ws-endpoint',
  log: function(severity, message) {
    console.log(`[${severity}] ${message}`);
  }
});

// Install handlers on the HTTP server
sockjsServer.installHandlers(server);

// Track connected clients
const connections = new Map();
const subscriptions = new Map();

// Handle SockJS connections
sockjsServer.on('connection', function(conn) {
  console.log(`Client connected: ${conn.id}`);
  connections.set(conn.id, conn);
  
  // Handle client messages - we'll implement STOMP protocol manually
  conn.on('data', function(message) {
    console.log(`Received data: ${message}`);
    
    // Parse message to determine STOMP frame
    if (message.startsWith('CONNECT')) {
      handleConnect(conn, message);
    } else if (message.startsWith('SUBSCRIBE')) {
      handleSubscribe(conn, message);
    } else if (message.startsWith('SEND')) {
      handleSend(conn, message);
    } else if (message.startsWith('DISCONNECT')) {
      handleDisconnect(conn, message);
    } else {
      console.log(`Unknown command: ${message}`);
    }
  });
  
  // Handle client disconnection
  conn.on('close', function() {
    console.log(`Client disconnected: ${conn.id}`);
    
    // Clean up client subscriptions
    if (subscriptions.has(conn.id)) {
      subscriptions.delete(conn.id);
    }
    
    connections.delete(conn.id);
  });
});

// STOMP Frame Handlers

// Handle CONNECT frame
function handleConnect(conn, message) {
  console.log(`Processing CONNECT from ${conn.id}`);
  
  // Send CONNECTED frame
  const connectedFrame = 'CONNECTED\nversion:1.2\nheart-beat:10000,10000\n\n\0';
  conn.write(connectedFrame);
  
  console.log(`Sent CONNECTED to ${conn.id}`);
}

// Handle SUBSCRIBE frame
function handleSubscribe(conn, message) {
  // Parse headers
  const headers = parseHeaders(message);
  const destination = headers['destination'];
  const id = headers['id'];
  
  console.log(`Client ${conn.id} subscribed to ${destination} with id ${id}`);
  
  // Store subscription
  if (!subscriptions.has(conn.id)) {
    subscriptions.set(conn.id, new Map());
  }
  
  const clientSubs = subscriptions.get(conn.id);
  clientSubs.set(id, { destination });
  
  // Send a receipt if requested
  if (headers['receipt']) {
    const receiptFrame = `RECEIPT\nreceipt-id:${headers['receipt']}\n\n\0`;
    conn.write(receiptFrame);
  }
  
  // Send a welcome message to subscriber
  const welcomeMessage = {
    content: `Welcome to ${destination}!`,
    timestamp: new Date().toISOString()
  };
  
  const messageFrame = `MESSAGE\nsubscription:${id}\ndestination:${destination}\nmessage-id:${Date.now()}\ncontent-type:application/json\n\n${JSON.stringify(welcomeMessage)}\0`;
  conn.write(messageFrame);
}

// Handle SEND frame
function handleSend(conn, message) {
  // Parse headers and body
  const headers = parseHeaders(message);
  const destination = headers['destination'];
  const bodyStartIndex = message.indexOf('\n\n');
  const body = message.substring(bodyStartIndex + 2, message.length - 1); // Remove \0
  
  console.log(`Received message for ${destination}: ${body}`);
  
  // Broadcast to all subscribers
  connections.forEach((connection, connId) => {
    if (subscriptions.has(connId)) {
      const clientSubs = subscriptions.get(connId);
      
      clientSubs.forEach((sub, subId) => {
        if (sub.destination === destination) {
          const messageFrame = `MESSAGE\nsubscription:${subId}\ndestination:${destination}\nmessage-id:${Date.now()}\ncontent-type:application/json\n\n${body}\0`;
          connection.write(messageFrame);
          console.log(`Sent message to client ${connId} subscription ${subId}`);
        }
      });
    }
  });
}

// Handle DISCONNECT frame
function handleDisconnect(conn, message) {
  // Parse headers
  const headers = parseHeaders(message);
  
  // Send a receipt if requested
  if (headers['receipt']) {
    const receiptFrame = `RECEIPT\nreceipt-id:${headers['receipt']}\n\n\0`;
    conn.write(receiptFrame);
  }
  
  // Clean up subscriptions
  if (subscriptions.has(conn.id)) {
    subscriptions.delete(conn.id);
  }
}

// Helper function to parse STOMP headers
function parseHeaders(frame) {
  const headers = {};
  const lines = frame.split('\n');
  
  // Start from line 1 (skip command line)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    
    // Empty line indicates end of headers
    if (line === '') {
      break;
    }
    
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex);
      const value = line.substring(colonIndex + 1);
      headers[key] = value;
    }
  }
  
  return headers;
}

// Start the server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`SockJS endpoint: http://localhost:${PORT}/ws-endpoint`);
  console.log(`Ready for connections`);
});