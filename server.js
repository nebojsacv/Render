const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.set('trust proxy', true);

// Storage
let visits = [];

// Known B2B companies for lead scoring
const highValueCompanies = [
  'microsoft', 'google', 'amazon', 'apple', 'meta', 'facebook',
  'ibm', 'oracle', 'sap', 'salesforce', 'adobe', 'cisco',
  'bosch', 'siemens', 'ge', 'volkswagen', 'bmw', 'mercedes',
  'jpmorgan', 'goldman', 'morgan', 'citigroup', 'wells fargo',
  'coca cola', 'pepsi', 'unilever', 'procter', 'johnson',
  'pfizer', 'novartis', 'roche', 'merck', 'abbott',
  'walmart', 'target', 'home depot', 'lowes', 'best buy'
];

// Get comprehensive IP information
async function getCompanyInfo(ip) {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return {
      ip: ip,
      company: 'Local Network',
      domain: 'local',
      country: 'Local',
      city: 'Local',
      organization: 'Local Network',
      isHighValue: false,
      leadScore: 0
    };
  }

  return new Promise((resolve) => {
    // Using multiple data points for better company identification
    const url = `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,isp,org,as,query,reverse`;
    
    http.get(url, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.status === 'success') {
            const companyInfo = extractCompanyInfo(parsed);
            resolve(companyInfo);
          } else {
            resolve(getDefaultCompanyInfo(ip));
          }
        } catch (error) {
          console.error('Error parsing IP data:', error);
          resolve(getDefaultCompanyInfo(ip));
        }
      });
    }).on('error', (error) => {
      console.error('Error fetching IP data:', error);
      resolve(getDefaultCompanyInfo(ip));
    }).setTimeout(5000, function() {
      this.destroy();
      resolve(getDefaultCompanyInfo(ip));
    });
  });
}

function extractCompanyInfo(data) {
  const org = data.org || data.isp || '';
  const reverse = data.reverse || '';
  
  // Extract company name and potential domain
  let company = cleanCompanyName(org);
  let domain = extractDomainFromReverse(reverse) || extractDomainFromOrg(org);
  
  // Calculate lead score
  const leadScore = calculateLeadScore(company, org, domain);
  const isHighValue = leadScore >= 70;
  
  return {
    ip: data.query,
    company: company,
    domain: domain,
    country: data.country,
    region: data.regionName,
    city: data.city,
    organization: org,
    isp: data.isp,
    as: data.as,
    reverse: reverse,
    isHighValue: isHighValue,
    leadScore: leadScore
  };
}

function cleanCompanyName(org) {
  if (!org) return 'Unknown';
  
  return org
    .replace(/\bAS\d+\s*/gi, '')
    .replace(/\b(LLC|Inc|Corp|Ltd|Limited|GmbH|AG|SA|SPA|BV|Pty|Co\.|Company)\b/gi, '')
    .replace(/\b(Internet|Broadband|Telecommunications|Telecom|Networks?|Services?|Solutions?|Technologies?|Tech|Systems?|Communications?|Comm|ISP)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || org;
}

function extractDomainFromReverse(reverse) {
  if (!reverse) return null;
  
  // Extract domain from reverse DNS
  const parts = reverse.split('.');
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }
  return null;
}

function extractDomainFromOrg(org) {
  if (!org) return null;
  
  // Try to guess domain from organization name
  const cleaned = org.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(' ')[0];
  
  if (cleaned.length > 2) {
    return cleaned + '.com'; // Best guess
  }
  return null;
}

function calculateLeadScore(company, org, domain) {
  let score = 0;
  
  // Check if it's a high-value company
  const companyLower = company.toLowerCase();
  const orgLower = org.toLowerCase();
  
  for (const hvCompany of highValueCompanies) {
    if (companyLower.includes(hvCompany) || orgLower.includes(hvCompany)) {
      score += 90;
      break;
    }
  }
  
  // Additional scoring factors
  if (domain && !domain.includes('isp') && !domain.includes('telecom')) {
    score += 20;
  }
  
  if (org && !org.toLowerCase().includes('residential') && !org.toLowerCase().includes('mobile')) {
    score += 10;
  }
  
  // Penalize consumer ISPs
  const consumerISPs = ['comcast', 'verizon', 'at&t', 'spectrum', 'cox', 'optimum', 'xfinity'];
  for (const isp of consumerISPs) {
    if (orgLower.includes(isp)) {
      score = Math.max(0, score - 30);
      break;
    }
  }
  
  return Math.min(100, score);
}

function getDefaultCompanyInfo(ip) {
  return {
    ip: ip,
    company: 'Unknown',
    domain: 'unknown',
    country: 'Unknown',
    city: 'Unknown',
    organization: 'Unknown',
    isHighValue: false,
    leadScore: 0
  };
}

