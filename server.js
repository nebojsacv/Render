const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const https = require('https');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.set('trust proxy', true);

let visits = [];

// Kombinacija više servisa za bolju identifikaciju
async function getEnhancedCompanyInfo(ip) {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return getDefaultCompanyInfo(ip);
  }

  try {
    // Koristimo više servisa paralelno
    const [ipApiResult, whoisResult, reverseDnsResult] = await Promise.allSettled([
      getIPApiInfo(ip),
      getWhoisInfo(ip),
      getReverseDNSInfo(ip)
    ]);

    // Kombinujemo rezultate za najbolju identifikaciju
    const combined = combineResults(
      ipApiResult.status === 'fulfilled' ? ipApiResult.value : null,
      whoisResult.status === 'fulfilled' ? whoisResult.value : null,
      reverseDnsResult.status === 'fulfilled' ? reverseDnsResult.value : null,
      ip
    );

    console.log('🔍 Enhanced company detection for IP:', ip);
    console.log('📊 Combined result:', combined);

    return combined;
  } catch (error) {
    console.error('Error in enhanced company detection:', error);
    return getDefaultCompanyInfo(ip);
  }
}

// IP-API servis
function getIPApiInfo(ip) {
  return new Promise((resolve, reject) => {
    const url = `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,isp,org,as,query,reverse`;
    
    http.get(url, (response) => {
      let data = '';
      response.on('data', (chunk) => data += chunk);
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.status === 'success' ? parsed : null);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject).setTimeout(3000, function() {
      this.destroy();
      reject(new Error('Timeout'));
    });
  });
}

