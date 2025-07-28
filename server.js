const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const https = require('https');
const dns = require('dns');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.set('trust proxy', true);

let visits = [];

// Baza poznatih VPN/Proxy servisa i njihovih pravih korisnika
const vpnMappings = {
  'p81': 'Kinto Join',
  'nordvpn': 'NordVPN User',
  'expressvpn': 'ExpressVPN User',
  'surfshark': 'Surfshark User',
  // Dodaj više mappings kako ih otkrivash
};

// Poznate korporativne IP rangove (treba proširiti)
const corporateRanges = {
  'microsoft.com': ['13.64.0.0/11', '20.0.0.0/8'],
  'google.com': ['8.8.8.0/24', '8.8.4.0/24'],
  'amazon.com': ['52.0.0.0/8', '54.0.0.0/8'],
  // Dodaj više rangova
};

// Napredniji sistem detekcije
async function getAdvancedCompanyInfo(ip, userAgent, referrer, currentUrl) {
  console.log('🔍 Advanced analysis starting for IP:', ip);
  
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return getLocalCompanyInfo(ip);
  }

  try {
    // Paralelno pozivamo više servisa
    const [
      ipApiResult,
      ipInfoResult, 
      reverseDnsResult,
      whoisResult,
      browserFingerprintResult
    ] = await Promise.allSettled([
      getIPApiData(ip),
      getIPInfoData(ip),
      getReverseDNS(ip),
      getWhoisData(ip),
      analyzeBrowserFingerprint(userAgent, referrer, currentUrl)
    ]);

    // Kombinujemo sve rezultate
    const analysis = combineAdvancedResults({
      ip,
      ipApi: ipApiResult.status === 'fulfilled' ? ipApiResult.value : null,
      ipInfo: ipInfoResult.status === 'fulfilled' ? ipInfoResult.value : null,
      dns: reverseDnsResult.status === 'fulfilled' ? reverseDnsResult.value : null,
      whois: whoisResult.status === 'fulfilled' ? whoisResult.value : null,
      fingerprint: browserFingerprintResult.status === 'fulfilled' ? browserFingerprintResult.value : null
    });

    console.log('📊 Advanced analysis result:', analysis);
    return analysis;

  } catch (error) {
    console.error('❌ Error in advanced analysis:', error);
    return getUnknownCompanyInfo(ip);
  }
}

// IP-API servis
function getIPApiData(ip) {
  return new Promise((resolve, reject) => {
    const url = `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,isp,org,as,query,reverse,proxy,hosting`;
    
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
    }).on('error', reject).setTimeout(4000, function() {
      this.destroy();
      reject(new Error('Timeout'));
    });
  });
}

// IPInfo servis
function getIPInfoData(ip) {
  return new Promise((resolve, reject) => {
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
    }).on('error', reject).setTimeout(4000, function() {
      this.destroy();
      reject(new Error('Timeout'));
    });
  });
}

// Napredni Reverse DNS
function getReverseDNS(ip) {
  return new Promise((resolve) => {
    dns.reverse(ip, (err, hostnames) => {
      if (err || !hostnames || hostnames.length === 0) {
        // Ako nema reverse DNS, pokušaj sa PTR lookup
        dns.resolve(ip, 'PTR', (ptrErr, ptrRecords) => {
          resolve(ptrErr ? null : { hostnames: ptrRecords, source: 'PTR' });
        });
      } else {
        resolve({ hostnames, source: 'reverse' });
      }
    });
  });
}

// WHOIS lookup
function getWhoisData(ip) {
  return new Promise((resolve, reject) => {
    // Koristi whois.arin.net za WHOIS podatke
    const url = `http://whois.arin.net/rest/ip/${ip}.json`;
    
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
    }).on('error', reject).setTimeout(5000, function() {
      this.destroy();
      reject(new Error('Timeout'));
    });
  });
}

