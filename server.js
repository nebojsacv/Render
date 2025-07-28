const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Storage
let visits = [];

// Helper function
function extractDomain(referrer) {
  if (!referrer || referrer === '') return 'direct';
  try {
    const url = new URL(referrer);
    return url.hostname;
  } catch (e) {
    return 'invalid-url';
  }
}

// ROOT - Test this first
app.get('/', (req, res) => {
  res.json({
    message: 'Server is running!',
    status: 'OK',
    endpoints: [
      'GET /',
      'POST /log-visit', 
      'GET /api/dashboard',
      'GET /dashboard'
    ],
    totalVisits: visits.length
  });
});

// LOG VISIT - This is what's failing
app.post('/log-visit', (req, res) => {
  console.log('=== LOG VISIT REQUEST ===');
  console.log('Method:', req.method);
  console.log('Path:', req.path);
  console.log('Body:', req.body);
  
  try {
    const { referrer, userAgent } = req.body;
    const domain = extractDomain(referrer);
    
    const visit = {
      domain: domain,
      referrer: referrer || 'direct',
      userAgent: userAgent || 'unknown',
      timestamp: new Date().toISOString()
    };
    
    visits.push(visit);
    
    console.log('✅ Visit saved:', visit);
    
    res.json({
      success: true,
      message: 'Visit logged',
      visit: visit,
      totalVisits: visits.length
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// DASHBOARD API
app.get('/api/dashboard', (req, res) => {
  const summary = {};
  
  visits.forEach(visit => {
    if (!summary[visit.domain]) {
      summary[visit.domain] = { count: 0, lastVisit: '' };
    }
    summary[visit.domain].count++;
    summary[visit.domain].lastVisit = visit.timestamp;
  });

  const domains = Object.entries(summary).map(([domain, data]) => ({
    domain,
    visits: data.count,
    lastVisit: data.lastVisit
  }));

  res.json({
    success: true,
    totalVisits: visits.length,
    uniqueDomains: domains.length,
    domains: domains,
    recentVisits: visits.slice(-5)
  });
});

// DASHBOARD HTML
app.get('/dashboard', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Dashboard</title>
    <style>
        body { font-family: Arial; padding: 20px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
        .stat { background: #e3f2fd; padding: 15px; margin: 10px 0; border-radius: 4px; }
        button { background: #2196f3; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Visitor Dashboard</h1>
        <button onclick="refresh()">🔄 Refresh</button>
        <div id="stats">Loading...</div>
    </div>
    
    <script>
        function refresh() {
            fetch('/api/dashboard')
            .then(r => r.json())
            .then(data => {
                document.getElementById('stats').innerHTML = \`
                    <div class="stat"><strong>Total Visits:</strong> \${data.totalVisits}</div>
                    <div class="stat"><strong>Unique Domains:</strong> \${data.uniqueDomains}</div>
                    <div class="stat"><strong>Recent Visits:</strong><br>
                        \${data.recentVisits.map(v => \`\${v.domain} - \${v.timestamp}\`).join('<br>')}
                    </div>
                \`;
            });
        }
        refresh();
    </script>
</body>
</html>
  `);
});

// 404 Handler
app.use((req, res) => {
  console.log(`❌ 404: ${req.method} ${req.path}`);
  res.status(404).json({
    error: 'Endpoint not found',
    method: req.method,
    path: req.path,
    availableEndpoints: ['GET /', 'POST /log-visit', 'GET /api/dashboard', 'GET /dashboard']
  });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log('Available routes:');
  console.log('  GET  /');
  console.log('  POST /log-visit');
  console.log('  GET  /api/dashboard');
  console.log('  GET  /dashboard');
});
