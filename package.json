// Referrer tracking server with simple dashboard (Node.js + Express)

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

let visits = [];

// POST endpoint to receive referrer logs
app.post('/log-visit', (req, res) => {
  const referrer = req.body.referrer || 'Direct';
  let domain = 'unknown';
  try {
    domain = new URL(referrer).hostname;
  } catch (e) {
    domain = 'direct';
  }
  visits.push({
    domain,
    timestamp: new Date().toISOString()
  });
  res.sendStatus(200);
});

// GET endpoint for dashboard view
app.get('/dashboard', (req, res) => {
  // Aggregate visits by domain
  const summary = {};
  visits.forEach(visit => {
    if (!summary[visit.domain]) {
      summary[visit.domain] = { count: 0, lastVisit: '' };
    }
    summary[visit.domain].count++;
    summary[visit.domain].lastVisit = visit.timestamp;
  });

  const result = Object.entries(summary).map(([domain, data]) => ({
    domain,
    visits: data.count,
    lastVisit: data.lastVisit
  }));

  res.json(result);
});

// Root endpoint to test server
app.get('/', (req, res) => {
  res.send('Referrer tracking server is running.');
});

app.listen(port, () => console.log(`Tracker server running on port ${port}`));