// Analiza browser fingerprint-a
function analyzeBrowserFingerprint(userAgent, referrer, currentUrl) {
  return new Promise((resolve) => {
    const analysis = {
      userAgent: userAgent,
      referrer: referrer,
      currentUrl: currentUrl,
      insights: []
    };

    // Analiza User Agent-a za korporativne znakove
    if (userAgent) {
      // Korporativni User Agent-i često imaju specifične verzije ili dodatke
      if (userAgent.includes('corporate') || userAgent.includes('enterprise')) {
        analysis.insights.push('Corporate User Agent detected');
      }
      
      // Analiza verzija browser-a
      const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
      if (chromeMatch) {
        const version = parseInt(chromeMatch[1]);
        if (version < 100) {  // Starije verzije mogu ukazivati na korporativno okruženje
          analysis.insights.push('Potentially managed browser version');
        }
      }
    }

    // Analiza referrer-a
    if (referrer && referrer !== 'direct') {
      try {
        const refUrl = new URL(referrer);
        if (refUrl.hostname.includes('internal') || refUrl.hostname.includes('corp')) {
          analysis.insights.push('Internal/Corporate referrer detected');
        }
      } catch (e) {
        // Ignore invalid URLs
      }
    }

    resolve(analysis);
  });
}

// Kombinuje sve rezultate u finalni rezultat
function combineAdvancedResults(data) {
  const result = {
    ip: data.ip,
    company: 'Unknown',
    realCompany: null, // Prava firma iza VPN-a
    domain: null,
    country: 'Unknown',
    city: 'Unknown',
    organization: 'Unknown',
    isp: 'Unknown',
    isVPN: false,
    isProxy: false,
    isHighValue: false,
    leadScore: 0,
    detectionMethod: 'none',
    confidence: 0,
    allSources: data
  };

  let bestMatch = null;
  let highestConfidence = 0;

  // 1. Proverava VPN mappings PRVO
  if (data.ipApi || data.ipInfo) {
    const org = (data.ipApi?.org || data.ipInfo?.org || '').toLowerCase();
    const isp = (data.ipApi?.isp || data.ipInfo?.isp || '').toLowerCase();
    
    console.log('🔍 Checking VPN mappings for org:', org, 'isp:', isp);
    
    for (const [vpnKey, realCompany] of Object.entries(vpnMappings)) {
      if (org.includes(vpnKey) || isp.includes(vpnKey)) {
        console.log('✅ VPN mapping found:', vpnKey, '->', realCompany);
        bestMatch = {
          company: realCompany,
          realCompany: realCompany,
          domain: guessCompanyDomain(realCompany),
          detectionMethod: 'vpn-mapping',
          confidence: 95,
          isVPN: true
        };
        highestConfidence = 95;
        break;
      }
    }
  }

  // 2. Reverse DNS analiza (ako nema VPN match)
  if (!bestMatch && data.dns && data.dns.hostnames) {
    for (const hostname of data.dns.hostnames) {
      const companyFromDNS = extractCompanyFromHostname(hostname);
      if (companyFromDNS.confidence > highestConfidence) {
        bestMatch = {
          company: companyFromDNS.company,
          domain: companyFromDNS.domain,
          detectionMethod: 'reverse-dns',
          confidence: companyFromDNS.confidence
        };
        highestConfidence = companyFromDNS.confidence;
      }
    }
  }

  // 3. Organization name analiza
  if (!bestMatch || highestConfidence < 70) {
    const sources = [data.ipApi, data.ipInfo].filter(Boolean);
    
    for (const source of sources) {
      if (source.org) {
        const companyFromOrg = extractCompanyFromOrganization(source.org);
        if (companyFromOrg.confidence > highestConfidence) {
          bestMatch = {
            company: companyFromOrg.company,
            domain: companyFromOrg.domain,
            detectionMethod: 'organization',
            confidence: companyFromOrg.confidence
          };
          highestConfidence = companyFromOrg.confidence;
        }
      }
    }
  }

  // Primeni najbolji match
  if (bestMatch) {
    result.company = bestMatch.company;
    result.realCompany = bestMatch.realCompany || bestMatch.company;
    result.domain = bestMatch.domain;
    result.detectionMethod = bestMatch.detectionMethod;
    result.confidence = bestMatch.confidence;
    result.isVPN = bestMatch.isVPN || false;
  }

  // Postavi osnovne informacije
  if (data.ipApi) {
    result.country = data.ipApi.country || 'Unknown';
    result.city = data.ipApi.city || 'Unknown';
    result.organization = data.ipApi.org || 'Unknown';
    result.isp = data.ipApi.isp || 'Unknown';
    result.isProxy = data.ipApi.proxy || false;
  } else if (data.ipInfo) {
    result.country = data.ipInfo.country || 'Unknown';
    result.city = data.ipInfo.city || 'Unknown';
    result.organization = data.ipInfo.org || 'Unknown';
  }

  // Izračunaj lead score
  result.leadScore = calculateAdvancedLeadScore(result);
  result.isHighValue = result.leadScore >= 70;

  return result;
}

