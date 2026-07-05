const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const isVercel = !!process.env.VERCEL;
const JWT_SECRET = process.env.JWT_SECRET || 'mazaohub-cms-super-secret-key-12345';
const dbReadyPromise = db.initDb();

// Ensure uploads directories exist
const tempUploadsDir = isVercel ? path.join('/tmp', 'mazaohub-temp_uploads') : path.join(__dirname, 'temp_uploads');
if (!fs.existsSync(tempUploadsDir)) {
  fs.mkdirSync(tempUploadsDir, { recursive: true });
}
const localUploadsDir = path.join(__dirname, 'public', 'uploads');
if (!isVercel && !fs.existsSync(localUploadsDir)) {
  fs.mkdirSync(localUploadsDir, { recursive: true });
}

// Multer setup for temporary file storage
const upload = multer({ dest: tempUploadsDir });

// Cloudinary setup
const cloudinary = require('cloudinary').v2;
let isCloudinaryConfigured = false;
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  isCloudinaryConfigured = true;
  console.log('Cloudinary storage is configured and enabled.');
}

// Supabase setup
const { createClient } = require('@supabase/supabase-js');
let supabase = null;
let isSupabaseConfigured = false;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  isSupabaseConfigured = true;
  console.log('Supabase Storage is configured and enabled.');
}

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Disable caching on API routes
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

app.use('/api', async (req, res, next) => {
  try {
    await dbReadyPromise;
    next();
  } catch (error) {
    console.error('Database is not ready for request:', error);
    res.status(500).json({ error: 'Server initialization failed.' });
  }
});

// Serve static assets in both local and Vercel environments.
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Middleware
function requireAuth(req, res, next) {
  const token = req.cookies.jwt;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized. No session token found.' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized. Invalid session token.' });
  }
}

// REST APIs

// 1. Auth check
app.get('/api/auth/check', (req, res) => {
  const token = req.cookies.jwt;
  if (!token) {
    return res.json({ authenticated: false });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ authenticated: true, username: decoded.username });
  } catch (err) {
    res.json({ authenticated: false });
  }
});

// 2. Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  try {
    const user = await db.getUser(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    
    const token = jwt.sign({ id: user.id || user._id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    
    res.cookie('jwt', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    res.json({ success: true, username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login.' });
  }
});

// 3. Logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('jwt');
  res.json({ success: true, message: 'Logged out successfully.' });
});

// 4. Get Published (Live) Content
app.get('/api/content', async (req, res) => {
  try {
    const contentMap = await db.getLiveContent();
    res.json(contentMap);
  } catch (err) {
    console.error('Error fetching live content:', err);
    res.status(500).json({ error: 'Database error fetching live content.' });
  }
});

// 5. Get Draft Content (Requires Admin Auth)
app.get('/api/content/draft', requireAuth, async (req, res) => {
  try {
    const contentMap = await db.getDraftContent();
    res.json(contentMap);
  } catch (err) {
    console.error('Error fetching draft content:', err);
    res.status(500).json({ error: 'Database error fetching draft content.' });
  }
});

// 6. Save Draft changes (Requires Admin Auth)
app.post('/api/content/save-draft', requireAuth, async (req, res) => {
  const { changes } = req.body;
  if (!changes || typeof changes !== 'object') {
    return res.status(400).json({ error: 'Invalid changes payload. Expected object.' });
  }
  
  try {
    await db.saveDraft(changes);
    res.json({ success: true, message: 'Draft changes saved successfully.' });
  } catch (err) {
    console.error('Error saving draft:', err);
    res.status(500).json({ error: 'Database error saving draft changes.' });
  }
});

// 7. Publish Content (Copies draft items to live) (Requires Admin Auth)
app.post('/api/content/publish', requireAuth, async (req, res) => {
  try {
    await db.publishDraft();
    res.json({ success: true, message: 'All draft changes published to live successfully.' });
  } catch (err) {
    console.error('Error publishing content:', err);
    res.status(500).json({ error: 'Database error publishing content.' });
  }
});

// 8. Cancel / Discard Changes (Deletes draft rows) (Requires Admin Auth)
app.post('/api/content/discard-draft', requireAuth, async (req, res) => {
  try {
    await db.discardDraft();
    res.json({ success: true, message: 'Draft changes discarded successfully.' });
  } catch (err) {
    console.error('Error discarding draft:', err);
    res.status(500).json({ error: 'Database error discarding changes.' });
  }
});

// 9. Image Upload (Supports Cloudinary, Supabase Storage, and Local Fallback) (Requires Admin Auth)
app.post('/api/upload', requireAuth, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file uploaded.' });
  }
  
  const tempPath = req.file.path;
  const originalName = req.file.originalname;
  const mimeType = req.file.mimetype;
  
  try {
    // Option A: Cloudinary upload
    if (isCloudinaryConfigured) {
      const uploadResult = await cloudinary.uploader.upload(tempPath, {
        folder: 'mazaohub_cms_uploads'
      });
      fs.unlinkSync(tempPath);
      return res.json({ url: uploadResult.secure_url });
    }
    
    // Option B: Supabase Storage upload
    if (isSupabaseConfigured) {
      const fileBuffer = fs.readFileSync(tempPath);
      const bucket = process.env.SUPABASE_BUCKET || 'cms-images';
      const filename = `${Date.now()}-${originalName.replace(/\s+/g, '_')}`;
      
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(filename, fileBuffer, {
          contentType: mimeType,
          upsert: true
        });
      
      fs.unlinkSync(tempPath);
      
      if (error) {
        throw error;
      }
      
      const { data: publicUrlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(filename);
        
      return res.json({ url: publicUrlData.publicUrl });
    }
    
    // Option C: Local fallback storage
    if (isVercel) {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      return res.status(501).json({ error: 'Image uploads on Vercel require Cloudinary or Supabase Storage.' });
    }

    const filename = `${Date.now()}-${originalName.replace(/\s+/g, '_')}`;
    const targetPath = path.join(localUploadsDir, filename);
    
    fs.renameSync(tempPath, targetPath);
    console.log(`Uploaded image fallback to local path: /uploads/${filename}`);
    return res.json({ url: `/uploads/${filename}` });
    
  } catch (err) {
    console.error('Image upload error:', err);
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    res.status(500).json({ error: 'Failed to process image upload.' });
  }
});

