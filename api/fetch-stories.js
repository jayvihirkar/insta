// Vercel serverless function wrapper
const { IgApiClient } = require('instagram-private-api');

// For Vercel, we'll use environment variables and handle session in memory
// Note: Serverless functions are stateless, so we'll need to login each time
// but we can optimize by checking if session is still valid

module.exports = async (req, res) => {
    // Handle GET requests for testing
    if (req.method === 'GET') {
        return res.status(200).json({ 
            success: true, 
            message: 'API endpoint is working. Use POST method with { username: "..." } in body.',
            method: req.method,
            url: req.url
        });
    }
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    // Parse request body for Vercel
    let body = {};
    try {
        if (typeof req.body === 'string') {
            body = JSON.parse(req.body);
        } else if (req.body) {
            body = req.body;
        }
    } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid JSON in request body' });
    }

    const { username } = body;
    if (!username) {
        return res.status(400).json({ success: false, message: "Username is required" });
    }

    const igUsername = process.env.IG_USERNAME;
    const igPassword = process.env.IG_PASSWORD;

    if (!igUsername || !igPassword) {
        return res.status(401).json({ 
            success: false, 
            message: "Instagram credentials not configured. Please set IG_USERNAME and IG_PASSWORD environment variables in Vercel." 
        });
    }

    try {
        console.log(`Fetching stories for ${username} using Instagram API`);
        
        const ig = new IgApiClient();
        ig.state.generateDevice(igUsername);
        
        // Login (Vercel serverless functions are stateless, so we login each time)
        // In production, you might want to use Vercel KV or similar for session storage
        try {
            await ig.account.login(igUsername, igPassword);
        } catch (loginError) {
            console.error('Instagram login error:', loginError);
            
            // Provide more helpful error messages
            if (loginError.message && loginError.message.includes('challenge_required')) {
                return res.status(401).json({ 
                    success: false, 
                    message: "Instagram requires account verification. Please log in to Instagram on a browser first to verify the account, then try again." 
                });
            }
            
            if (loginError.message && loginError.message.includes('bad_password')) {
                return res.status(401).json({ 
                    success: false, 
                    message: "Invalid Instagram credentials. Please check your IG_USERNAME and IG_PASSWORD in Vercel environment variables." 
                });
            }
            
            if (loginError.message && loginError.message.includes('400')) {
                return res.status(401).json({ 
                    success: false, 
                    message: "Instagram login failed. Possible reasons: 1) Wrong credentials, 2) 2FA is enabled (disable it or use app-specific password), 3) Account needs verification, 4) Instagram is blocking automated logins. Try logging into Instagram on a browser first." 
                });
            }
            
            throw loginError; // Re-throw if it's a different error
        }
        
        // Get user ID by username
        const userId = await ig.user.getIdByUsername(username);
        console.log(`User ID for ${username}: ${userId}`);
        
        // Get user's stories
        const reelsFeed = ig.feed.userStory(userId);
        const storyItems = await reelsFeed.items();
        
        if (!storyItems || storyItems.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "No active stories found for this user." 
            });
        }
        
        // Extract media URLs
        const mediaUrls = storyItems.map(item => {
            if (item.video_versions && item.video_versions.length > 0) {
                return item.video_versions[0].url;
            } else if (item.image_versions2?.candidates && item.image_versions2.candidates.length > 0) {
                return item.image_versions2.candidates[0].url;
            }
            return null;
        }).filter(url => url !== null);
        
        if (mediaUrls.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "No media URLs found in stories." 
            });
        }
        
        console.log(`Found ${mediaUrls.length} story items`);
        return res.json({ success: true, media: mediaUrls });
        
    } catch (error) {
        console.error('Error fetching stories:', error.message);
        return res.status(500).json({ 
            success: false, 
            message: error.message || "Failed to fetch stories. Please check your Instagram credentials." 
        });
    }
};

