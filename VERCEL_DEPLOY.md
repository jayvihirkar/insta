# Deploying to Vercel

This guide will help you deploy the Instagram Story Loader to Vercel with a dedicated Instagram account.

## Prerequisites

1. A Vercel account (sign up at [vercel.com](https://vercel.com))
2. A dedicated Instagram account (create a new one for this purpose)
3. Git repository (GitHub, GitLab, or Bitbucket)

## Step 1: Create a Dedicated Instagram Account

1. Create a new email address (you can use a service like Gmail with `+` aliases: `yourname+instagram@gmail.com`)
2. Create a new Instagram account with that email
3. **Important**: Disable 2FA on this account (or use an app-specific password if you enable it)
4. Follow some accounts to make it look like a real account

## Step 2: Prepare Your Code

1. Make sure all files are committed to your Git repository
2. The `ig-session.json` file is already in `.gitignore` (won't be deployed)

## Step 3: Deploy to Vercel

### Option A: Deploy via Vercel Dashboard

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click "Add New Project"
3. Import your Git repository
4. Configure the project:
   - **Framework Preset**: Other
   - **Root Directory**: `./` (default)
   - **Build Command**: (leave empty)
   - **Output Directory**: (leave empty)

### Option B: Deploy via Vercel CLI

```bash
npm i -g vercel
vercel
```

Follow the prompts to deploy.

## Step 4: Set Environment Variables

1. Go to your project settings in Vercel dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add the following variables:

```
IG_USERNAME = your_dedicated_instagram_username
IG_PASSWORD = your_dedicated_instagram_password
```

4. Click **Save**

## Step 5: Redeploy

After setting environment variables, you need to redeploy:

1. Go to **Deployments** tab
2. Click the three dots (⋯) on the latest deployment
3. Click **Redeploy**

Or trigger a new deployment by pushing a commit:

```bash
git commit --allow-empty -m "Trigger redeploy"
git push
```

## Step 6: Test Your Deployment

1. Visit your Vercel deployment URL (e.g., `https://your-project.vercel.app`)
2. Enter an Instagram username
3. Click "Load Stories"
4. Stories should load successfully!

## Important Notes

### Session Persistence

- **Vercel serverless functions are stateless** - each function invocation is independent
- The code will login to Instagram on each request (but it's fast)
- For better performance, consider using Vercel KV or similar for session storage
- The current implementation logs in fresh each time (still works, just slightly slower)

### Rate Limiting

- Instagram may rate limit if you make too many requests
- Consider adding rate limiting to your API endpoint
- The dedicated account helps avoid affecting your personal account

### Security

- Never commit your Instagram credentials to Git
- Always use environment variables in Vercel
- Consider rotating the password periodically

## Troubleshooting

### "Instagram credentials not configured"
- Make sure you set `IG_USERNAME` and `IG_PASSWORD` in Vercel environment variables
- Redeploy after setting environment variables

### "Failed to login to Instagram"
- Check that your credentials are correct
- Make sure 2FA is disabled (or use app-specific password)
- The account might be flagged - try waiting a bit

### Stories not loading
- The target account might not have active stories (they expire after 24 hours)
- The target account might be private
- Instagram might be rate limiting - wait a few minutes

## Optional: Add Session Storage with Vercel KV

For better performance, you can use Vercel KV to store sessions:

1. Install Vercel KV: `npm install @vercel/kv`
2. Create a KV database in Vercel dashboard
3. Update `api/fetch-stories.js` to save/load sessions from KV

This will reduce login frequency and improve response times.

