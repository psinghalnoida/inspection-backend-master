const Redis = require('ioredis');
require('dotenv').config();

// Support both REDIS_PUBLIC_URL (Railway) and individual config variables
let connection = null;

if (process.env.REDIS_PUBLIC_URL) {
    // Railway provides REDIS_PUBLIC_URL - use it directly
    connection = new Redis(process.env.REDIS_PUBLIC_URL, {
        maxRetriesPerRequest: null, // Required for BullMQ
        retryStrategy: (times) => {
            if (times > 3) return null; // Stop retrying after 3 attempts
            return Math.min(times * 100, 3000);
        },
    });
} else if (process.env.REDIS_HOST) {
    // Only connect if REDIS_HOST is explicitly set
    const redisConfig = {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
        retryStrategy: (times) => {
            if (times > 3) return null;
            return Math.min(times * 100, 3000);
        },
    };
    connection = new Redis(redisConfig);
} else {
    // No Redis configured - skip for local development
    console.log('⚠️ Redis not configured - running without Redis (local development mode)');
}

if (connection) {
    connection.on('connect', () => {
        console.log('✅ Redis connected');
    });

    connection.on('error', (err) => {
        console.error('❌ Redis connection error:', err.message);
    });
}

module.exports = connection;