// Poboljšana ekstraktovanje firme iz hostname-a
function extractCompanyFromHostname(hostname) {
  if (!hostname) return { company: 'Unknown', confidence: 0 };

  console.log('🔍 Analyzing hostname:', hostname);

  const parts = hostname.toLowerCase().split('.');
  
  // Specifični paterni za poznate firme
  const patterns = [
    { pattern: /mail\.(.+)\.com/, group: 1, confidence: 90 },
    { pattern: /vpn\.(.+)\.com/, group: 1, confidence: 85 },
    { pattern: /gateway\.(.+)\.com/, group: 1, confidence: 85 },
    { pattern: /(.+)\.corp\./, group: 1, confidence: 95 },
    { pattern: /(.+)-corp\./, group: 1, confidence: 95 },
    { pattern: /internal\.(.+)\./, group: 1, confidence: 90 }
  ];

  for (const pattern of patterns) {
    const match = hostname.match(pattern.pattern);
    if (match && match[pattern.group]) {
      const company = capitalizeCompanyName(match[pattern.group]);
      console.log('✅ Hostname pattern match:', company, 'confidence:', pattern.confidence);
      return {
        company: company,
        domain: match[pattern.group] + '.com',
        confidence: pattern.confidence
      };
    }
  }

  // Fallback na standardnu analizu
  if (parts.length >= 2) {
    const mainDomain = parts[parts.length - 2];
    if (mainDomain.length > 2 && !isCommonTLD(mainDomain)) {
      return {
        company: capitalizeCompanyName(mainDomain),
        domain: parts.slice(-2).join('.'),
        confidence: 60
      };
    }
  }

  return { company: 'Unknown', confidence: 0 };
}

// Poboljšano ekstraktovanje firme iz organizacije
function extractCompanyFromOrganization(org) {
  if (!org) return { company: 'Unknown', confidence: 0 };

  console.log('🔍 Analyzing organization:', org);

  // Prvo proverava da li je VPN/Proxy
  const vpnIndicators = ['vpn', 'proxy', 'tunnel', 'anonymous', 'privacy'];
  const orgLower = org.toLowerCase();
  
  for (const indicator of vpnIndicators) {
    if (orgLower.includes(indicator)) {
      // Možda je VPN, ali pokušaj da nadje pravu firmu
      for (const [vpnKey, realCompany] of Object.entries(vpnMappings)) {
        if (orgLower.includes(vpnKey)) {
          console.log('✅ VPN organization mapping:', vpnKey, '->', realCompany);
          return {
            company: realCompany,
            domain: guessCompanyDomain(realCompany),
            confidence: 90
          };
        }
      }
      
      return {
        company: 'VPN/Proxy User',
        confidence: 30
      };
    }
  }

  // Standardno čišćenje organizacije
  const cleaned = cleanOrganizationName(org);
  
  if (cleaned !== org && cleaned.length > 2) {
    return {
      company: cleaned,
      domain: guessCompanyDomain(cleaned),
      confidence: 75
    };
  }

  return { company: org, confidence: 50 };
}

