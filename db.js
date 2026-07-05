const { Pool } = require('pg');
const { MongoClient } = require('mongodb');
require('dotenv').config();

function isLocalMongoUri(uri) {
  if (!uri) {
    return false;
  }

  return uri.includes('127.0.0.1') || uri.includes('localhost');
}

function getEffectiveConnectionString() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  if (process.env.VERCEL && isLocalMongoUri(process.env.MONGODB_URI)) {
    console.warn('Ignoring local MongoDB URI in Vercel environment.');
    return null;
  }

  return process.env.MONGODB_URI;
}

// Determine database type based on environment variables
const connectionString = getEffectiveConnectionString();
let dbType = 'postgres'; // default
let pool = null;
let mongoClient = null;
let mongoDb = null;
let memoryState = null;
let initPromise = null;

if (connectionString && (connectionString.startsWith('mongodb://') || connectionString.startsWith('mongodb+srv://'))) {
  dbType = 'mongodb';
} else if (process.env.VERCEL && !connectionString) {
  dbType = 'memory';
} else if (!connectionString) {
  // If neither is specified, we default to local MongoDB (as it is running on the host system)
  dbType = 'mongodb';
}

console.log(`CMS Database Layer initialized with driver: [${dbType.toUpperCase()}]`);

async function initializeMemoryState() {
  const bcrypt = require('bcryptjs');
  const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = await bcrypt.hash(defaultPassword, 10);

  memoryState = {
    users: [
      {
        id: 'memory-admin',
        username: 'admin',
        password_hash: hash,
        created_at: new Date()
      }
    ],
    content: {}
  };

  dbType = 'memory';
  console.log('CMS Database Layer initialized with in-memory fallback storage.');
}

