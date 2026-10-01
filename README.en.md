<div align="center">

  <img src="public/Screen/banner.jpg" alt="SpatialPosters Banner" width="100%" style="border-radius: 14px; margin-bottom: 20px; box-shadow: 0 20px 50px rgba(0,0,0,0.6);" />

  <h1>SpatialPosters</h1>
  <p><b>Next-Generation Dynamic Poster Studio & Stremio Artwork Engine</b></p>
  <p>Created by <a href="https://instagram.com/TheAceOfficials"><b>@TheAceOfficials</b></a></p>

  <p align="center">
    <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FTheAceOfficials%2FSpatialPosters"><img src="https://vercel.com/button" alt="Deploy with Vercel" /></a>
    <a href="#-docker--docker-compose-setup"><img src="https://img.shields.io/badge/Docker-Supported-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" /></a>
    <a href="https://patreon.com/theaceofficials"><img src="https://img.shields.io/badge/Patreon-Support-FF424D?style=flat-square&logo=patreon&logoColor=white" alt="Support on Patreon" /></a>
    <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js&logoColor=white" alt="Next.js 16" />
    <img src="https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Engine-Sharp%20C%2B%2B-green?style=flat-square" alt="Sharp Engine" />
    <img src="https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square" alt="License AGPLv3" />
  </p>

</div>

---

## 📖 Overview

**SpatialPosters** is an advanced, ultra-high-performance artwork engine and dynamic poster generator built for **Stremio**, **Jellyfin**, **Plex**, **Emby**, and cinephiles worldwide. 

It transforms ordinary poster thumbnails into stunning, studio-grade cinematic artwork in real-time. By compositing textless high-resolution posters with vector title logos, multi-provider rating badges, 4K streaming quality indicators, award ribbons, and computer-vision focal placement, SpatialPosters delivers a native, state-of-the-art media experience across all your devices.

---

## 📱 Application Interface Showcase

Explore the intuitive, liquid-glass visual interface designed for effortless poster customization and catalog management.

<div align="center">
  <img src="public/Screen/interface1..jpg" alt="3D Poster Deck Showcase" width="100%" style="border-radius: 12px; margin-bottom: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.5);" />
  <p><em>✨ <b>3D Poster Deck & Collection Showcase</b> — Interactive Apple TV & Netflix-style 3D poster decks for previewing saved media items.</em></p>
</div>

<br />

<div align="center">
  <img src="public/Screen/interface2.jpg" alt="My Posters Library & Catalog Manager" width="100%" style="border-radius: 12px; margin-bottom: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.5);" />
  <p><em>📚 <b>My Posters Library & Catalog Manager</b> — Organise your saved poster collection, manage custom catalogs, and browse media items in high resolution.</em></p>
</div>

<br />

<div align="center">
  <img src="public/Screen/interface3.jpg" alt="WYSIWYG Live Poster Studio Workspace" width="100%" style="border-radius: 12px; margin-bottom: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.5);" />
  <p><em>🎨 <b>WYSIWYG Live Poster Studio Workspace</b> — Live 3-Column desktop workspace featuring vector title logo selection, real-time preview, badge styling, and fine-tuning controls.</em></p>
</div>

---

## 🖼️ Poster Output Showcase

Here are actual real-time poster compositions generated on demand by the SpatialPosters Sharp C++ vector engine:

<div align="center">
  <img src="public/Screen/poster1.jpg" alt="Poster Output 1" width="19%" style="border-radius: 8px; margin: 0 0.5%; box-shadow: 0 8px 24px rgba(0,0,0,0.4);" />
  <img src="public/Screen/poster2.jpg" alt="Poster Output 2" width="19%" style="border-radius: 8px; margin: 0 0.5%; box-shadow: 0 8px 24px rgba(0,0,0,0.4);" />
  <img src="public/Screen/poster3.jpg" alt="Poster Output 3" width="19%" style="border-radius: 8px; margin: 0 0.5%; box-shadow: 0 8px 24px rgba(0,0,0,0.4);" />
  <img src="public/Screen/poster4.jpg" alt="Poster Output 4" width="19%" style="border-radius: 8px; margin: 0 0.5%; box-shadow: 0 8px 24px rgba(0,0,0,0.4);" />
  <img src="public/Screen/poster5.jpg" alt="Poster Output 5" width="19%" style="border-radius: 8px; margin: 0 0.5%; box-shadow: 0 8px 24px rgba(0,0,0,0.4);" />
