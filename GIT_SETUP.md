# 🐙 Git Repository Setup Guide

This guide helps you set up a Git repository for easy Raspberry Pi deployment and updates.

## 🚀 Quick Setup

### Option 1: GitHub (Recommended)

1. **Create GitHub repository**:
   - Go to https://github.com/new
   - Repository name: `waze-trivia-game`
   - Description: `Multi-group trivia game system with ESP32 buzzers`
   - Set to **Public** (for easier Pi access) or **Private**
   - Don't initialize with README (we already have files)

2. **Push to GitHub**:
   ```bash
   cd "/Users/ronpeer/Code Projects local/Waze Trivia Game"
   
   # Add remote origin
   git remote add origin https://github.com/YOUR_USERNAME/waze-trivia-game.git
   
   # Push to GitHub
   git branch -M main
   git push -u origin main
   ```

3. **Verify upload**:
   - Visit your repository: `https://github.com/YOUR_USERNAME/waze-trivia-game`
   - Check that all files are present
   - README.md should display properly

### Option 2: Other Git Services

#### GitLab
```bash
git remote add origin https://gitlab.com/YOUR_USERNAME/waze-trivia-game.git
git push -u origin main
```

#### Bitbucket
```bash
git remote add origin https://bitbucket.org/YOUR_USERNAME/waze-trivia-game.git
git push -u origin main
```

---

## 🔧 Firebase Configuration Setup

### For Public Repositories
If your repository is public, **never commit actual Firebase keys**:

1. **Keep your Firebase key secure**:
   ```bash
   # Your actual key should be in .gitignore
   ls -la config/
   # Should show:
   # firebase-key.example.json ✅ (template)
   # firebase-key.json ❌ (not in git)
   ```

2. **Deploy Firebase key separately**:
   ```bash
   # Copy to Pi after deployment
   scp config/firebase-key.json pi@game.local:/opt/waze-trivia/config/
   ```

### For Private Repositories
You can optionally include the Firebase key:

1. **Remove firebase-key.json from .gitignore**:
   ```bash
   # Edit .gitignore, remove the line:
   # config/firebase-key.json
   ```

2. **Add and commit the key**:
   ```bash
   git add config/firebase-key.json
   git commit -m "Add Firebase service account key (private repo)"
   git push
   ```

---

## 📱 Raspberry Pi Deployment Commands

Once your repository is set up, use these commands on the Pi:

### Initial Setup
```bash
# One-time setup (replace YOUR_USERNAME)
curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/waze-trivia-game/main/deploy/pi-setup.sh | bash

# Configure network
sudo curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/waze-trivia-game/main/deploy/network-setup.sh | bash

# Clone and deploy (after reboot)
git clone https://github.com/YOUR_USERNAME/waze-trivia-game.git /opt/waze-trivia
cd /opt/waze-trivia
./deploy/pi-deploy.sh
```

### Updates
```bash
# Easy updates
cd /opt/waze-trivia
./deploy/pi-update.sh
```

---

## 🔄 Development Workflow

### Making Changes
```bash
# Make your changes locally
# Test with: npm start

# Commit changes
git add .
git commit -m "Add new feature: describe your changes"
git push origin main
```

### Deploying Updates to Pi
```bash
# On the Raspberry Pi
cd /opt/waze-trivia
./deploy/pi-update.sh
```

### Version Tags (Optional)
```bash
# Tag stable releases
git tag -a v1.0.0 -m "Release version 1.0.0: Initial stable release"
git push origin v1.0.0

# Deploy specific version on Pi
cd /opt/waze-trivia
git checkout v1.0.0
./deploy/pi-deploy.sh
```

---

## 📂 Repository Structure

```
waze-trivia-game/
├── README.md                 # Main documentation
├── DEPLOYMENT.md            # Pi deployment guide
├── GIT_SETUP.md            # This file
├── package.json            # Node.js dependencies
├── .env.example            # Environment template
├── .gitignore             # Git ignore rules
├── 
├── backend/               # Node.js server
│   ├── server.js         # Main server file
│   ├── services/         # Business logic
│   └── routes/           # API endpoints
├── 
├── frontend/             # Web applications
│   ├── game-display/     # Main game screen
│   ├── host-control/     # Host interface
│   └── admin-config/     # Admin panel
├── 
├── firmware/             # ESP32 code
│   ├── group-buzzer/     # Individual buzzers
│   └── central-coordinator/ # Master controller
├── 
├── deploy/               # Deployment scripts
│   ├── pi-setup.sh      # Initial Pi setup
│   ├── pi-deploy.sh     # App deployment
│   ├── pi-update.sh     # Easy updates
│   └── network-setup.sh # Network config
├── 
├── config/               # Configuration files
│   └── firebase-key.example.json
└── 
└── public/               # Static web assets
    └── index.html        # Main landing page
```

---

## 🔒 Security Best Practices

### Public Repositories
- ✅ Use `.env.example` for environment templates
- ✅ Keep `firebase-key.example.json` as template
- ❌ Never commit actual secrets or keys
- ✅ Use `.gitignore` to exclude sensitive files

### Private Repositories
- ✅ Can include actual configuration files
- ✅ Still use environment variables for different environments
- ✅ Consider separate configs for dev/prod

### SSH Keys for Git (Optional)
```bash
# Generate SSH key on Pi
ssh-keygen -t ed25519 -C "pi@game.local"

# Add to GitHub/GitLab
cat ~/.ssh/id_ed25519.pub
# Copy and paste to your Git service

# Clone with SSH
git clone git@github.com:YOUR_USERNAME/waze-trivia-game.git /opt/waze-trivia
```

---

## 📊 Repository Management

### Useful Git Commands
```bash
# Check status
git status

# View commit history
git log --oneline -10

# Check remote URL
git remote -v

# Pull latest changes
git pull origin main

# See what changed
git diff HEAD~1

# Undo last commit (keep changes)
git reset --soft HEAD~1
```

### Branch Strategy (Advanced)
```bash
# Create development branch
git checkout -b develop
git push -u origin develop

# Work on features
git checkout -b feature/new-buzzer-sounds
# Make changes, commit, push
git push -u origin feature/new-buzzer-sounds

# Merge to main when ready
git checkout main
git merge feature/new-buzzer-sounds
git push origin main
```

---

## 🎯 Next Steps

1. **Set up your Git repository** (GitHub recommended)
2. **Update deployment URLs** in the scripts with your repository URL
3. **Test deployment** on a Raspberry Pi
4. **Configure Firebase** (copy actual key to Pi)
5. **Access your game** at http://game.local:3000

---

## 📞 Quick Reference

### Repository URLs to Update
Replace `YOUR_USERNAME` in these files:
- `DEPLOYMENT.md` - All GitHub URLs
- `deploy/pi-setup.sh` - Raw GitHub URL
- This guide - Example commands

### Important Commands
```bash
# Local development
npm start

# Pi deployment
./deploy/pi-deploy.sh

# Pi updates  
./deploy/pi-update.sh

# Check Pi status
pm2 status
```

---

**🐙 Happy Git-based deployment! Your trivia game is now version-controlled and ready for easy Pi deployment.**