const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();

const port = process.env.PORT || 3000;

// Middleware - ORDER MATTERS!
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);

// In-memory storage
let visits = [];

// Utility function
function extractDomain(referrer) {
  if (!referrer || referrer === '') return 'direct';
  try {
    const url = new URL(referrer);
    return url.hostname;
  } catch (e) {
    return 'invalid-url';
  }
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Referrer tracking server is running!',
    status: 'active',
    endpoints: {
      'POST /log-visit': 'Log a new visit',
      'GET /api/dashboard': 'Get dashboard data (JSON)',
      'GET /dashboard': 'View dashboard (HTML)',
      'GET /health': 'Health check'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    uptime: process.uptime(),
    totalVisits: visits.length,
    timestamp: new Date().toISOString()
  });
});

// THIS IS THE IMPORTANT ENDPOINT - Make sure it exists!
app.post('/log-visit', (req, res) => {
  console.log('📥 Received POST request to /log-visit');
  console.log('📝 Request body:', req.body);
  
  try {
    const { referrer, userAgent, currentUrl, pageTitle } = req.body;
    const domain = extractDomain(referrer);
    
    const visit = {
      domain,
      referrer: referrer || 'Direct',
      userAgent: userAgent || req.get('User-Agent'),
      currentUrl: currentUrl || 'unknown',
      pageTitle: pageTitle || 'unknown',
      ip: req.ip || 'unknown',
      timestamp: new Date().toISOString()
    };
    
    visits.push(visit);
    console.log(`✅ Visit logged: ${domain} from ${referrer}`);
    
    res.status(200).json({ 
      success: true, 
      message: 'Visit logged successfully',
      visit: visit
    });
  } catch (error) {
    console.error('❌ Error logging visit:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to log visit',
      details: error.message
    });
  }
});

// Dashboard API
app.get('/api/dashboard', (req, res) => {
  try {
    const summary = {};
    visits.forEach(visit => {
      if (!summary[visit.domain]) {
        summary[visit.domain] = { 
          count: 0, 
          lastVisit: '',
          firstVisit: visit.timestamp
        };
      }
      summary[visit.domain].count++;
      summary[visit.domain].lastVisit = visit.timestamp;
    });

    const result = Object.entries(summary)
      .map(([domain, data]) => ({
        domain,
        visits: data.count,
        lastVisit: data.lastVisit,
        firstVisit: data.firstVisit
      }))
      .sort((a, b) => b.visits - a.visits);

    res.status(200).json({
      success: true,
      totalVisits: visits.length,
      uniqueDomains: result.length,
      domains: result,
      recentVisits: visits.slice(-10).reverse()
    });
  } catch (error) {
    console.error('❌ Error generating dashboard data:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to generate dashboard data',
      details: error.message
    });
  }
});

// Dashboard HTML
app.get('/dashboard', (req, res) => {
  const dashboardPath = path.join(__dirname, 'public', 'dashboard.html');
  
  if (fs.existsSync(dashboardPath)) {
    res.sendFile(dashboardPath);
  } else {
    res.send(`
<!DOCTYPE html>
<html>
<head><title>Dashboard</title></head>
<body>
<h1>📊 Dashboard</h1>
<p>Total visits: <span id="total">Loading...</span></p>
<div id="data"></div>
<script>
fetch('/api/dashboard')
.then(r => r.json())
.then(data => {
  document.getElementById('total').textContent = data.totalVisits;
  document.getElementById('data').innerHTML = 
    '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
});
</script>
</body>
</html>
    `);
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404 - Path not found: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.path,
    method: req.method,
    availableEndpoints: [
      'GET /',
      'GET /health',
      'POST /log-visit',
      'GET /api/dashboard',
      'GET /dashboard'
    ]
  });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📊 Dashboard: /dashboard`);
  console.log(`🔗 API: /api/dashboard`);
  console.log(`📝 Log visits: POST /log-visit`);
});
