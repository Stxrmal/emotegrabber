const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const helmet = require('helmet');

const app = express();

// Security middleware
app.use(helmet({
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false
}));

// CORS configuration for Roblox
app.use(cors({
    origin: '*', // Allow all origins (Roblox requests come from various IPs)
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: false
}));

app.use(express.json({ limit: '10mb' }));

// Rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT = 100; // requests per minute
const RATE_WINDOW = 60000; // 1 minute

function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
        return next();
    }
    
    const userData = rateLimitMap.get(ip);
    if (now > userData.resetTime) {
        userData.count = 1;
        userData.resetTime = now + RATE_WINDOW;
        return next();
    }
    
    if (userData.count >= RATE_LIMIT) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    
    userData.count++;
    next();
}

app.use(rateLimit);

// Comprehensive emote database
const EMOTE_DATABASE = [
    // Official Roblox Emotes (guaranteed to work)
    { id: '507770677', name: 'Salute', category: 'Gesture' },
    { id: '507777268', name: 'Point', category: 'Gesture' },
    { id: '507770451', name: 'Wave', category: 'Gesture' },
    { id: '507771019', name: 'Laugh', category: 'Funny' },
    { id: '507771955', name: 'Dance', category: 'Dance' },
    { id: '507770818', name: 'Cheer', category: 'Action' },
    { id: '507766388', name: 'Stadium', category: 'Action' },
    { id: '507766951', name: 'Confused', category: 'Funny' },
    { id: '507766666', name: 'Applaud', category: 'Gesture' },
    { id: '507767015', name: 'Sit', category: 'Pose' },
    { id: '507769133', name: 'Tilt', category: 'Pose' },
    { id: '507770239', name: 'Disagree', category: 'Gesture' },
    { id: '507771378', name: 'Hello', category: 'Gesture' },
    
    // Popular UGC Emotes (add more as discovered)
    { id: '4841397952', name: 'Griddy', category: 'Dance' },
    { id: '4265162094', name: 'Zombie Walk', category: 'Dance' },
    { id: '4049037604', name: 'Orange Justice', category: 'Dance' },
    { id: '4555782893', name: 'Penguin', category: 'Funny' },
    { id: '4555808220', name: 'Chicken', category: 'Funny' },
    
    // Add more popular emotes here
];

// Cache system
let emoteCache = [];
let lastCacheUpdate = 0;
const CACHE_DURATION = 300000; // 5 minutes

async function validateEmoteFromRoblox(emoteId) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
        
        const response = await fetch(`https://api.roblox.com/marketplace/productinfo?assetId=${emoteId}`, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'EmoteDiscoveryService/1.0'
            }
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        // Check if it's actually an emote (AssetTypeId 61 = EmoteAnimation)
        if (data.AssetTypeId === 61 && data.IsForSale) {
            return {
                id: emoteId,
                name: data.Name || 'Unknown Emote',
                description: data.Description || '',
                price: data.PriceInRobux || 0,
                creatorName: (data.Creator && data.Creator.Name) || 'Roblox',
                creatorType: (data.Creator && data.Creator.CreatorType) || 'Group',
                isForSale: data.IsForSale,
                canResell: data.IsForSale && !data.IsLimited && !data.IsLimitedUnique,
                assetType: data.AssetTypeId,
                lastUpdated: new Date().toISOString()
            };
        }
    } catch (error) {
        console.log(`Failed to validate emote ${emoteId}: ${error.message}`);
    }
    return null;
}