// WHOIS-style informacije
function getWhoisInfo(ip) {
  return new Promise((resolve, reject) => {
    // Koristi ipinfo.io kao alternativni servis
    const url = `http://ipinfo.io/${ip}/json`;
    
    http.get(url, (response) => {
      let data = '';
      response.on('data', (chunk) => data += chunk);
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject).setTimeout(3000, function() {
      this.destroy();
      reject(new Error('Timeout'));
    });
  });
}

// Reverse DNS lookup
function getReverseDNSInfo(ip) {
  return new Promise((resolve) => {
    const dns = require('dns');
    dns.reverse(ip, (err, hostnames) => {
      if (err || !hostnames || hostnames.length === 0) {
        resolve(null);
      } else {
        resolve({ hostname: hostnames[0], allHostnames: hostnames });
      }
    });
  });
}

// Kombinuje rezultate iz više izvora
function combineResults(ipApiData, whoisData, dnsData, ip) {
  const result = {
    ip: ip,
    company: 'Unknown',
    domain: null,
    country: 'Unknown',
    city: 'Unknown',
    organization: 'Unknown',
    isp: 'Unknown',
    isHighValue: false,
    leadScore: 0,
    detectionMethod: 'none',
    allSources: {
      ipApi: ipApiData,
      whois: whoisData,
      dns: dnsData
    }
  };

  let bestCompanyName = 'Unknown';
  let bestDomain = null;
  let detectionMethod = 'none';

  // 1. Pokušaj iz Reverse DNS (najčešće najbolji za firme)
  if (dnsData && dnsData.hostname) {
    const companyFromDNS = extractCompanyFromHostname(dnsData.hostname);
    if (companyFromDNS.isCompany) {
      bestCompanyName = companyFromDNS.company;
      bestDomain = companyFromDNS.domain;
      detectionMethod = 'reverse-dns';
      console.log('✅ Company detected via DNS:', bestCompanyName);
    }
  }

  // 2. Pokušaj iz WHOIS podataka
  if (whoisData && detectionMethod === 'none') {
    const companyFromWhois = extractCompanyFromWhois(whoisData);
    if (companyFromWhois.isCompany) {
      bestCompanyName = companyFromWhois.company;
      bestDomain = companyFromWhois.domain;
      detectionMethod = 'whois';
      console.log('✅ Company detected via WHOIS:', bestCompanyName);
    }
  }

  // 3. Pokušaj iz IP-API podataka
  if (ipApiData && detectionMethod === 'none') {
    const companyFromIPApi = extractCompanyFromIPApi(ipApiData);
    if (companyFromIPApi.isCompany) {
      bestCompanyName = companyFromIPApi.company;
      bestDomain = companyFromIPApi.domain;
      detectionMethod = 'ip-api';
      console.log('✅ Company detected via IP-API:', bestCompanyName);
    }
  }

  // Postavi osnovne informacije
  result.company = bestCompanyName;
  result.domain = bestDomain;
  result.detectionMethod = detectionMethod;

  if (ipApiData) {
    result.country = ipApiData.country || 'Unknown';
    result.city = ipApiData.city || 'Unknown';
    result.organization = ipApiData.org || ipApiData.isp || 'Unknown';
    result.isp = ipApiData.isp || 'Unknown';
  } else if (whoisData) {
    result.country = whoisData.country || 'Unknown';
    result.city = whoisData.city || 'Unknown';
    result.organization = whoisData.org || 'Unknown';
  }

  // Izračunaj lead score
  result.leadScore = calculateEnhancedLeadScore(result);
  result.isHighValue = result.leadScore >= 70;

  return result;
}

// Izvlači ime firme iz hostname-a (npr. mail.bosch.com -> Bosch)
function extractCompanyFromHostname(hostname) {
  if (!hostname) return { isCompany: false };

  // Ukloni subdomenove i uzmi glavni domen
  const parts = hostname.split('.');
  if (parts.length < 2) return { isCompany: false };

  const domain = parts.slice(-2).join('.');
  const mainDomain = parts[parts.length - 2];

  // Proveri da li je biznis domen (ne ISP)
  const businessIndicators = [
    'corp', 'company', 'inc', 'ltd', 'gmbh', 'ag', 'sa', 'group',
    'mail', 'www', 'web', 'intranet', 'vpn', 'gateway'
  ];

  const ispIndicators = [
    'comcast', 'verizon', 'att', 'spectrum', 'cox', 'charter',
    'telecom', 'isp', 'broadband', 'cable', 'fiber'
  ];

  const domainLower = domain.toLowerCase();
  const mainDomainLower = mainDomain.toLowerCase();

  // Ako je ISP, vrati kao ISP
  for (const isp of ispIndicators) {
    if (domainLower.includes(isp)) {
      return { isCompany: false };
    }
  }

  // Ako ima biznis indikatore ili izgleda kao kompanijski domen
  const looksLikeBusiness = 
    businessIndicators.some(indicator => domainLower.includes(indicator)) ||
    (mainDomain.length > 2 && !mainDomainLower.includes('net') && !mainDomainLower.includes('com'));

  if (looksLikeBusiness || domain.length < 15) {
    return {
      isCompany: true,
      company: capitalizeCompanyName(mainDomain),
      domain: domain
    };
  }

  return { isCompany: false };
}

// Izvlači ime firme iz WHOIS podataka
function extractCompanyFromWhois(whoisData) {
  if (!whoisData || !whoisData.org) return { isCompany: false };

  const org = whoisData.org;
  const cleaned = cleanCompanyName(org);

  // Proveri da li je prava firma
  const isRealCompany = !org.toLowerCase().includes('internet') &&
                       !org.toLowerCase().includes('broadband') &&
                       !org.toLowerCase().includes('telecom') &&
                       !org.toLowerCase().includes('isp') &&
                       org.length < 50;

  if (isRealCompany && cleaned !== org) {
    return {
      isCompany: true,
      company: cleaned,
      domain: guessDomainFromCompany(cleaned)
    };
  }

  return { isCompany: false };
}

// Izvlači ime firme iz IP-API podataka
function extractCompanyFromIPApi(ipApiData) {
  if (!ipApiData || !ipApiData.org) return { isCompany: false };

  const org = ipApiData.org;
  const cleaned = cleanCompanyName(org);

  // Slične provere kao za WHOIS
  const isRealCompany = !org.toLowerCase().includes('internet') &&
                       !org.toLowerCase().includes('broadband') &&
                       !org.toLowerCase().includes('telecom') &&
                       cleaned.length > 2;

  if (isRealCompany) {
    return {
      isCompany: true,
      company: cleaned,
      domain: guessDomainFromCompany(cleaned)
    };
  }

  return { isCompany: false };
}

// Poboljšana funkcija za čišćenje imena firme
function cleanCompanyName(org) {
  if (!org) return 'Unknown';
  
  return org
    .replace(/\bAS\d+\s*/gi, '') // Ukloni AS brojeve
    .replace(/\b(LLC|Inc|Corp|Ltd|Limited|GmbH|AG|SA|SPA|BV|Pty|Co\.|Company|Corporation)\b/gi, '') // Pravni sufiksi
    .replace(/\b(Internet|Broadband|Telecommunications|Telecom|Networks?|Services?|Solutions?|Technologies?|Tech|Systems?|Communications?|Comm|ISP|Hosting|Cloud)\b/gi, '') // Tech reči
    .replace(/\s+/g, ' ') // Normalizuj razmake
    .trim() || org;
}

function capitalizeCompanyName(name) {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function guessDomainFromCompany(companyName) {
  if (!companyName || companyName === 'Unknown') return null;
  
  const cleaned = companyName.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 10);
  
  return cleaned.length > 2 ? cleaned + '.com' : null;
}

// Poboljšano ocenjivanje leadova
function calculateEnhancedLeadScore(result) {
  let score = 0;

  // Bonus za metodu detekcije
  if (result.detectionMethod === 'reverse-dns') score += 30;
  else if (result.detectionMethod === 'whois') score += 20;
  else if (result.detectionMethod === 'ip-api') score += 10;

  // Bonus za poznate firme
  const knownCompanies = [
    'microsoft', 'google', 'amazon', 'apple', 'meta', 'facebook',
    'ibm', 'oracle', 'sap', 'salesforce', 'adobe', 'cisco',
    'bosch', 'siemens', 'volkswagen', 'bmw', 'mercedes', 'audi',
    'lufthansa', 'deutsche', 'telekom', 'vodafone'
  ];

  const companyLower = result.company.toLowerCase();
  for (const company of knownCompanies) {
    if (companyLower.includes(company)) {
      score += 50;
      break;
    }
  }

  // Bonus za domen
  if (result.domain && !result.domain.includes('unknown')) {
    score += 15;
  }

  // Geografski bonus (Nemačka, EU, SAD)
  const highValueCountries = ['Germany', 'United States', 'United Kingdom', 'Switzerland', 'Austria'];
  if (highValueCountries.includes(result.country)) {
    score += 10;
  }

  return Math.min(100, score);
}

function getDefaultCompanyInfo(ip) {
  return {
    ip: ip,
    company: 'Unknown',
    domain: null,
    country: 'Unknown',
    city: 'Unknown',
    organization: 'Unknown',
    isp: 'Unknown',
    isHighValue: false,
    leadScore: 0,
    detectionMethod: 'none'
  };
}

// Ostatak koda ostaje isti kao u prethodnoj verziji...
// ROOT endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Enhanced B2B Company Detection System',
    status: 'OK',
    features: [
      'Multi-source IP analysis',
      'Reverse DNS company detection', 
      'WHOIS data integration',
      'VPN detection bypass'
    ],
    totalVisits: visits.length,
    companiesDetected: visits.filter(v => v.detectionMethod !== 'none').length
  });
});

