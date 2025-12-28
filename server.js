const express = require('express');
const puppeteer = require('puppeteer');
const { IgApiClient } = require('instagram-private-api');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const app = express();

// Load environment variables
require('dotenv').config();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Instagram API client (will be initialized when credentials are provided)
let igClient = null;
let isLoggedIn = false;
const SESSION_FILE = path.join(__dirname, 'ig-session.json');

// Keep browser instance for reuse
let browser = null;

async function getBrowser() {
    if (!browser) {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
        });
    }
    return browser;
}

// Save Instagram session state
async function saveSession(ig) {
    try {
        const state = await ig.state.serialize();
        await fs.writeFile(SESSION_FILE, JSON.stringify(state, null, 2));
        console.log('Instagram session saved');
    } catch (error) {
        console.error('Failed to save session:', error.message);
    }
}

// Load Instagram session state
async function loadSession(ig, igUsername) {
    try {
        const sessionData = await fs.readFile(SESSION_FILE, 'utf8');
        const state = JSON.parse(sessionData);
        await ig.state.deserialize(state);
        ig.state.generateDevice(igUsername); // Regenerate device info
        console.log('Instagram session loaded');
        return true;
    } catch (error) {
        console.log('No saved session found or failed to load:', error.message);
        return false;
    }
}

// Initialize Instagram API client with session persistence
async function initInstagramClient(igUsername, igPassword) {
    if (!igUsername || !igPassword) {
        return null;
    }
    
    try {
        const ig = new IgApiClient();
        ig.state.generateDevice(igUsername);
        
        // Try to load saved session first
        const sessionLoaded = await loadSession(ig, igUsername);
        
        if (!sessionLoaded) {
            // No saved session, login fresh
            console.log('Logging in to Instagram...');
            await ig.account.login(igUsername, igPassword);
            await saveSession(ig);
        } else {
            // Session loaded, verify it's still valid
            try {
                await ig.account.currentUser();
                console.log('Using saved Instagram session');
            } catch (error) {
                // Session expired, login again
                console.log('Session expired, logging in again...');
                await ig.account.login(igUsername, igPassword);
                await saveSession(ig);
            }
        }
        
        isLoggedIn = true;
        return ig;
    } catch (error) {
        console.error('Instagram login failed:', error.message);
        // If login fails, try to delete corrupted session
        try {
            await fs.unlink(SESSION_FILE);
        } catch (e) {
            // Ignore
        }
        return null;
    }
}