// Helper funkcije
function cleanOrganizationName(org) {
  if (!org) return 'Unknown';
  
  return org
    .replace(/\bAS\d+\s*/gi, '')
    .replace(/\b(LLC|Inc|Corp|Ltd|Limited|GmbH|AG|SA|SPA|BV|Pty|Co\.|Company|Corporation)\b/gi, '')
    .replace(/\b(Internet|Broadband|Telecommunications|Telecom|Networks?|Services?|Solutions?|Technologies?|Tech|Systems?|Communications?|Comm|ISP|Hosting|Cloud|VPN|Proxy)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || org;
}

function capitalizeCompanyName(name) {
  if (!name) return 'Unknown';
  return name.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function guessCompanyDomain(companyName) {
  if (!companyName || companyName === 'Unknown') return null;
  
  const cleaned = companyName.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(' ')[0]
    .substring(0, 15);
  
  return cleaned.length > 2 ? cleaned + '.com' : null;
}

function isCommonTLD(domain) {
  const commonTLDs = ['com', 'net', 'org', 'edu', 'gov', 'mil', 'int'];
  return commonTLDs.includes(domain);
}

function calculateAdvancedLeadScore(result) {
  let score = 0;

  // Bonus za metodu detekcije
  switch (result.detectionMethod) {
    case 'vpn-mapping': score += 40; break;
    case 'reverse-dns': score += 35; break;
    case 'organization': score += 25; break;
    default: score += 5;
  }

  // Bonus za confidence
  score += Math.floor(result.confidence / 10);

  // Bonus za poznate firme
  const knownCompanies = [
    'microsoft', 'google', 'amazon', 'apple', 'meta',
    'ibm', 'oracle', 'sap', 'salesforce', 'adobe',
    'bosch', 'siemens', 'volkswagen', 'bmw', 'mercedes',
    'kinto', 'join', 'telekom', 'vodafone'
  ];

  const companyLower = (result.realCompany || result.company).toLowerCase();
  for (const company of knownCompanies) {
    if (companyLower.includes(company)) {
      score += 30;
      break;
    }
  }

  // Penalty za VPN bez real company
  if (result.isVPN && !result.realCompany) {
    score -= 20;
  }

  return Math.max(0, Math.min(100, score));
}

function getLocalCompanyInfo(ip) {
  return {
    ip: ip,
    company: 'Local Network',
    domain: 'local',
    country: 'Local',
    city: 'Local',
    organization: 'Local Network',
    isHighValue: false,
    leadScore: 0,
    detectionMethod: 'local',
    confidence: 100
  };
}

function getUnknownCompanyInfo(ip) {
  return {
    ip: ip,
    company: 'Unknown',
    domain: null,
    country: 'Unknown',
    city: 'Unknown', 
    organization: 'Unknown',
    isHighValue: false,
    leadScore: 0,
    detectionMethod: 'none',
    confidence: 0
  };
}

// Dodaj endpoint za manual mapping
app.post('/add-mapping', (req, res) => {
  const { vpnIdentifier, realCompany } = req.body;
  
  if (vpnIdentifier && realCompany) {
    vpnMappings[vpnIdentifier.toLowerCase()] = realCompany;
    console.log('✅ Added new VPN mapping:', vpnIdentifier, '->', realCompany);
    
    res.json({
      success: true,
      message: 'VPN mapping added successfully',
      mapping: { [vpnIdentifier]: realCompany }
    });
  } else {
    res.status(400).json({
      success: false,
      error: 'Both vpnIdentifier and realCompany are required'
    });
  }
});

// ROOT endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Advanced B2B Company Detection System',
    version: '2.0',
    features: [
      'VPN/Proxy real company mapping',
      'Multi-source IP analysis',
      'Advanced hostname analysis',
      'Manual company mappings',
      'Confidence scoring'
    ],
    totalVisits: visits.length,
    vpnMappings: Object.keys(vpnMappings).length,
    companiesDetected: visits.filter(v => v.detectionMethod !== 'none').length
  });
});

