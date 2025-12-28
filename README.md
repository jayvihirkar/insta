# Instagram Story Loader

A Node.js application to download Instagram stories from public accounts.

## Features

- Download Instagram stories (images and videos)
- Web interface for easy access
- Supports both authenticated and unauthenticated access

## Installation

```bash
npm install
```

## Usage

### Without Authentication (Limited)

Stories may not be accessible without authentication as Instagram requires login for most story viewing:

```bash
npm start
```

Then open `http://localhost:3000` in your browser.

### With Authentication (Recommended)

To access stories reliably, you need to provide your Instagram credentials via environment variables:

**Windows (PowerShell):**
```powershell
$env:IG_USERNAME="your_instagram_username"
$env:IG_PASSWORD="your_instagram_password"
npm start
```

**Windows (CMD):**
```cmd
set IG_USERNAME=your_instagram_username
set IG_PASSWORD=your_instagram_password
npm start
```

**Linux/Mac:**
```bash
export IG_USERNAME="your_instagram_username"
export IG_PASSWORD="your_instagram_password"
npm start
```

Or create a `.env` file (requires `dotenv` package):
```
IG_USERNAME=your_instagram_username
IG_PASSWORD=your_instagram_password
```

## How It Works

1. **With Credentials**: Uses `instagram-private-api` to authenticate and fetch stories directly from Instagram's API
2. **Without Credentials**: Falls back to Puppeteer to scrape the Instagram website (may not work due to Instagram's authentication requirements)

## Important Notes

- Instagram stories expire after 24 hours
- Instagram requires authentication to view stories, even for public accounts
- Using your Instagram credentials allows the app to access stories that require authentication
- Keep your credentials secure and never commit them to version control
- Using Instagram's private API may violate their Terms of Service - use at your own risk

## Deployment to Vercel

This app is ready to deploy to Vercel! See [VERCEL_DEPLOY.md](./VERCEL_DEPLOY.md) for detailed deployment instructions.

Quick steps:
1. Push your code to GitHub/GitLab/Bitbucket
2. Import the project in Vercel
3. Set environment variables: `IG_USERNAME` and `IG_PASSWORD`
4. Deploy!

**Note**: For Vercel, use a dedicated Instagram account. The app will automatically use the credentials from environment variables.

## Troubleshooting

- **"Instagram requires login"**: Set `IG_USERNAME` and `IG_PASSWORD` environment variables
- **"No stories found"**: The account might not have active stories (they expire after 24 hours)
- **Login fails**: Check your credentials and ensure 2FA is disabled or use an app-specific password
- **Session persistence**: Local development saves sessions to `ig-session.json`. Vercel serverless functions login fresh each time (still works!)