app.post('/fetch-stories', async (req, res) => {
    const { username, igUsername, igPassword } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, message: "Username is required" });
    }
    
    // Try to use Instagram Private API if credentials are provided
    const credentials = igUsername && igPassword ? { username: igUsername, password: igPassword } : 
                       process.env.IG_USERNAME && process.env.IG_PASSWORD ? 
                       { username: process.env.IG_USERNAME, password: process.env.IG_PASSWORD } : null;
    
    if (credentials) {
        try {
            console.log(`Using Instagram Private API for ${username}`);
            
            // Initialize or reuse client
            if (!igClient || !isLoggedIn) {
                igClient = await initInstagramClient(credentials.username, credentials.password);
                if (!igClient) {
                    return res.status(401).json({ 
                        success: false, 
                        message: "Failed to login to Instagram. Please check your credentials." 
                    });
                }
            }
            
            // Get user ID by username
            const userId = await igClient.user.getIdByUsername(username);
            console.log(`User ID for ${username}: ${userId}`);
            
            // Get user's stories
            const reelsFeed = igClient.feed.userStory(userId);
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
            
            console.log(`Found ${mediaUrls.length} story items via Instagram API`);
            return res.json({ success: true, media: mediaUrls });
            
        } catch (error) {
            console.error('Instagram API error:', error.message);
            // Fall through to Puppeteer method
            console.log('Falling back to Puppeteer method...');
        }
    }
    
    // Fallback to Puppeteer method (original code)

    let page = null;
    try {
        console.log(`Fetching stories for ${username}`);
        const browserInstance = await getBrowser();
        page = await browserInstance.newPage();
        
        // Set viewport and user agent
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        const profileUrl = `https://www.instagram.com/${username}/`;
        console.log(`Navigating to ${profileUrl}`);
        
        // Intercept network requests to capture API responses
        const apiResponses = [];
        page.on('response', async (response) => {
            const url = response.url();
            // Look for GraphQL API calls or user profile API calls
            if (url.includes('/graphql/query/') || 
                url.includes('/api/v1/users/') || 
                url.includes('/api/v1/feed/user/') ||
                url.includes('reel') ||
                url.includes('stories')) {
                try {
                    const responseData = await response.json();
                    apiResponses.push({ url, data: responseData });
                } catch (e) {
                    // Not JSON, ignore
                }
            }
        });
        
        // Navigate to profile page
        await page.goto(profileUrl, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });
        
        // Wait for API calls to complete
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Check if we're on a login page
        const isLoginPage = await page.evaluate(() => {
            return document.body.innerText.includes('Log in') || 
                   document.body.innerText.includes('Sign up') ||
                   window.location.href.includes('/accounts/login');
        });
        
        if (isLoginPage) {
            await page.close();
            return res.status(401).json({ 
                success: false, 
                message: "Instagram requires login to view stories. Please use a package that supports authentication like 'instagram-private-api'." 
            });
        }
        
        // Try to extract story data from API responses first
        let storyDataFromAPI = [];
        for (const response of apiResponses) {
            try {
                const data = response.data;
                // Look for reel/story data in various structures
                if (data.data?.user?.reel?.items) {
                    const items = data.data.user.reel.items;
                    storyDataFromAPI = items.map(item => {
                        if (item.video_versions && item.video_versions.length > 0) {
                            return item.video_versions[0].url;
                        } else if (item.image_versions2?.candidates) {
                            return item.image_versions2.candidates[0].url;
                        }
                        return null;
                    }).filter(url => url !== null);
                    if (storyDataFromAPI.length > 0) break;
                }
                // Try alternative structure
                if (data.user?.reel?.items) {
                    const items = data.user.reel.items;
                    storyDataFromAPI = items.map(item => {
                        if (item.video_versions && item.video_versions.length > 0) {
                            return item.video_versions[0].url;
                        } else if (item.image_versions2?.candidates) {
                            return item.image_versions2.candidates[0].url;
                        }
                        return null;
                    }).filter(url => url !== null);
                    if (storyDataFromAPI.length > 0) break;
                }
            } catch (e) {
                // Continue to next response
            }
        }
        
        if (storyDataFromAPI.length > 0) {
            console.log(`Found ${storyDataFromAPI.length} stories from API responses`);
            await page.close();
            return res.json({ success: true, media: storyDataFromAPI });
        }
        
        // Try to get user ID and fetch stories directly via API
        const userId = await page.evaluate(() => {
            // Try to find user ID in the page
            const scripts = Array.from(document.querySelectorAll('script'));
            for (const script of scripts) {
                const content = script.textContent || script.innerHTML;
                if (content && (content.includes('"id"') || content.includes('"pk"'))) {
                    try {
                        // Look for user ID patterns
                        const idMatch = content.match(/"id":\s*"(\d+)"/);
                        if (idMatch) return idMatch[1];
                        const pkMatch = content.match(/"pk":\s*"(\d+)"/);
                        if (pkMatch) return pkMatch[1];
                    } catch (e) {
                        // Continue
                    }
                }
            }
            return null;
        });
        
        console.log(`User ID found: ${userId}`);
        console.log(`API responses captured: ${apiResponses.length}`);
        
        // Extract story data from page with comprehensive search
        const pageInfo = await page.evaluate(() => {
            // Check for additional data loaded by Instagram
            const additionalDataKeys = Object.keys(window).filter(key => 
                key.includes('Data') || key.includes('Config') || key.includes('Graph') || key.includes('Reel')
            );
            
            // Try to find data in various window properties
            let foundData = null;
            for (const key of additionalDataKeys) {
                try {
                    const data = window[key];
                    if (data && typeof data === 'object') {
                        // Look for reel/story data
                        if (JSON.stringify(data).includes('reel') || JSON.stringify(data).includes('story')) {
                            foundData = { source: key, data: data };
                            break;
                        }
                    }
                } catch (e) {
                    // Continue
                }
            }
            const result = {
                hasSharedData: !!window._sharedData,
                pageTitle: document.title,
                url: window.location.href,
                scripts: 0,
                storyData: [],
                debug: {}
            };
            
            function extractMediaUrls(items) {
                if (!items || !Array.isArray(items)) return [];
                return items.map(item => {
                    // Try video first
                    if (item.video_versions && Array.isArray(item.video_versions) && item.video_versions.length > 0) {
                        return item.video_versions[0].url;
                    }
                    // Try image
                    if (item.image_versions2?.candidates && Array.isArray(item.image_versions2.candidates) && item.image_versions2.candidates.length > 0) {
                        return item.image_versions2.candidates[0].url;
                    }
                    // Alternative image structure
                    if (item.image_versions && Array.isArray(item.image_versions) && item.image_versions.length > 0) {
                        return item.image_versions[0].url;
                    }
                    // Direct URL
                    if (item.display_url) return item.display_url;
                    if (item.url) return item.url;
                    return null;
                }).filter(url => url !== null);
            }
            
            // Try to find window._sharedData
            if (window._sharedData) {
                try {
                    const data = window._sharedData;
                    result.debug.sharedDataKeys = Object.keys(data);
                    
                    // Path 1: entry_data.ProfilePage[0].graphql.user.reel
                    if (data.entry_data?.ProfilePage?.[0]?.graphql?.user?.reel) {
                        const reel = data.entry_data.ProfilePage[0].graphql.user.reel;
                        result.debug.foundReel = true;
                        result.debug.reelKeys = Object.keys(reel);
                        if (reel.items && reel.items.length > 0) {
                            result.storyData = extractMediaUrls(reel.items);
                            if (result.storyData.length > 0) return result;
                        }
                    }
                    
                    // Path 2: entry_data.ProfilePage[0].graphql.user.has_active_stories
                    if (data.entry_data?.ProfilePage?.[0]?.graphql?.user) {
                        const user = data.entry_data.ProfilePage[0].graphql.user;
                        result.debug.userKeys = Object.keys(user);
                        result.debug.hasActiveStories = user.has_active_stories;
                        result.debug.hasHighlightReel = user.has_highlight_reel;
                        
                        // Check if reel exists but items might be empty
                        if (user.reel) {
                            result.debug.reelExists = true;
                            result.debug.reelItemCount = user.reel.items?.length || 0;
                            if (user.reel.items && user.reel.items.length > 0) {
                                result.storyData = extractMediaUrls(user.reel.items);
                                if (result.storyData.length > 0) return result;
                            }
                        }
                    }
                    
                    // Path 3: Look for any reel data in the structure
                    function findReel(obj, path = '') {
                        if (!obj || typeof obj !== 'object') return null;
                        if (Array.isArray(obj)) {
                            for (let i = 0; i < obj.length; i++) {
                                const found = findReel(obj[i], `${path}[${i}]`);
                                if (found) return found;
                            }
                            return null;
                        }
                        if (obj.reel && obj.reel.items && Array.isArray(obj.reel.items) && obj.reel.items.length > 0) {
                            return obj.reel;
                        }
                        for (const key in obj) {
                            if (obj.hasOwnProperty(key)) {
                                const found = findReel(obj[key], path ? `${path}.${key}` : key);
                                if (found) return found;
                            }
                        }
                        return null;
                    }
                    
                    const foundReel = findReel(data);
                    if (foundReel && foundReel.items && foundReel.items.length > 0) {
                        result.storyData = extractMediaUrls(foundReel.items);
                        if (result.storyData.length > 0) {
                            result.debug.foundViaSearch = true;
                            return result;
                        }
                    }
                } catch (e) {
                    result.debug.error = e.message;
                    result.debug.errorStack = e.stack;
                }
            }
            
            // Check foundData from window properties
            if (foundData) {
                result.debug.foundWindowData = foundData.source;
                // Try to extract from this data
                try {
                    const dataStr = JSON.stringify(foundData.data);
                    if (dataStr.includes('reel') || dataStr.includes('items')) {
                        // Try to find items in this data
                        function findItems(obj) {
                            if (Array.isArray(obj)) {
                                if (obj.length > 0 && obj[0].video_versions) return obj;
                                if (obj.length > 0 && obj[0].image_versions2) return obj;
                                for (const item of obj) {
                                    const found = findItems(item);
                                    if (found) return found;
                                }
                            }
                            if (obj && typeof obj === 'object') {
                                if (obj.items && Array.isArray(obj.items) && obj.items.length > 0) {
                                    return obj.items;
                                }
                                for (const key in obj) {
                                    const found = findItems(obj[key]);
                                    if (found) return found;
                                }
                            }
                            return null;
                        }
                        const items = findItems(foundData.data);
                        if (items && items.length > 0) {
                            result.storyData = extractMediaUrls(items);
                            if (result.storyData.length > 0) return result;
                        }
                    }
                } catch (e) {
                    result.debug.windowDataError = e.message;
                }
            }
            
            // Try to find data in script tags
            const scripts = Array.from(document.querySelectorAll('script'));
            result.scripts = scripts.length;
            
            for (const script of scripts) {
                const content = script.textContent || script.innerHTML;
                if (content && (content.includes('_sharedData') || content.includes('"reel"') || content.includes('ProfilePage') || content.includes('has_active_stories'))) {
                    try {
                        // Try multiple regex patterns
                        let match = content.match(/window\._sharedData\s*=\s*({[\s\S]+?});/);
                        if (!match) {
                            match = content.match(/window\._sharedData\s*=\s*({.+?});/s);
                        }
                        if (match) {
                            const data = JSON.parse(match[1]);
                            // Try the same paths as above
                            if (data.entry_data?.ProfilePage?.[0]?.graphql?.user?.reel?.items) {
                                const items = data.entry_data.ProfilePage[0].graphql.user.reel.items;
                                if (items.length > 0) {
                                    result.storyData = extractMediaUrls(items);
                                    if (result.storyData.length > 0) return result;
                                }
                            }
                        }
                    } catch (e) {
                        // Continue to next script
                    }
                }
            }
            
            // Try to find story elements in the DOM
            const storyElements = document.querySelectorAll('[role="button"], a[href*="stories"], div[style*="story"]');
            result.debug.storyElementsFound = storyElements.length;
            
            // Try to click on story ring if it exists (this might trigger data loading)
            const storyRing = document.querySelector('div[role="button"] img, a[href*="/stories/"]');
            if (storyRing) {
                result.debug.storyRingFound = true;
                // Don't actually click, but note it exists
            }
            
            return result;
        });
        
        // If we found a story ring, try to get the story data by navigating to stories URL
        if (pageInfo.debug?.storyRingFound) {
            console.log('Story ring found, trying to access stories directly...');
            try {
                const storiesUrl = `https://www.instagram.com/stories/${username}/`;
                await page.goto(storiesUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Try to extract story data from stories page
                const storiesPageData = await page.evaluate(() => {
                    const result = { storyData: [] };
                    
                    // Look for media elements
                    const videos = Array.from(document.querySelectorAll('video'));
                    const images = Array.from(document.querySelectorAll('img[src*="cdninstagram"]'));
                    
                    videos.forEach(video => {
                        if (video.src && video.src.includes('cdninstagram')) {
                            result.storyData.push(video.src);
                        }
                    });
                    
                    images.forEach(img => {
                        if (img.src && img.src.includes('cdninstagram') && !result.storyData.includes(img.src)) {
                            result.storyData.push(img.src);
                        }
                    });
                    
                    // Also check for data in scripts
                    const scripts = Array.from(document.querySelectorAll('script'));
                    for (const script of scripts) {
                        const content = script.textContent || script.innerHTML;
                        if (content && (content.includes('video_versions') || content.includes('image_versions2'))) {
                            try {
                                const urlMatch = content.match(/https:\/\/[^"'\s]+cdninstagram[^"'\s]+/g);
                                if (urlMatch) {
                                    urlMatch.forEach(url => {
                                        if (!result.storyData.includes(url)) {
                                            result.storyData.push(url);
                                        }
                                    });
                                }
                            } catch (e) {
                                // Continue
                            }
                        }
                    }
                    
                    return result;
                });
                
                if (storiesPageData.storyData && storiesPageData.storyData.length > 0) {
                    console.log(`Found ${storiesPageData.storyData.length} stories from stories page`);
                    await page.close();
                    return res.json({ success: true, media: storiesPageData.storyData });
                }
            } catch (e) {
                console.log('Could not access stories page:', e.message);
            }
        }
        
        console.log('Page info:', JSON.stringify(pageInfo, null, 2));
        
        await page.close();
        page = null;
        
        if (!pageInfo.storyData || pageInfo.storyData.length === 0) {
            const debugMsg = pageInfo.debug ? 
                `Debug: ${JSON.stringify(pageInfo.debug)}` : 
                `hasSharedData=${pageInfo.hasSharedData}, scripts=${pageInfo.scripts}`;
            return res.status(404).json({ 
                success: false, 
                message: `No stories found. ${debugMsg}. The account might not have active stories (stories expire after 24 hours), the profile might be private, or Instagram's structure may have changed.` 
            });
        }

        console.log(`Found ${pageInfo.storyData.length} story items`);
        res.json({ success: true, media: pageInfo.storyData });
        
    } catch (error) {
        if (page) {
            try {
                await page.close();
            } catch (e) {
                // Ignore close errors
            }
        }
        console.error('Error fetching stories:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ 
            success: false, 
            message: error.message || "Couldn't fetch stories. Instagram may require authentication or the profile may not exist." 
        });
    }
});

const server = app.listen(3000, () => console.log('Server vibing on port 3000'));

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(async () => {
        if (browser) {
            await browser.close();
        }
        process.exit(0);
    });
});

process.on('SIGINT', async () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(async () => {
        if (browser) {
            await browser.close();
        }
        process.exit(0);
    });
});