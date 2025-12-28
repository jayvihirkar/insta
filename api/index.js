// Serve index.html for root route
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
    // Only handle GET requests to root
    if (req.method !== 'GET' || req.url !== '/') {
        return res.status(404).json({ error: 'Not found' });
    }
    
    try {
        const htmlPath = path.join(__dirname, '..', 'index.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        res.setHeader('Content-Type', 'text/html');
        return res.send(html);
    } catch (error) {
        return res.status(500).json({ error: 'Failed to load page' });
    }
};