// LOG VISIT endpoint - sa naprednijom analizom
app.post('/log-visit', async (req, res) => {
  console.log('=== ADVANCED COMPANY DETECTION ===');
  
  try {
    const { referrer, userAgent, currentUrl, pageTitle } = req.body;
    
    const visitorIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress ||
                     req.ip || 
                     'unknown';

    console.log('🌍 Analyzing visitor IP:', visitorIP);
    console.log('🔍 User Agent:', userAgent);
    
    const companyInfo = await getAdvancedCompanyInfo(visitorIP, userAgent, referrer, currentUrl);
    
    if (companyInfo.isHighValue) {
      console.log('🎯 HIGH VALUE LEAD DETECTED:', companyInfo.company);
      if (companyInfo.realCompany) {
        console.log('🏢 Real company behind VPN:', companyInfo.realCompany);
      }
    }
    
    const visit = {
      ip: companyInfo.ip,
      company: companyInfo.company,
      realCompany: companyInfo.realCompany,
      domain: companyInfo.domain,
      country: companyInfo.country,
      city: companyInfo.city,
      organization: companyInfo.organization,
      isp: companyInfo.isp,
      isVPN: companyInfo.isVPN,
      isProxy: companyInfo.isProxy,
      isHighValue: companyInfo.isHighValue,
      leadScore: companyInfo.leadScore,
      detectionMethod: companyInfo.detectionMethod,
      confidence: companyInfo.confidence,
      referrer: referrer || 'direct',
      userAgent: userAgent || req.get('User-Agent') || 'unknown',
      currentUrl: currentUrl || 'unknown',
      pageTitle: pageTitle || 'unknown',
      timestamp: new Date().toISOString()
    };
    
    visits.push(visit);
    
    res.json({
      success: true,
      message: 'Advanced company detection completed',
      visit: {
        company: visit.company,
        realCompany: visit.realCompany,
        domain: visit.domain,
        location: `${visit.city}, ${visit.country}`,
        isVPN: visit.isVPN,
        isHighValue: visit.isHighValue,
        leadScore: visit.leadScore,
        detectionMethod: visit.detectionMethod,
        confidence: visit.confidence
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

// Dashboard API
app.get('/api/dashboard', (req, res) => {
  try {
    const companySummary = {};
    
    visits.forEach(visit => {
      const company = visit.realCompany || visit.company || 'Unknown';
      if (!companySummary[company]) {
        companySummary[company] = { 
          count: 0,
          displayCompany: visit.company,
          realCompany: visit.realCompany,
          lastVisit: '',
          leadScore: visit.leadScore || 0,
          isHighValue: visit.isHighValue || false,
          domain: visit.domain,
          location: `${visit.city}, ${visit.country}`,
          detectionMethod: visit.detectionMethod || 'none',
          confidence: visit.confidence || 0,
          isVPN: visit.isVPN || false,
          ips: new Set()
        };
      }
      companySummary[company].count++;
      companySummary[company].lastVisit = visit.timestamp;
      companySummary[company].ips.add(visit.ip);
    });

    const companies = Object.entries(companySummary).map(([company, data]) => ({
      company: company,
      displayCompany: data.displayCompany,
      realCompany: data.realCompany,
      domain: data.domain,
      visits: data.count,
      lastVisit: data.lastVisit,
      leadScore: data.leadScore,
      isHighValue: data.isHighValue,
      location: data.location,
      detectionMethod: data.detectionMethod,
      confidence: data.confidence,
      isVPN: data.isVPN,
      uniqueIPs: data.ips.size
    })).sort((a, b) => b.leadScore - a.leadScore);

    const detectedCompanies = companies.filter(c => c.detectionMethod !== 'none');
    const highValueVisitors = companies.filter(c => c.isHighValue);
    const vpnVisitors = companies.filter(c => c.isVPN);

    res.json({
      success: true,
      totalVisits: visits.length,
      uniqueCompanies: companies.length,
      detectedCompanies: detectedCompanies.length,
      highValueVisitors: highValueVisitors.length,
      vpnVisitors: vpnVisitors.length,
      companies: companies,
      leads: highValueVisitors,
      recentVisits: visits.slice(-10).reverse().map(v => ({
        company: v.company,
        realCompany: v.realCompany,
        domain: v.domain,
        ip: v.ip,
        location: `${v.city}, ${v.country}`,
        leadScore: v.leadScore,
        isHighValue: v.isHighValue,
        isVPN: v.isVPN,
        detectionMethod: v.detectionMethod,
        confidence: v.confidence,
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

// Enhanced Dashboard
app.get('/dashboard', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Advanced B2B Company Detection v2.0</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f8fafc; }
        .container { max-width: 1500px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 2rem; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 15px; margin: 20px 0; }
        .stat { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
        .stat-number { font-size: 2em; font-weight: bold; margin-bottom: 5px; }
        .high-value { color: #10b981; }
        .detected { color: #3b82f6; }
        .vpn { color: #f59e0b; }
        button { background: #3b82f6; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; margin: 5px; }
        .add-mapping { background: #10b981; }
        table { width: 100%; background: white; border-collapse: collapse; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin: 15px 0; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb; font-size: 0.9em; }
        th { background: #f9fafb; font-weight: 600; }
        .company-name { font-weight: bold; }
        .real-company { color: #10b981; font-weight: bold; }
        .high-value-row { background: #ecfdf5; }
        .vpn-row { background: #fffbeb; }
        .confidence { padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .conf-high { background: #10b981; color: white; }
        .conf-medium { background: #f59e0b; color: white; }
        .conf-low { background: #ef4444; color: white; }
        .detection-method { padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .method-vpn-mapping { background: #10b981; color: white; }
        .method-reverse-dns { background: #3b82f6; color: white; }
        .method-organization { background: #f59e0b; color: white; }
        .method-none { background: #9ca3af; color: white; }
        .vpn-badge { background: #f59e0b; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .domain { font-family: monospace; color: #6366f1; }
        .ip { font-family: monospace; color: #64748b; font-size: 0.85em; }
        .mapping-form { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .mapping-form input { padding: 8px; margin: 5px; border: 1px solid #d1d5db; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 Advanced B2B Company Detection v2.0</h1>
            <p>VPN-aware multi-source company identification system</p>
            <button onclick="refresh()">🔄 Refresh Data</button>
            <button onclick="testRealVisit()">🧪 Test Real Visit</button>
            <button class="add-mapping" onclick="showMappingForm()">➕ Add VPN Mapping</button>
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
                <div class="stat-number vpn" id="vpnVisitors">-</div>
                <div>VPN Users</div>
            </div>
            <div class="stat">
                <div class="stat-number" id="uniqueCompanies">-</div>
                <div>Unique Visitors</div>
            </div>
        </div>
        
        <div id="mappingForm" style="display:none;" class="mapping-form">
            <h3>Add VPN/Proxy Mapping</h3>
            <p>When you see a VPN identifier (like 'p81'), map it to the real company:</p>
            <input type="text" id="vpnId" placeholder="VPN identifier (e.g., p81)" />
            <input type="text" id="realCompany" placeholder="Real company name (e.g., Kinto Join)" />
            <button onclick="addMapping()">Add Mapping</button>
            <button onclick="hideMappingForm()">Cancel</button>
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
                document.getElementById('vpnVisitors').textContent = data.vpnVisitors;
                document.getElementById('uniqueCompanies').textContent = data.uniqueCompanies;
                
                const companiesTable = data.companies.map(c => {
                    const confClass = c.confidence >= 80 ? 'conf-high' : c.confidence >= 50 ? 'conf-medium' : 'conf-low';
                    const methodClass = 'method-' + (c.detectionMethod || 'none').replace('-', '-');
                    let rowClass = '';
                    if (c.isHighValue) rowClass = 'high-value-row';
                    else if (c.isVPN) rowClass = 'vpn-row';
                    
                    const companyDisplay = c.realCompany ? 
                        \`<span class="real-company">\${c.realCompany}</span><br><small>via: \${c.displayCompany}</small>\` : 
                        c.company;
                    
                    return \`<tr class="\${rowClass}">
                        <td class="company-name">\${companyDisplay}</td>
                        <td class="domain">\${c.domain || 'Unknown'}</td>
                        <td>\${c.visits}</td>
                        <td>\${c.leadScore}</td>
                        <td><span class="confidence \${confClass}">\${c.confidence}%</span></td>
                        <td><span class="detection-method \${methodClass}">\${c.detectionMethod || 'none'}</span></td>
                        <td>\${c.isVPN ? '<span class="vpn-badge">VPN</span>' : 'Direct'}</td>
                        <td>\${c.location}</td>
                        <td>\${new Date(c.lastVisit).toLocaleString()}</td>
                    </tr>\`;
                }).join('');
                
                const recentTable = data.recentVisits.map(v => {
                    const confClass = v.confidence >= 80 ? 'conf-high' : v.confidence >= 50 ? 'conf-medium' : 'conf-low';
                    const methodClass = 'method-' + (v.detectionMethod || 'none').replace('-', '-');
                    
                    const companyDisplay = v.realCompany ? 
                        \`<span class="real-company">\${v.realCompany}</span><br><small>via: \${v.company}</small>\` : 
                        v.company;
                    
                    return \`<tr>
                        <td class="company-name">\${companyDisplay}</td>
                        <td class="ip">\${v.ip}</td>
                        <td>\${v.leadScore}</td>
                        <td><span class="confidence \${confClass}">\${v.confidence}%</span></td>
                        <td><span class="detection-method \${methodClass}">\${v.detectionMethod || 'none'}</span></td>
                        <td>\${v.isVPN ? '<span class="vpn-badge">VPN</span>' : 'Direct'}</td>
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
                            <th>Confidence</th>
                            <th>Detection</th>
                            <th>Connection</th>
                            <th>Location</th>
                            <th>Last Visit</th>
                        </tr>
                        \${companiesTable || '<tr><td colspan="9">No visitors yet</td></tr>'}
                    </table>
                    
                    <h2>🕒 Recent Activity</h2>
                    <table>
                        <tr>
                            <th>Company</th>
                            <th>IP</th>
                            <th>Score</th>
                            <th>Conf.</th>
                            <th>Method</th>
                            <th>Conn.</th>
                            <th>Page</th>
                            <th>Time</th>
                        </tr>
                        \${recentTable || '<tr><td colspan="8">No recent activity</td></tr>'}
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
                    pageTitle: 'Advanced Company Detection Test'
                })
            }).then(() => {
                setTimeout(refresh, 4000); // Refresh after 4 seconds to allow analysis
            });
        }
        
        function showMappingForm() {
            document.getElementById('mappingForm').style.display = 'block';
        }
        
        function hideMappingForm() {
            document.getElementById('mappingForm').style.display = 'none';
        }
        
        function addMapping() {
            const vpnId = document.getElementById('vpnId').value.trim();
            const realCompany = document.getElementById('realCompany').value.trim();
            
            if (!vpnId || !realCompany) {
                alert('Please fill in both fields');
                return;
            }
            
            fetch('/add-mapping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vpnIdentifier: vpnId,
                    realCompany: realCompany
                })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    alert('Mapping added successfully!');
                    document.getElementById('vpnId').value = '';
                    document.getElementById('realCompany').value = '';
                    hideMappingForm();
                } else {
                    alert('Error: ' + data.error);
                }
            });
        }
        
        refresh();
        setInterval(refresh, 90000); // Refresh every 90 seconds
    </script>
</body>
</html>
  `);
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(port, () => {
  console.log(`🔍 Advanced Company Detection v2.0 running on port ${port}`);
  console.log('🏢 VPN-aware multi-source company identification system');
  console.log('📊 Current VPN mappings:', Object.keys(vpnMappings).length);
});
