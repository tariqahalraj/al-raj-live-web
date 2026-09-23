# Tariqah al-Raj Live — Web Client

Dedicated web repository for **Tariqah al-Raj Live Audio Platform**, configured for automated deployment on **GitHub Pages**.

---

## 🚀 Quick Start: Deploy to GitHub Pages (3 Steps)

### Step 1: Create a new repository on GitHub
1. Go to [GitHub New Repository](https://github.com/new).
2. Set repository name (e.g. `al-raj-live-web`).
3. Choose **Public** (or Private if you have a GitHub Pro/Team plan for Pages).
4. Do **not** initialize with README or .gitignore (this project already has them).
5. Click **Create repository**.

### Step 2: Push this folder to your new GitHub repository
Run these commands in your terminal:

```bash
cd "/home/imaginer04/al-Raj Live/al-raj-live-web"
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/al-raj-live-web.git
git push -u origin main
```
*(Replace `<YOUR_GITHUB_USERNAME>` with your GitHub username).*

### Step 3: Enable GitHub Pages in Repository Settings
1. On GitHub, navigate to your repository.
2. Click **Settings** (top tab) → **Pages** (in the left sidebar).
3. Under **Build and deployment** → **Source**, select:
   👉 **GitHub Actions**
4. The automated workflow `.github/workflows/deploy.yml` will now build and publish your web app automatically!
5. In 1–2 minutes, your live site URL will be displayed at the top of the Pages settings (e.g. `https://<YOUR_GITHUB_USERNAME>.github.io/al-raj-live-web/`).

---

## 💻 Local Development

### 1. Install dependencies
```bash
npm install
```

### 2. Run local development server
```bash
npm run dev
```
Access at `http://localhost:3000`.

### 3. Build for production
```bash
npm run build
```
Generates production-ready static assets in `dist/`.

---

## 🔒 Environment Secrets (Optional)
If you wish to manage Supabase credentials via GitHub Secrets instead of the built-in fallbacks:
1. Go to **Settings** → **Secrets and variables** → **Actions**.
2. Add Repository Secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
