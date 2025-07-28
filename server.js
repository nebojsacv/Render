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

// IMPROVED Helper function
function extractDomain(referrer) {
  console.log('🔍 Processing referrer:', referrer);
  
  // Handle empty or direct visits
  if (!referrer || referrer === '' || referrer === 'direct') {
    return 'direct';
  }
  
  // Handle local file URLs
  if (referrer.startsWith('file://')) {
    return 'local-file';
  }
  
  // Handle test cases
  if (referrer.includes('test') || referrer === 'console-test' || referrer === 'test-page') {
    return 'test-page';
  }
  
  // Try to parse as URL
  try {
    const url = new URL(referrer);
    return url.hostname || 'unknown-host';
  } catch (e) {
    console.log('❌ URL parsing failed for:', referrer, 'Error:', e.message);
    
    // Try to extract domain manually for common cases
    if (referrer.includes('://')) {
      const parts = referrer.split('://')[1];
      if (parts) {
        const domain = parts.split('/')[0].split('?')[0];
        return domain || 'manual-extracted';
      }
    }
    
    // If all else fails, return the referrer itself (truncated)
    return referrer.substring(0, 50) + (referrer.length > 50 ? '...' : '');
  }
}

// ROOT
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

// LOG VISIT - Enhanced logging
app.post('/log-visit', (req, res) => {
  console.log('=== LOG VISIT REQUEST ===');
  console.log('Body:', req.body);
  
  try {
    const { referrer, userAgent, currentUrl, pageTitle } = req.body;
    const domain = extractDomain(referrer);
    
    const visit = {
      domain: domain,
      referrer: referrer || 'direct',
      userAgent: userAgent || req.get('User-Agent') || 'unknown',
      currentUrl: currentUrl || 'unknown',
      pageTitle: pageTitle || 'unknown',
      timestamp: new Date().toISOString()
    };
    
    visits.push(visit);
    
    console.log('✅ Visit saved:', {
      domain: visit.domain,
      referrer: visit.referrer,
      timestamp: visit.timestamp
    });
    
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
  })).sort((a, b) => b.visits - a.visits);

  res.json({
    success: true,
    totalVisits: visits.length,
    uniqueDomains: domains.length,
    domains: domains,
    recentVisits: visits.slice(-10).reverse()
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
        .container { max-width: 1000px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
        .stat { background: #e3f2fd; padding: 15px; margin: 10px 0; border-radius: 4px; }
        button { background: #2196f3; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin: 5px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #f2f2f2; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Visitor Dashboard</h1>
        <button onclick="refresh()">🔄 Refresh</button>
        <button onclick="testVisit()">🧪 Send Test Visit</button>
        <div id="stats">Loading...</div>
    </div>
    
    <script>
        function refresh() {
            fetch('/api/dashboard')
            .then(r => r.json())
            .then(data => {
                const domainsTable = data.domains.map(d => 
                    \`<tr><td>\${d.domain}</td><td>\${d.visits}</td><td>\${new Date(d.lastVisit).toLocaleString()}</td></tr>\`
                ).join('');
                
                const recentTable = data.recentVisits.map(v => 
                    \`<tr><td>\${v.domain}</td><td>\${v.referrer}</td><td>\${new Date(v.timestamp).toLocaleString()}</td></tr>\`
                ).join('');
                
                document.getElementById('stats').innerHTML = \`
                    <div class="stat"><strong>Total Visits:</strong> \${data.totalVisits}</div>
                    <div class="stat"><strong>Unique Domains:</strong> \${data.uniqueDomains}</div>
                    
                    <h3>📈 Domains</h3>
                    <table>
                        <tr><th>Domain</th><th>Visits</th><th>Last Visit</th></tr>
                        \${domainsTable || '<tr><td colspan="3">No data</td></tr>'}
                    </table>
                    
                    <h3>🕒 Recent Visits</h3>
                    <table>
                        <tr><th>Domain</th><th>Referrer</th><th>Time</th></tr>
                        \${recentTable || '<tr><td colspan="3">No data</td></tr>'}
                    </table>
                \`;
            });
        }
        
        function testVisit() {
            const testReferrers = [
                'https://google.com',
                'https://facebook.com', 
                'https://twitter.com',
                'direct'
            ];
            const randomReferrer = testReferrers[Math.floor(Math.random() * testReferrers.length)];
            
            fetch('/log-visit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    referrer: randomReferrer,
                    userAgent: navigator.userAgent,
                    currentUrl: window.location.href,
                    pageTitle: 'Dashboard Test'
                })
            }).then(() => {
                setTimeout(refresh, 500); // Refresh after half second
            });
        }
        
        refresh();
        setInterval(refresh, 30000); // Auto-refresh every 30 seconds
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
    path: req.path
  });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