// LOG VISIT endpoint
app.post('/log-visit', async (req, res) => {
  console.log('=== ENHANCED COMPANY DETECTION ===');
  
  try {
    const { referrer, userAgent, currentUrl, pageTitle } = req.body;
    
    const visitorIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress ||
                     req.ip || 
                     'unknown';

    console.log('🌍 Analyzing IP:', visitorIP);
    
    const companyInfo = await getEnhancedCompanyInfo(visitorIP);
    
    if (companyInfo.isHighValue) {
      console.log('🎯 HIGH VALUE COMPANY DETECTED:', companyInfo.company);
      console.log('🔍 Detection method:', companyInfo.detectionMethod);
    }
    
    const visit = {
      ip: companyInfo.ip,
      company: companyInfo.company,
      domain: companyInfo.domain,
      country: companyInfo.country,
      city: companyInfo.city,
      organization: companyInfo.organization,
      isp: companyInfo.isp,
      isHighValue: companyInfo.isHighValue,
      leadScore: companyInfo.leadScore,
      detectionMethod: companyInfo.detectionMethod,
      referrer: referrer || 'direct',
      userAgent: userAgent || req.get('User-Agent') || 'unknown',
      currentUrl: currentUrl || 'unknown',
      pageTitle: pageTitle || 'unknown',
      timestamp: new Date().toISOString()
    };
    
    visits.push(visit);
    
    res.json({
      success: true,
      message: 'Enhanced company detection completed',
      visit: {
        company: visit.company,
        domain: visit.domain,
        location: `${visit.city}, ${visit.country}`,
        isHighValue: visit.isHighValue,
        leadScore: visit.leadScore,
        detectionMethod: visit.detectionMethod
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

// Dashboard API sa poboljšanjima
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
          detectionMethod: visit.detectionMethod || 'none',
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
      detectionMethod: data.detectionMethod,
      uniqueIPs: data.ips.size
    })).sort((a, b) => b.leadScore - a.leadScore);

    const detectedCompanies = companies.filter(c => c.detectionMethod !== 'none');
    const highValueVisitors = companies.filter(c => c.isHighValue);

    res.json({
      success: true,
      totalVisits: visits.length,
      uniqueCompanies: companies.length,
      detectedCompanies: detectedCompanies.length,
      highValueVisitors: highValueVisitors.length,
      companies: companies,
      leads: highValueVisitors,
      recentVisits: visits.slice(-10).reverse().map(v => ({
        company: v.company,
        domain: v.domain,
        ip: v.ip,
        location: `${v.city}, ${v.country}`,
        leadScore: v.leadScore,
        isHighValue: v.isHighValue,
        detectionMethod: v.detectionMethod,
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

// Enhanced Dashboard HTML
app.get('/dashboard', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Enhanced B2B Company Detection</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f8fafc; }
        .container { max-width: 1400px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 2rem; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; margin: 20px 0; }
        .stat { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
        .stat-number { font-size: 2.2em; font-weight: bold; margin-bottom: 5px; }
        .high-value { color: #10b981; }
        .detected { color: #3b82f6; }
        button { background: #3b82f6; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; margin: 5px; }
        table { width: 100%; background: white; border-collapse: collapse; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        th { background: #f9fafb; font-weight: 600; }
        .company-name { font-weight: bold; }
        .high-value-row { background: #ecfdf5; }
        .detected-row { background: #eff6ff; }
        .detection-method { padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .method-dns { background: #10b981; color: white; }
        .method-whois { background: #f59e0b; color: white; }
        .method-ipapi { background: #6366f1; color: white; }
        .method-none { background: #9ca3af; color: white; }
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
            <h1>🔍 Enhanced B2B Company Detection</h1>
            <p>Multi-source company identification system</p>
            <button onclick="refresh()">🔄 Refresh Data</button>
            <button onclick="testRealVisit()">🧪 Test Real Visit</button>
        </div>
        
        <div class="stats">
            <div class="stat">
                <div class="stat-number" id="totalVisits">-</div>
                <div>Total Visits</div>
            </div>
            <div class="stat">
                <div class="stat-number detected" id="detectedCompanies">-</div>
                <div>Companies Detected</div>
            </div>
            <div class="stat">
                <div class="stat-number high-value" id="highValueVisitors">-</div>
                <div>High-Value Leads</div>
            </div>
            <div class="stat">
                <div class="stat-number" id="uniqueCompanies">-</div>
                <div>Unique Visitors</div>
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
                document.getElementById('detectedCompanies').textContent = data.detectedCompanies;
                document.getElementById('highValueVisitors').textContent = data.highValueVisitors;
                document.getElementById('uniqueCompanies').textContent = data.uniqueCompanies;
                
                const companiesTable = data.companies.map(c => {
                    const scoreClass = c.leadScore >= 70 ? 'score-high' : c.leadScore >= 40 ? 'score-medium' : 'score-low';
                    const methodClass = 'method-' + (c.detectionMethod || 'none');
                    let rowClass = '';
                    if (c.isHighValue) rowClass = 'high-value-row';
                    else if (c.detectionMethod !== 'none') rowClass = 'detected-row';
                    
                    return \`<tr class="\${rowClass}">
                        <td class="company-name">\${c.company}</td>
                        <td class="domain">\${c.domain || 'Unknown'}</td>
                        <td>\${c.visits}</td>
                        <td><span class="lead-score \${scoreClass}">\${c.leadScore}</span></td>
                        <td><span class="detection-method \${methodClass}">\${c.detectionMethod || 'none'}</span></td>
                        <td>\${c.location}</td>
                        <td>\${new Date(c.lastVisit).toLocaleString()}</td>
                    </tr>\`;
                }).join('');
                
                const recentTable = data.recentVisits.map(v => {
                    const scoreClass = v.leadScore >= 70 ? 'score-high' : v.leadScore >= 40 ? 'score-medium' : 'score-low';
                    const methodClass = 'method-' + (v.detectionMethod || 'none');
                    
                    return \`<tr>
                        <td class="company-name">\${v.company}</td>
                        <td class="domain">\${v.domain || 'Unknown'}</td>
                        <td class="ip">\${v.ip}</td>
                        <td><span class="lead-score \${scoreClass}">\${v.leadScore}</span></td>
                        <td><span class="detection-method \${methodClass}">\${v.detectionMethod || 'none'}</span></td>
                        <td>\${v.pageTitle}</td>
                        <td>\${new Date(v.timestamp).toLocaleString()}</td>
                    </tr>\`;
                }).join('');
                
                document.getElementById('data').innerHTML = \`
                    <h2>🏢 Detected Companies</h2>
                    <table>
                        <tr>
                            <th>Company</th>
                            <th>Domain</th>
                            <th>Visits</th>
                            <th>Score</th>
                            <th>Detection</th>
                            <th>Location</th>
                            <th>Last Visit</th>
                        </tr>
                        \${companiesTable || '<tr><td colspan="7">No visitors yet</td></tr>'}
                    </table>
                    
                    <h2>🕒 Recent Activity</h2>
                    <table>
                        <tr>
                            <th>Company</th>
                            <th>Domain</th>
                            <th>IP</th>
                            <th>Score</th>
                            <th>Method</th>
                            <th>Page</th>
                            <th>Time</th>
                        </tr>
                        \${recentTable || '<tr><td colspan="7">No recent activity</td></tr>'}
                    </table>
                \`;
            });
        }
        
        function testRealVisit() {
            fetch('/log-visit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    referrer: window.location.href,
                    userAgent: navigator.userAgent,
                    currentUrl: window.location.href,
                    pageTitle: 'Real Company Test'
                })
            }).then(() => {
                setTimeout(refresh, 3000); // Refresh after 3 seconds
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
  console.log(`🔍 Enhanced Company Detection Server running on port ${port}`);
  console.log('🏢 Multi-source IP analysis for better company identification');
});