// Initialize Database Connections & Tables/Collections
async function performInit() {
  if (dbType === 'memory') {
    await initializeMemoryState();
    return;
  }

  try {
    if (dbType === 'postgres') {
      const url = process.env.DATABASE_URL || 'postgres://localhost:5432/mazaohub';
      pool = new Pool({
        connectionString: url,
        ssl: url.includes('neon.tech') || url.includes('supabase.co')
          ? { rejectUnauthorized: false }
          : false
      });

      const client = await pool.connect();
      try {
        console.log('Initializing PostgreSQL tables...');

        // Create users table
        await client.query(`
          CREATE TABLE IF NOT EXISTS cms_users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);

        // Create content table
        await client.query(`
          CREATE TABLE IF NOT EXISTS cms_content (
            key VARCHAR(255) NOT NULL,
            value TEXT NOT NULL,
            type VARCHAR(50) DEFAULT 'text',
            version VARCHAR(20) NOT NULL,
            PRIMARY KEY (key, version)
          );
        `);

        // Check user seed
        const userCountResult = await client.query('SELECT COUNT(*) FROM cms_users');
        const userCount = parseInt(userCountResult.rows[0].count, 10);

        if (userCount === 0) {
          const bcrypt = require('bcryptjs');
          const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
          const hash = await bcrypt.hash(defaultPassword, 10);

          await client.query(
            'INSERT INTO cms_users (username, password_hash) VALUES ($1, $2)',
            ['admin', hash]
          );

          console.log('================================================================');
          console.log('  CMS DATABASE SEEDED SUCCESSFULLY');
          console.log('  Created default admin user:');
          console.log('  Username: admin');
          console.log(`  Password: ${defaultPassword}`);
          console.log('================================================================');
        }
      } finally {
        client.release();
      }
    } else {
      // MongoDB Initialization
      const url = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
      console.log(`Connecting to MongoDB at: ${url}...`);
      mongoClient = new MongoClient(url);
      await mongoClient.connect();
      mongoDb = mongoClient.db('mazaohub_cms');

      // Create unique index for content keys
      await mongoDb.collection('cms_content').createIndex({ key: 1, version: 1 }, { unique: true });
      await mongoDb.collection('cms_users').createIndex({ username: 1 }, { unique: true });

      // Seed admin user
      const usersCol = mongoDb.collection('cms_users');
      const userCount = await usersCol.countDocuments({});

      if (userCount === 0) {
        const bcrypt = require('bcryptjs');
        const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
        const hash = await bcrypt.hash(defaultPassword, 10);

        await usersCol.insertOne({
          username: 'admin',
          password_hash: hash,
          created_at: new Date()
        });

        console.log('================================================================');
        console.log('  CMS DATABASE SEEDED SUCCESSFULLY');
        console.log('  Created default admin user:');
        console.log('  Username: admin');
        console.log(`  Password: ${defaultPassword}`);
        console.log('================================================================');
      }
    }
  } catch (error) {
    console.error('Database initialization failed. Falling back to in-memory storage.', error);
    await initializeMemoryState();
    return;
  }
}

function initDb() {
  if (!initPromise) {
    initPromise = performInit();
  }

  return initPromise;
}

// DB-agnostic operations

async function getUser(username) {
  if (dbType === 'memory') {
    return memoryState.users.find(user => user.username === username) || null;
  }

  if (dbType === 'postgres') {
    const result = await pool.query('SELECT * FROM cms_users WHERE username = $1', [username]);
    if (result.rows.length > 0) {
      return result.rows[0];
    }
    return null;
  } else {
    const user = await mongoDb.collection('cms_users').findOne({ username });
    if (user) {
      return {
        id: user._id.toString(),
        username: user.username,
        password_hash: user.password_hash
      };
    }
    return null;
  }
}

async function getLiveContent() {
  if (dbType === 'memory') {
    const contentMap = {};
    Object.values(memoryState.content).forEach(item => {
      if (item.version === 'live') {
        contentMap[item.key] = { value: item.value, type: item.type };
      }
    });
    return contentMap;
  }

  if (dbType === 'postgres') {
    const result = await pool.query("SELECT key, value, type FROM cms_content WHERE version = 'live'");
    const contentMap = {};
    result.rows.forEach(row => {
      contentMap[row.key] = { value: row.value, type: row.type };
    });
    return contentMap;
  } else {
    const items = await mongoDb.collection('cms_content').find({ version: 'live' }).toArray();
    const contentMap = {};
    items.forEach(item => {
      contentMap[item.key] = { value: item.value, type: item.type };
    });
    return contentMap;
  }
}

async function getDraftContent() {
  if (dbType === 'memory') {
    const contentMap = {};

    Object.values(memoryState.content).forEach(item => {
      if (item.version === 'live') {
        contentMap[item.key] = { value: item.value, type: item.type };
      }
    });

    Object.values(memoryState.content).forEach(item => {
      if (item.version === 'draft') {
        contentMap[item.key] = { value: item.value, type: item.type };
      }
    });

    return contentMap;
  }

  if (dbType === 'postgres') {
    const result = await pool.query('SELECT key, value, type, version FROM cms_content');
    const contentMap = {};
    
    // First apply live values
    result.rows.forEach(row => {
      if (row.version === 'live') {
        contentMap[row.key] = { value: row.value, type: row.type };
      }
    });
    
    // Then override with draft values
    result.rows.forEach(row => {
      if (row.version === 'draft') {
        contentMap[row.key] = { value: row.value, type: row.type };
      }
    });
    return contentMap;
  } else {
    const items = await mongoDb.collection('cms_content').find({}).toArray();
    const contentMap = {};
    
    // Apply live values
    items.filter(i => i.version === 'live').forEach(item => {
      contentMap[item.key] = { value: item.value, type: item.type };
    });
    
    // Override with draft values
    items.filter(i => i.version === 'draft').forEach(item => {
      contentMap[item.key] = { value: item.value, type: item.type };
    });
    return contentMap;
  }
}

async function saveDraft(changes) {
  if (dbType === 'memory') {
    for (const [key, item] of Object.entries(changes)) {
      const compositeKey = `${key}:draft`;
      memoryState.content[compositeKey] = {
        key,
        value: item.value,
        type: item.type,
        version: 'draft'
      };
    }
    return;
  }

  if (dbType === 'postgres') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, item] of Object.entries(changes)) {
        await client.query(
          `INSERT INTO cms_content (key, value, type, version)
           VALUES ($1, $2, $3, 'draft')
           ON CONFLICT (key, version)
           DO UPDATE SET value = EXCLUDED.value, type = EXCLUDED.type`,
          [key, item.value, item.type]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else {
    const col = mongoDb.collection('cms_content');
    for (const [key, item] of Object.entries(changes)) {
      await col.updateOne(
        { key, version: 'draft' },
        { $set: { value: item.value, type: item.type } },
        { upsert: true }
      );
    }
  }
}

async function publishDraft() {
  if (dbType === 'memory') {
    Object.values(memoryState.content).forEach(item => {
      if (item.version === 'draft') {
        const liveKey = `${item.key}:live`;
        memoryState.content[liveKey] = {
          key: item.key,
          value: item.value,
          type: item.type,
          version: 'live'
        };
      }
    });
    return;
  }

  if (dbType === 'postgres') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const draftItems = await client.query("SELECT key, value, type FROM cms_content WHERE version = 'draft'");
      
      for (const row of draftItems.rows) {
        await client.query(
          `INSERT INTO cms_content (key, value, type, version)
           VALUES ($1, $2, $3, 'live')
           ON CONFLICT (key, version)
           DO UPDATE SET value = EXCLUDED.value, type = EXCLUDED.type`,
          [row.key, row.value, row.type]
        );
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else {
    const col = mongoDb.collection('cms_content');
    const drafts = await col.find({ version: 'draft' }).toArray();
    for (const d of drafts) {
      await col.updateOne(
        { key: d.key, version: 'live' },
        { $set: { value: d.value, type: d.type } },
        { upsert: true }
      );
    }
  }
}

async function discardDraft() {
  if (dbType === 'memory') {
    Object.keys(memoryState.content).forEach(compositeKey => {
      if (memoryState.content[compositeKey].version === 'draft') {
        delete memoryState.content[compositeKey];
      }
    });
    return;
  }

  if (dbType === 'postgres') {
    await pool.query("DELETE FROM cms_content WHERE version = 'draft'");
  } else {
    await mongoDb.collection('cms_content').deleteMany({ version: 'draft' });
  }
}

module.exports = {
  initDb,
  getUser,
  getLiveContent,
  getDraftContent,
  saveDraft,
  publishDraft,
  discardDraft
};