// 10. AI Assistant Chat
app.post('/api/chat', async (req, res) => {
  const { message, history } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  const systemInstructions = `You are the official MazaoHub AI Assistant. You are a helpful, professional, and knowledgeable agritech expert.
Here are the details about MazaoHub:
- It is a Tanzanian agritech platform providing climate-smart, data-driven farm management software (SaaS).
- Features: AI-powered agronomy (personalized crop, soil, weather recommendations), farm management, supply chain traceability, credit scoring, and digital payments.
- Team: Geophrey Tenganamba (CEO & Co Founder), Adelard Josephat Urassa (CTO & Co Founder), Rose Bosco Mrosso (Chief Outreach and Extension Officer), Raya Mohamed (Software & Quality Control), Fatuma Chitu (Mobile Engineer & Support), Alexandra Ngaiza (Business and Partnerships Lead), Janeth Sambwe (Administration Manager), Juma Debe (Outreach and Extension Officer), Godfrey Makonge (Agronomist and Crop Expert), Magreth Machinyita (Outreach and Extension Officer), Gabriel Zawadi Magombe (Mobile Developer), Winfrida Apolinary Mariwa (Outreach and Extension Officer), Deograsias Michael Kauki (Outreach and Extension Officer), Levina Anthony Mlumange (Tabora Region Outreach and Extension Officer), Veronica Pius Kabanya (Extension Officer), Joshua Robert Mgalula (Graphic Designer), Jacob John Malambo (Monitoring and Evaluation Lead), Malusu J. Lubuva (Chief Operation and Performance Officer), Raya Nyagawa (Agronomist & Call Center Support), Fadhili Mwanja (Agronomist & Call Center Support), Daudi Nalimi (Agronomist & Call Center Support), Rabia A. Mdoe (Accountant), Mary Charles Mnyeke (Chief CropSupply Officer), JOANES SAMBWE (Marketing Creative), Thomas D. Mkangara (Chief Operation Cropsupply), James O. Kabuka (Head of Technical Support & Trainings).
- Contact: info@mazaohub.com, +255 768 000 000.
- Goal: "We make sure they never farm blind again."
Keep your answers helpful, concise, and focused on MazaoHub's features, team, and services.`;

  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY;
    if (!apiKey) {
      // Fallback response if API key is not configured
      const lower = message.toLowerCase();
      let reply = "I am the MazaoHub AI Assistant. I am currently running in fallback mode because no AI API key is configured. How can I assist you with MazaoHub's smart agriculture platform?";
      if (lower.includes('team') || lower.includes('ceo') || lower.includes('founder') || lower.includes('founder') || lower.includes('geophrey') || lower.includes('josephat')) {
        reply = "Our leadership team includes Geophrey Tenganamba (CEO & Co-founder) and Adelard Josephat Urassa (CTO & Co-founder), alongside crop experts, agronomists, and outreach officers across Tanzania.";
      } else if (lower.includes('features') || lower.includes('what we offer') || lower.includes('services') || lower.includes('offer')) {
        reply = "MazaoHub offers AI-powered agronomy, farm management SaaS, soil analysis, and supply chain traceability to help smallholders and cooperatives turn agricultural guesswork into ground truth.";
      } else if (lower.includes('contact') || lower.includes('email') || lower.includes('phone') || lower.includes('support')) {
        reply = "You can contact MazaoHub via email at info@mazaohub.com or call our team at +255 768 000 000.";
      }
      return res.json({ reply });
    }

    const response = await global.fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${systemInstructions}\n\nUser conversation history: ${JSON.stringify(history)}\n\nUser message: ${message}` }] }
        ]
      })
    });
    
    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I'm sorry, I'm having trouble connecting to my brain right now. Please try again.";
    res.json({ reply });
  } catch (err) {
    console.error('AI chat error:', err);
    res.status(500).json({ error: 'Failed to generate response.' });
  }
});

// Fallback: serve index.html for non-API requests in all environments.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Boot Database and Web Server
dbReadyPromise
  .then(() => {
    if (!isVercel) {
      app.listen(PORT, () => {
        console.log(`MazaoHub CMS Server running locally on http://localhost:${PORT}`);
      });
    }
  })
  .catch(err => {
    console.error('CRITICAL ERROR: Failed to initialize DB connection. Server could not start.', err);
    if (!isVercel) {
      process.exit(1);
    }
  });

module.exports = app;