async function refreshEmoteCache() {
    console.log('🔄 Refreshing emote cache...');
    const validEmotes = [];
    
    // Validate emotes in batches to avoid overwhelming the API
    const batchSize = 5;
    for (let i = 0; i < EMOTE_DATABASE.length; i += batchSize) {
        const batch = EMOTE_DATABASE.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (emoteEntry) => {
            const validated = await validateEmoteFromRoblox(emoteEntry.id);
            if (validated) {
                // Add category from our database
                validated.category = emoteEntry.category;
                return validated;
            }
            return null;
        });
        
        const batchResults = await Promise.all(batchPromises);
        validEmotes.push(...batchResults.filter(Boolean));
        
        // Small delay between batches
        if (i + batchSize < EMOTE_DATABASE.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    emoteCache = validEmotes;
    lastCacheUpdate = Date.now();
    
    console.log(`✅ Cache updated with ${validEmotes.length} valid emotes`);
    return validEmotes;
}

// Main API endpoint for Roblox games
app.get('/api/emotes', async (req, res) => {
    try {
        // Set headers for Roblox compatibility
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        
        console.log('📡 Emote request from:', req.get('User-Agent') || 'Unknown');
        
        // Check if cache needs refresh
        if (Date.now() - lastCacheUpdate > CACHE_DURATION || emoteCache.length === 0) {
            console.log('🔄 Refreshing cache...');
            await refreshEmoteCache();
        }
        
        const { category, limit = 50, resellable_only } = req.query;
        let filteredEmotes = [...emoteCache];
        
        // Apply filters
        if (category) {
            filteredEmotes = filteredEmotes.filter(emote => 
                emote.category.toLowerCase() === category.toLowerCase()
            );
        }
        
        if (resellable_only === 'true') {
            filteredEmotes = filteredEmotes.filter(emote => emote.canResell);
        }
        
        // Limit results
        if (limit) {
            filteredEmotes = filteredEmotes.slice(0, parseInt(limit));
        }
        
        console.log(`📤 Returning ${filteredEmotes.length} emotes to client`);
        
        res.json({
            success: true,
            emotes: filteredEmotes,
            total: filteredEmotes.length,
            cached: emoteCache.length,
            lastUpdated: new Date(lastCacheUpdate).toISOString(),
            filters_applied: { category, limit, resellable_only }
        });
        
    } catch (error) {
        console.error('❌ Error in /api/emotes:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            emotes: [],
            message: 'Service temporarily unavailable'
        });
    }
});

// Submit new emote endpoint
app.post('/api/submit-emote', async (req, res) => {
    try {
        const { emoteId, submittedBy = 'Anonymous', category = 'Action' } = req.body;
        
        if (!emoteId || !/^\d+$/.test(emoteId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Valid emote ID required' 
            });
        }
        
        // Check if already in database
        const exists = EMOTE_DATABASE.find(e => e.id === emoteId);
        if (exists) {
            return res.json({ 
                success: true, 
                message: 'Emote already in database',
                emote: exists
            });
        }
        
        // Validate the emote
        const validatedEmote = await validateEmoteFromRoblox(emoteId);
        if (validatedEmote) {
            // Add to database
            EMOTE_DATABASE.push({ 
                id: emoteId, 
                name: validatedEmote.name, 
                category: category 
            });
            
            // Add to cache
            validatedEmote.category = category;
            emoteCache.push(validatedEmote);
            
            console.log(`✨ New emote added: ${validatedEmote.name} (${emoteId}) by ${submittedBy}`);
            
            res.json({ 
                success: true, 
                emote: validatedEmote,
                message: 'Emote added successfully'
            });
        } else {
            res.status(400).json({ 
                success: false, 
                error: 'Invalid emote ID or not for sale' 
            });
        }
        
    } catch (error) {
        console.error('Error in /api/submit-emote:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        emote_count: emoteCache.length,
        database_size: EMOTE_DATABASE.length,
        last_cache_update: new Date(lastCacheUpdate).toISOString(),
        version: '1.0.0'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        service: 'Roblox Emote Discovery API',
        version: '1.0.0',
        endpoints: {
            'GET /api/emotes': 'Get all emotes with optional filters',
            'POST /api/submit-emote': 'Submit a new emote ID',
            'GET /health': 'Health check'
        },
        filters: {
            category: 'Filter by category (Dance, Gesture, Pose, Action, Funny)',
            limit: 'Limit number of results',
            resellable_only: 'true/false - only show resellable emotes'
        }
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`🚀 Emote Discovery Service running on port ${PORT}`);
    console.log(`📊 Database contains ${EMOTE_DATABASE.length} emote entries`);
    
    // Initial cache load
    try {
        await refreshEmoteCache();
        console.log(`✅ Service ready with ${emoteCache.length} validated emotes`);
    } catch (error) {
        console.error('❌ Error during initial cache load:', error);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 Service shutting down gracefully');
    process.exit(0);
});

module.exports = app;
