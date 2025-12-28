// Simple test endpoint to verify Vercel is working
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ 
        success: true, 
        message: 'API is working!',
        timestamp: new Date().toISOString()
    });
};