</div>

<br />

<p align="center"><b>✨ Key Composition Features:</b> Pristine textless graphics • Vector studio logos • Multi-provider ratings • 4K streaming indicators • Award ribbons • Auto accent color detection</p>

---

## 🔥 Key Features & Capabilities

### 🔄 24-Hour Auto-Rotation Dynamic Posters
* **Daily Refresh Engine**: Automatically cycles clean alternative artwork for movies and TV series every 24 hours, ensuring your media library stays fresh and dynamic.
* **Deterministic Seed Selection**: Ensures smooth, consistent rotation across devices without duplicate image flashes.

### 🎨 Auto-Detect Accent & Top Edge Colors
* **Pixel Color Analyzer**: Analyzes poster image pixels using HTML5 Canvas & C++ color extraction algorithms.
* **Dynamic Theme Integration**: Automatically computes the dominant accent color and top edge tint to colorize badge styles, bottom gradients, and ambient UI lighting.

### 🏷️ 6 Customizable Badge Styles
* **Liquid Glass (`vetro`)**: Glossy backdrop-blur glassmorphic pill badge with subtle inner highlights.
* **Bordered (`bordo`)**: Sleek dark card container with delicate border accents.
* **Bar (`bar`)**: Top horizontal accent bar styling.
* **Pill (`pill`)**: Ultra-clean rounded capsule badge.
* **Shadow (`shadow`)**: Deep ambient dark glow backdrop.
* **Colored (`colored`)**: Vibrant solid/gradient background matching the poster's dominant color palette.

### 🌟 4K Quality & Audio Indicators
* **Streaming Quality Badges**: Live indicators for **4K UHD**, **1080p Full HD**, **720p**, **HDR10+**, **Dolby Vision**, **Dolby Atmos**, **DTS-X**, and **IMAX Enhanced**.
* **Automatic Quality Matching**: Dynamically attaches media specs directly onto poster artwork.

### ⭐ Multi-Provider Ratings & Top 10 Ribbons
* **Aggregated Scores**: Combines live scores from **IMDb**, **TMDB**, **MDBList**, **Rotten Tomatoes**, **Letterboxd**, **MyAnimeList**, and **Simkl**.
* **Prestige Award Badges**: Oscar Winner, Cannes Palme d'Or, Emmy, and BAFTA award indicators.
* **Vertical Top 10 Ribbons**: Official vertical ranking ribbons for **Netflix Top 10**, **Prime Video**, **Disney+**, **Apple TV+**, **HBO Max**, and **FlixPatrol**.

