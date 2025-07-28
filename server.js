const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();

const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
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

// Health check endpoint
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

// GET endpoint for dashboard data (this should work now)
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

// GET endpoint for dashboard HTML view - with fallback
app.get('/dashboard', (req, res) => {
  const dashboardPath = path.join(__dirname, 'public', 'dashboard.html');
  
  // Check if file exists
  if (fs.existsSync(dashboardPath)) {
    res.sendFile(dashboardPath);
  } else {
    // Send inline HTML if file doesn't exist
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Referrer Tracking Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
        .stat-number { font-size: 2.5em; font-weight: bold; color: #3b82f6; margin-bottom: 8px; }
        .stat-label { color: #64748b; font-weight: 500; }
        table { width: 100%; background: white; border-collapse: collapse; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 2rem; }
        th, td { padding: 16px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        th { background: #f8fafc; font-weight: 600; }
        .refresh-btn { background: #3b82f6; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; margin-bottom: 20px; }
        .refresh-btn:hover { background: #2563eb; }
        .status { padding: 8px 16px; border-radius: 6px; margin-bottom: 1rem; }
        .status.success { background: #dcfce7; color: #166534; }
        .status.error { background: #fef2f2; color: #dc2626; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Referrer Tracking Dashboard</h1>
        <button class="refresh-btn" onclick="loadDashboard()">🔄 Refresh Data</button>
        
        <div id="status"></div>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-number" id="totalVisits">-</div>
                <div class="stat-label">Total Visits</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="uniqueDomains">-</div>
                <div class="stat-label">Unique Domains</div>
            </div>
        </div>

        <h2>📈 Visits by Domain</h2>
        <table>
            <thead>
                <tr><th>Domain</th><th>Visits</th><th>Last Visit</th></tr>
            </thead>
            <tbody id="domainsTable">
                <tr><td colspan="3">Loading...</td></tr>
            </tbody>
        </table>

        <h2>🕒 Recent Visits</h2>
        <table>
            <thead>
                <tr><th>Domain</th><th>Referrer</th><th>Timestamp</th></tr>
            </thead>
            <tbody id="recentVisitsTable">
                <tr><td colspan="3">Loading...</td></tr>
            </tbody>
        </table>
    </div>

    <script>
        function showStatus(message, type = 'success') {
            const statusDiv = document.getElementById('status');
            statusDiv.innerHTML = \`<div class="status \${type}">\${message}</div>\`;
            setTimeout(() => statusDiv.innerHTML = '', 3000);
        }

        async function loadDashboard() {
            try {
                const response = await fetch('/api/dashboard');
                const data = await response.json();
                
                if (!data.success) throw new Error(data.error || 'Unknown error');
                
                document.getElementById('totalVisits').textContent = data.totalVisits || 0;
                document.getElementById('uniqueDomains').textContent = data.uniqueDomains || 0;
                
                const domainsTable = document.getElementById('domainsTable');
                if (data.domains && data.domains.length > 0) {
                    domainsTable.innerHTML = data.domains.map(domain => \`
                        <tr>
                            <td><strong>\${domain.domain}</strong></td>
                            <td>\${domain.visits}</td>
                            <td>\${new Date(domain.lastVisit).toLocaleString()}</td>
                        </tr>
                    \`).join('');
                } else {
                    domainsTable.innerHTML = '<tr><td colspan="3">No visits recorded yet</td></tr>';
                }
                
                const recentTable = document.getElementById('recentVisitsTable');
                if (data.recentVisits && data.recentVisits.length > 0) {
                    recentTable.innerHTML = data.recentVisits.map(visit => \`
                        <tr>
                            <td><strong>\${visit.domain}</strong></td>
                            <td>\${visit.referrer}</td>
                            <td>\${new Date(visit.timestamp).toLocaleString()}</td>
                        </tr>
                    \`).join('');
                } else {
                    recentTable.innerHTML = '<tr><td colspan="3">No recent visits</td></tr>';
                }
                
                showStatus(\`✅ Dashboard updated (\${data.totalVisits} total visits)\`);
                
            } catch (error) {
                console.error('Error loading dashboard:', error);
                showStatus(\`❌ Error: \${error.message}\`, 'error');
            }
        }
        
        document.addEventListener('DOMContentLoaded', loadDashboard);
        setInterval(loadDashboard, 60000);
    </script>
</body>
</html>
    `);
  }
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
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'deployment'}`);
  console.log(`📊 Dashboard: /dashboard`);
  console.log(`🔗 API: /api/dashboard`);
});

process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, shutting down gracefully');
  process.exit(0);
});
