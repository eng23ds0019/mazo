# MazaoHub Visual CMS Website

A production-ready, visual, inline-editable CMS wrapper for the client-approved MazaoHub Single Page Application (SPA). This implementation converts the static HTML site into an interactive page builder interface (similar to Webflow, Wix Editor, or Elementor) after logging in, while maintaining a pixel-perfect matching style for public visitors.

---

## Features

- **Inline WYSIWYG Editing:** Click directly on text node containers (titles, paragraphs, lists, badges) to type and edit.
- **Header & Footer Customization:** Nav links, CTA button text, and footer elements are fully editable sections.
- **Image Uploader Fallback:** Click any image or element background image to swap it. Auto-uploads to Cloudinary or Supabase Storage. Falls back to local directory uploads if cloud credentials are not supplied.
- **Repeatable Card Controls:** Hover card elements inside grids to `Duplicate`, `Delete`, or `Reorder` items dynamically.
- **Button Settings:** Configure text, link target (e.g. open in new tab), and visual visibility options.
- **Undo / Redo Stack:** Built-in history state manager to easily revert or re-apply layout content edits.
- **Draft & Publish Lifecycle:** Save drafts in the background using auto-save, cancel modifications, and publish directly to the live database.
- **Cache Busting Security:** Employs timestamp queries and API level Cache-Control headers to ensure draft canceling refreshes are instant and never cached.
- **Dual-Database Drivers:** Fully compatible with PostgreSQL (Neon) and MongoDB (local fallback). Autodetects connection URIs and auto-seeds the admin.

---

## Tech Stack

- **Frontend:** Vanilla HTML5 / ES6 Javascript / CSS3
- **Backend:** Node.js / Express.js / REST APIs
- **Database:** PostgreSQL (Neon) / MongoDB (Homebrew/Atlas)
- **Image Storage:** Cloudinary / Supabase Storage / Local Uploads Directory

---

## Local Setup

### 1. Prerequisite
Ensure Node.js and either MongoDB or PostgreSQL are running on your host machine.

### 2. Dependencies
Clone and install npm packages:
```bash
npm install
```

### 3. Environment Config
Create a `.env` file in the project root:
```ini
PORT=3000
JWT_SECRET=YOUR_SECURE_JWT_SECRET
ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD_GOES_HERE

# Database URI (Auto-detects Postgres or Mongo)
# E.g. MONGODB_URI=mongodb://127.0.0.1:27017/mazaohub_cms
# E.g. DATABASE_URL=postgres://user:password@host:5432/dbname
MONGODB_URI=mongodb://127.0.0.1:27017/mazaohub_cms

# Optional Cloud Storage settings (otherwise uploads locally to /uploads)
CLOUDINARY_CLOUD_NAME=your_cloudinary_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### 4. Run Server
Launch the application:
```bash
npm start
```
The database will automatically seed a default admin user on startup if the collection/table is empty.
- **URL:** `http://localhost:3000/`
- **Default Username:** `admin`
- **Default Password:** `admin123` (or the `ADMIN_PASSWORD` defined in `.env`)