### 🎬 Vector Studio Logos & Computer-Vision Auto-Fit
* **10,000+ Vector Logos**: Access crystal-clear SVG logos for major studios and networks.
* **Focal Area Detection**: Smart computer-vision algorithms analyze focal zones (such as actors' faces) to automatically position and scale title logos without obscuring key visual elements.

### 🌐 Universal Custom Poster URL Import
* **Limitless Artwork Sourcing**: Easily import custom poster artwork from **Pinterest**, **Reddit**, **ThePosterDB (TPDB)**, **Imgur**, or any direct web image link.
* **Instant Studio Compositing**: Paste any custom poster URL directly into the studio workspace—SpatialPosters instantly applies vector logos, 4K resolution badges, and rating overlays onto your custom artwork in real-time.

### 📺 Smart Season & Anime Unpacker
* **Multi-Part Series Detection**: Automatically groups multi-part series (e.g. *Money Heist*, *Lupin*) into their intended watch order.
* **Anime Mega-Season Unpacker**: Unpacks collapsed TMDB mega-seasons (e.g. *Jujutsu Kaisen*, *Re:ZERO*) into distinct seasonal story arcs.

### ⚡ Multi-Cloud Storage & High-Speed Caching
* **Cloudinary Storage Provider**: Instant 25GB free tier hosting with automatic WebP/AVIF format optimization and direct CDN URL generation.
* **ImgBB Hosting**: 100% free image hosting integration with zero credit card requirements.
* **Cloudflare R2**: 10GB free tier S3-compatible persistent storage cache, reducing server CPU usage on Vercel by up to 95%.
* **Upstash Redis KV**: Ultra-fast key-value cache for poster mappings and configuration tokens.

---

## 🛠️ Setup & Installation Guide

### Prerequisites
* **Node.js**: v18.0.0 or higher (v20+ recommended)
* **npm** / **pnpm** / **yarn**
* **TMDB API Key (v3)**: Get a free key from [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)

---

### 💻 Local Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/TheAceOfficials/SpatialPosters.git
   cd SpatialPosters
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   ```bash
   cp .env.example .env.local
   ```
   Open `.env.local` and enter your TMDB API key:
   ```env
   SPATIALPOSTERS_TMDB_KEY=your_tmdb_v3_api_key
   SPATIALPOSTERS_PUBLIC_INSTANCE=1
   ```

4. **Start the development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### 🐳 Docker & Docker Compose Setup

Run SpatialPosters as a lightweight, isolated container using Docker:

#### Using Docker Compose (Recommended)
```bash
docker compose up -d
```

#### Using Docker CLI
```bash
docker run -d \
  --name spatialposters \
  -p 3000:3000 \
  -e SPATIALPOSTERS_TMDB_KEY="your_tmdb_v3_api_key" \
  -e SPATIALPOSTERS_PUBLIC_INSTANCE=1 \
  -v spatialposters_data:/data \
  --restart unless-stopped \
  theaceofficials/spatialposters:latest
```

---

### ☁️ 1-Click Cloud Deployment

#### Deploy to Vercel (Best Free Recommended Setup)
1. Click the **Deploy with Vercel** button above or import your repository on [vercel.com](https://vercel.com).
2. Connect **Upstash Redis** storage via Vercel Integrations (Free Tier) for lightning-fast configuration caching.
3. Add the following **100% Free Optimized** Environment Variables:
   * `SPATIALPOSTERS_TMDB_KEY` = *your TMDB v3 API key*
   * `SPATIALPOSTERS_PUBLIC_INSTANCE` = `1`
   * `CLOUDINARY_CLOUD_NAME` = *your Cloudinary Cloud Name (Free 25GB Tier)*
   * `CLOUDINARY_API_KEY` = *your Cloudinary API Key*
   * `CLOUDINARY_API_SECRET` = *your Cloudinary API Secret*

#### Deploy to Render / HuggingFace Spaces
Deploy using the included `Dockerfile` on any Docker-compatible hosting platform.

---

## ⚙️ Environment Variables Reference

Below is the complete reference of environment variables supported by SpatialPosters:

### 🌟 Recommended Cloud Storage Setup

> [!TIP]
> **Cloudinary vs ImgBB Recommendation**:
> We strongly recommend setting up **Cloudinary** (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`). 
> - **Why Cloudinary?**: Offers a generous 25GB free tier, automatic WebP/AVIF next-gen format compression, instant global CDN delivery, and reduces Vercel CPU execution time to zero for cached posters.
> - **ImgBB**: Ideal as a 100% free alternative with no credit card required (`IMGBB_API_KEY`).
> - **Cloudflare R2**: Ideal for S3-compatible persistent cache storage (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`).

| Variable Name | Type | Description | Default / Example |
| :--- | :--- | :--- | :--- |
| **`SPATIALPOSTERS_TMDB_KEY`** | Optional | Fallback TMDB v3 API key for single-user instance | `your_tmdb_v3_key` |
| **`SPATIALPOSTERS_MDBLIST_KEY`** | Optional | MDBList API key for aggregated rating scores | `your_mdblist_key` |
| **`SPATIALPOSTERS_TVDB_API_KEY`** | Optional | TVDB API key for TV show season orderings | `your_tvdb_key` |
| **`CLOUDINARY_CLOUD_NAME`** | Recommended | Cloudinary Cloud Name for persistent CDN uploads | `your_cloud_name` |
| **`CLOUDINARY_API_KEY`** | Recommended | Cloudinary API Key | `your_api_key` |
| **`CLOUDINARY_API_SECRET`** | Recommended | Cloudinary API Secret | `your_api_secret` |
| **`CLOUDINARY_URL`** | Alternative | Alternative single string format for Cloudinary | `cloudinary://key:secret@cloudname` |
| **`IMGBB_API_KEY`** | Optional | ImgBB API key for free image hosting | `your_imgbb_api_key` |
| **`R2_ACCOUNT_ID`** | Optional | Cloudflare R2 Account ID for S3 persistent cache | `your_cloudflare_account_id` |
| **`R2_ACCESS_KEY_ID`** | Optional | Cloudflare R2 Access Key ID | `your_r2_access_key_id` |
| **`R2_SECRET_ACCESS_KEY`** | Optional | Cloudflare R2 Secret Access Key | `your_r2_secret_access_key` |
| **`R2_BUCKET_NAME`** | Optional | Cloudflare R2 Bucket Name | `spatialposters` |
| **`KV_REST_API_URL`** | Optional | Upstash Redis REST API URL for KV store | `https://xxx.upstash.io` |
| **`KV_REST_API_TOKEN`** | Optional | Upstash Redis REST API Token | `your_upstash_token` |
| **`SPATIALPOSTERS_ADMIN_PIN`** | Optional | Set Admin Password/PIN to lock instance settings (only owner can modify) | `mysecret2026` |
| **`SPATIALPOSTERS_PUBLIC_INSTANCE`** | Optional | Set to `1` to enable public multi-user instance mode | `1` |
| **`SPATIALPOSTERS_ADMIN_TOKEN`** | Optional | Secret PIN/Token for protecting admin API routes | `supersecret` |
| **`SPATIALPOSTERS_DATA_DIR`** | Optional | Path to local persistent data storage directory | `/data` |

---

### 🛡️ Admin Password Protection (`SPATIALPOSTERS_ADMIN_PIN`)

SpatialPosters features owner-only password protection to prevent unauthorized users from tampering with your self-hosted instance's settings.

> [!NOTE]
> **How Password Protection Works:**
> - **Default Unlocked Mode (No Env Set)**: If `SPATIALPOSTERS_ADMIN_PIN` (or `SPATIALPOSTERS_SITE_PASSWORD`) is **not set**, SpatialPosters runs completely open and unlocked. First-time visitors will **never** be prompted for a password or PIN setup.
> - **Owner Controlled Protection (Env Set)**: To lock your studio workspace, set `SPATIALPOSTERS_ADMIN_PIN=your_secret_password` in your Vercel / server environment variables. Only you as the instance owner control access—no visitor can ever overwrite or set a random PIN!
> - **Session Persistence**: Entering the correct password grants a secure **30-day session cookie**, saving you from re-entering your password on every visit.

---

## 📺 Ecosystem Integration Guide

### 1️⃣ Stremio Addon Integration
1. Open SpatialPosters and configure your desired default poster styling in **Settings**.
2. Click **Install Hub** or copy your manifest URL:
   ```text
   https://<your-domain>/c/<config_token>/manifest.json
   ```
3. Paste the URL into **Stremio** search bar to install SpatialPosters as an active catalog & artwork provider.

### 2️⃣ Jellyfin & Plex Media Server Integration
SpatialPosters exposes direct image endpoints that can be integrated into Jellyfin, Plex, or Emby:
```text
https://<your-domain>/api/poster/movie/<tmdbId>
https://<your-domain>/api/poster/tv/<tmdbId>
```
* **Jellyfin**: Edit Metadata ➔ Images ➔ Enter the poster API URL or saved Cloudinary image URL.
* **Plex**: Edit Poster ➔ Enter custom URL.

---

## 💖 Support & Sponsorship

**SpatialPosters** is built with passion and provided 100% free and open-source under the AGPLv3 license. 

If you love using SpatialPosters or want to support future open-source projects created by **@TheAceOfficials**, consider backing on **Patreon**:

<div align="center">
  <br />
  <a href="https://patreon.com/theaceofficials">
    <img src="https://img.shields.io/badge/Patreon-Support_@TheAceOfficials-FF424D?style=for-the-badge&logo=patreon&logoColor=white" alt="Support on Patreon" height="44" />
  </a>
  <br /><br />
</div>

### 🌟 Membership Tiers
* ☕ **Coffee Supporter ($3/mo)**: Supporter credit in GitHub README & App UI + Early dev updates.
* 🔥 **Priority Feature Requester ($5/mo)**: Fast-track feature requests & shape future project roadmaps.
* 👑 **Supporter Hall of Fame ($10/mo)**: Official Sponsor Logo/Link credit across all @TheAceOfficials projects.

---

## 📄 License

This project is licensed under the **AGPLv3 License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <p>Crafted with ❤️ by <a href="https://instagram.com/TheAceOfficials"><b>@TheAceOfficials</b></a></p>
  <p><b>SpatialPosters — Elevate your Media Experience</b></p>
</div>
