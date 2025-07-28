const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const app = express();

// Render provides PORT via environment variable
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Trust proxy for Render
app.set('trust proxy', 1);

// In-memory storage
let visits = [];

// Utility function to extract domain
function extractDomain(referrer) {
  if (!referrer || referrer === '') return 'direct';
  try {
    const url = new URL(referrer);
    return url.hostname;
  } catch (e) {
    return 'invalid-url';
  }
}

// Health check endpoint (important for Render)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    uptime: process.uptime(),
    totalVisits: visits.length,
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Referrer tracking server is running on Render!',
    status: 'active',
    endpoints: {
      'POST /log-visit': 'Log a new visit',
      'GET /api/dashboard': 'Get dashboard data (JSON)',
      'GET /dashboard': 'View dashboard (HTML)',
      'GET /health': 'Health check'
    }
  });
});

// POST endpoint to receive referrer logs
app.post('/log-visit', (req, res) => {
  try {
    const { referrer, userAgent, ip } = req.body;
    const domain = extractDomain(referrer);
    
    const visit = {
      domain,
      referrer: referrer || 'Direct',
      userAgent: userAgent || req.get('User-Agent'),
      ip: ip || req.ip || 'unknown',
      timestamp: new Date().toISOString()
    };
    
    visits.push(visit);
    console.log(`✅ New visit logged: ${domain} at ${visit.timestamp}`);
    
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

// GET endpoint for dashboard data
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

// GET endpoint for dashboard HTML view
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.path
  });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Referrer tracking server running on port ${port}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Dashboard: /dashboard`);
  console.log(`🔗 API: /api/dashboard`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, shutting down gracefully');
  process.exit(0);
});