// ROOT
app.get('/', (req, res) => {
  res.json({
    message: 'B2B SaaS Visitor Tracking & Lead Generation',
    status: 'OK',
    purpose: 'Identify potential business customers visiting your website',
    endpoints: [
      'GET /',
      'POST /log-visit', 
      'GET /api/dashboard',
      'GET /dashboard',
      'GET /leads'
    ],
    totalVisits: visits.length,
    highValueVisits: visits.filter(v => v.isHighValue).length
  });
});

// LOG VISIT
app.post('/log-visit', async (req, res) => {
  console.log('=== NEW BUSINESS VISITOR ===');
  
  try {
    const { referrer, userAgent, currentUrl, pageTitle } = req.body;
    
    const visitorIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress ||
                     req.ip || 
                     'unknown';

    console.log('🌍 Visitor IP:', visitorIP);
    
    const companyInfo = await getCompanyInfo(visitorIP);
    console.log('🏢 Company Info:', companyInfo);
    
    if (companyInfo.isHighValue) {
      console.log('🎯 HIGH VALUE LEAD DETECTED:', companyInfo.company);
    }
    
    const visit = {
      // Visitor data
      ip: companyInfo.ip,
      company: companyInfo.company,
      domain: companyInfo.domain,
      country: companyInfo.country,
      region: companyInfo.region,
      city: companyInfo.city,
      organization: companyInfo.organization,
      isp: companyInfo.isp,
      
      // Lead scoring
      isHighValue: companyInfo.isHighValue,
      leadScore: companyInfo.leadScore,
      
      // Web tracking
      referrer: referrer || 'direct',
      userAgent: userAgent || req.get('User-Agent') || 'unknown',
      currentUrl: currentUrl || 'unknown',
      pageTitle: pageTitle || 'unknown',
      
      timestamp: new Date().toISOString()
    };
    
    visits.push(visit);
    
    res.json({
      success: true,
      message: 'Business visitor tracked',
      visit: {
        company: visit.company,
        domain: visit.domain,
        location: `${visit.city}, ${visit.country}`,
        isHighValue: visit.isHighValue,
        leadScore: visit.leadScore
      },
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

// LEADS ENDPOINT - High value visitors only
app.get('/leads', (req, res) => {
  const leads = visits
    .filter(v => v.isHighValue || v.leadScore >= 50)
    .map(v => ({
      company: v.company,
      domain: v.domain,
      location: `${v.city}, ${v.country}`,
      organization: v.organization,
      leadScore: v.leadScore,
      visits: visits.filter(visit => visit.company === v.company).length,
      lastVisit: v.timestamp,
      pagesVisited: visits.filter(visit => visit.company === v.company).map(visit => visit.pageTitle),
      ip: v.ip
    }))
    .reduce((unique, lead) => {
      if (!unique.find(u => u.company === lead.company)) {
        unique.push(lead);
      }
      return unique;
    }, [])
    .sort((a, b) => b.leadScore - a.leadScore);

  res.json({
    totalLeads: leads.length,
    leads: leads
  });
});

// DASHBOARD API
app.get('/api/dashboard', (req, res) => {
  try {
    const companySummary = {};
    
    visits.forEach(visit => {
      const company = visit.company || 'Unknown';
      if (!companySummary[company]) {
        companySummary[company] = { 
          count: 0, 
          lastVisit: '',
          leadScore: visit.leadScore || 0,
          isHighValue: visit.isHighValue || false,
          domain: visit.domain,
          location: `${visit.city}, ${visit.country}`,
          ips: new Set()
        };
      }
      companySummary[company].count++;
      companySummary[company].lastVisit = visit.timestamp;
      companySummary[company].ips.add(visit.ip);
    });

    const companies = Object.entries(companySummary).map(([company, data]) => ({
      company,
      domain: data.domain,
      visits: data.count,
      lastVisit: data.lastVisit,
      leadScore: data.leadScore,
      isHighValue: data.isHighValue,
      location: data.location,
      uniqueIPs: data.ips.size
    })).sort((a, b) => b.leadScore - a.leadScore);

    const highValueVisitors = companies.filter(c => c.isHighValue);
    const potentialLeads = companies.filter(c => c.leadScore >= 50);

    res.json({
      success: true,
      totalVisits: visits.length,
      uniqueCompanies: companies.length,
      highValueVisitors: highValueVisitors.length,
      potentialLeads: potentialLeads.length,
      companies: companies,
      leads: potentialLeads,
      recentVisits: visits.slice(-10).reverse().map(v => ({
        company: v.company,
        domain: v.domain,
        ip: v.ip,
        location: `${v.city}, ${v.country}`,
        leadScore: v.leadScore,
        isHighValue: v.isHighValue,
        pageTitle: v.pageTitle,
        timestamp: v.timestamp
      }))
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

// B2B DASHBOARD HTML
app.get('/dashboard', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>B2B SaaS Lead Dashboard</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f8fafc; }
        .container { max-width: 1400px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 2rem; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .stat { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
        .stat-number { font-size: 2.5em; font-weight: bold; margin-bottom: 5px; }
        .high-value { color: #10b981; }
        .medium-value { color: #f59e0b; }
        .low-value { color: #6b7280; }
        button { background: #3b82f6; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; margin: 5px; }
        table { width: 100%; background: white; border-collapse: collapse; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        th { background: #f9fafb; font-weight: 600; }
        .company-name { font-weight: bold; }
        .high-value-row { background: #ecfdf5; }
        .lead-score { padding: 4px 8px; border-radius: 4px; font-weight: bold; color: white; }
        .score-high { background: #10b981; }
        .score-medium { background: #f59e0b; }
        .score-low { background: #6b7280; }
        .domain { font-family: monospace; color: #6366f1; }
        .ip { font-family: monospace; color: #64748b; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 B2B SaaS Lead Dashboard</h1>
            <p>Track potential business customers visiting your website</p>
            <button onclick="refresh()">🔄 Refresh Data</button>
            <button onclick="exportLeads()">📊 Export Leads</button>
        </div>
        
        <div class="stats">
            <div class="stat">
                <div class="stat-number" id="totalVisits">-</div>
                <div>Total Visits</div>
            </div>
            <div class="stat">
                <div class="stat-number high-value" id="highValueVisitors">-</div>
                <div>High-Value Companies</div>
            </div>
            <div class="stat">
                <div class="stat-number medium-value" id="potentialLeads">-</div>
                <div>Potential Leads</div>
            </div>
            <div class="stat">
                <div class="stat-number" id="uniqueCompanies">-</div>
                <div>Unique Companies</div>
            </div>
        </div>
        
        <div id="data">Loading...</div>
    </div>
    
    <script>
        function refresh() {
            fetch('/api/dashboard')
            .then(r => r.json())
            .then(data => {
                document.getElementById('totalVisits').textContent = data.totalVisits;
                document.getElementById('highValueVisitors').textContent = data.highValueVisitors;
                document.getElementById('potentialLeads').textContent = data.potentialLeads;
                document.getElementById('uniqueCompanies').textContent = data.uniqueCompanies;
                
                const companiesTable = data.companies.map(c => {
                    const scoreClass = c.leadScore >= 70 ? 'score-high' : c.leadScore >= 50 ? 'score-medium' : 'score-low';
                    const rowClass = c.isHighValue ? 'high-value-row' : '';
                    
                    return \`<tr class="\${rowClass}">
                        <td class="company-name">\${c.company}</td>
                        <td class="domain">\${c.domain || 'Unknown'}</td>
                        <td>\${c.visits}</td>
                        <td><span class="lead-score \${scoreClass}">\${c.leadScore}</span></td>
                        <td>\${c.location}</td>
                        <td>\${new Date(c.lastVisit).toLocaleString()}</td>
                    </tr>\`;
                }).join('');
                
                const recentTable = data.recentVisits.map(v => {
                    const scoreClass = v.leadScore >= 70 ? 'score-high' : v.leadScore >= 50 ? 'score-medium' : 'score-low';
                    
                    return \`<tr>
                        <td class="company-name">\${v.company}</td>
                        <td class="domain">\${v.domain || 'Unknown'}</td>
                        <td class="ip">\${v.ip}</td>
                        <td><span class="lead-score \${scoreClass}">\${v.leadScore}</span></td>
                        <td>\${v.pageTitle}</td>
                        <td>\${new Date(v.timestamp).toLocaleString()}</td>
                    </tr>\`;
                }).join('');
                
                document.getElementById('data').innerHTML = \`
                    <h2>🏢 Company Visitors</h2>
                    <table>
                        <tr>
                            <th>Company</th>
                            <th>Domain</th>
                            <th>Visits</th>
                            <th>Lead Score</th>
                            <th>Location</th>
                            <th>Last Visit</th>
                        </tr>
                        \${companiesTable || '<tr><td colspan="6">No visitors yet</td></tr>'}
                    </table>
                    
                    <h2>🕒 Recent Activity</h2>
                    <table>
                        <tr>
                            <th>Company</th>
                            <th>Domain</th>
                            <th>IP</th>
                            <th>Score</th>
                            <th>Page Visited</th>
                            <th>Time</th>
                        </tr>
                        \${recentTable || '<tr><td colspan="6">No recent activity</td></tr>'}
                    </table>
                \`;
            });
        }
        
        function exportLeads() {
            fetch('/leads')
            .then(r => r.json())
            .then(data => {
                const csv = 'Company,Domain,Lead Score,Location,Visits,Last Visit\\n' +
                    data.leads.map(l => \`"\${l.company}","\${l.domain}",\${l.leadScore},"\${l.location}",\${l.visits},"\${l.lastVisit}"\`).join('\\n');
                
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'leads.csv';
                a.click();
            });
        }
        
        refresh();
        setInterval(refresh, 60000);
    </script>
</body>
</html>
  `);
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(port, () => {
  console.log(`🎯 B2B Lead Tracking Server running on port ${port}`);
  console.log('🏢 Tracking potential business customers for SaaS product');
});
