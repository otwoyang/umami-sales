// Simple static file server for Umami Sales PWA
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 9999; // Use different port from NestJS server

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);

  // Default to split.html for root
  let filePath = req.url === '/' ? '/split.html' : req.url;

  // Remove query strings
  filePath = filePath.split('?')[0];

  const fullPath = path.join(__dirname, filePath);
  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // Not found - serve index.html
        fs.readFile(path.join(__dirname, 'split.html'), (err, content) => {
          if (err) {
            res.writeHead(500);
            res.end('Server Error');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
          }
        });
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║           Umami Sales PWA Server Started!                ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  📱 Local (this Mac):   http://localhost:${PORT}          ║
║  🌐 Network (mobile):   http://YOUR_IP:${PORT}            ║
║                                                          ║
║  Press Ctrl+C to stop                                    ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
});
