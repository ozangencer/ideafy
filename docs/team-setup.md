# Ideafy Team Mode - Cloud Setup Guide

This guide walks you through setting up the cloud infrastructure required for Ideafy's Team Queue feature. Follow each section in order.

---

## 1. Supabase Project

Supabase provides the database, authentication, and real-time infrastructure.

1. Go to [supabase.com](https://supabase.com) and create an account (or sign in)
2. Click **New Project**
3. Fill in:
   - **Name**: `Ideafy` (or your preferred name)
   - **Region**: Pick the closest to your team (e.g., `eu-north-1` for Europe)
   - **Database password**: Generate a strong password and save it
4. Wait for the project to initialize (takes about 1 minute)
5. Once ready, go to **Project Settings > API** and note down:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon / public key** (starts with `eyJ...`)

### Run the migration

Go to **SQL Editor** in the Supabase Dashboard and run the contents of `lib/team/migration.sql`. This creates the `teams`, `team_members`, and `pool_cards` tables with proper indexes and Row Level Security policies.

---

## 2. Supabase Service Role Key

The service role key is required for server-side operations like creating users and generating confirmation links. This key bypasses RLS and should never be exposed to the client.

1. Go to **Project Settings > API**
2. Under **Project API keys**, find **service_role** (secret)
3. Click the eye icon to reveal it, then copy

> **Security note**: This key has full access to your database. Never commit it to version control or expose it in client-side code. It should only be used in server-side API routes.

---

## 3. Resend (Email Delivery)

Resend handles transactional email delivery with better deliverability than Supabase's built-in email service.

1. Go to [resend.com](https://resend.com) and create an account
2. Go to **API Keys** > **Create API Key**
   - Name: `Ideafy`
   - Permission: **Sending access**
   - Domain: **All domains** (or restrict to your domain)
3. Copy the API key (starts with `re_...`)

### Custom domain (optional, recommended for production)

By default, emails are sent from `onboarding@resend.dev`. For production:

1. Go to **Domains** > **Add Domain**
2. Enter your domain (e.g., `ideafy.dev`)
3. Add the required DNS records (SPF, DKIM, DMARC):
   - **Cloudflare users**: Click **Auto configure** - Resend will automatically add all DNS records via Cloudflare integration
   - **Other providers**: Click **Manual setup** and add the DNS records Resend provides to your domain's DNS panel
4. Wait for verification (usually a few minutes)
5. Update `EMAIL_FROM` in your `.env.local` to `Ideafy <noreply@yourdomain.com>`

---

## 4. Supabase SMTP Settings (Resend)

Configure Supabase to use Resend as its SMTP relay. This ensures all Supabase-generated emails (password reset, magic links, etc.) also go through Resend.

1. Go to **Project Settings > Authentication > SMTP Settings**
2. Toggle **Enable Custom SMTP** on
3. Fill in:

| Field | Value |
|-------|-------|
| Sender email | `noreply@yourdomain.com` (or `onboarding@resend.dev`) |
| Sender name | `Ideafy` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | Your Resend API key (`re_...`) |
| Minimum interval | `60` |

4. Click **Save**

---

## 5. Google OAuth

Google OAuth allows users to sign in with their Google account.

### 5.1 Create OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Select or create a project
3. If prompted, configure the **OAuth consent screen**:
   - App name: `Ideafy`
   - User support email: your email
   - Audience: **External**
   - Developer contact email: your email
   - Save
4. Go to **Credentials** > **Create Credentials** > **OAuth client ID**
5. Application type: **Web application**
6. Name: `Ideafy`
7. Under **Authorized redirect URIs**, add:
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
   (Find this URL in Supabase Dashboard > Authentication > Providers > Google > Callback URL)
8. Click **Create**
9. Copy the **Client ID** and **Client Secret**

### 5.2 Configure in Supabase

1. Go to **Authentication > Providers > Google**
2. Toggle **Enable Sign in with Google** on
3. Paste the **Client ID** and **Client Secret**
4. Save

---

## 6. GitHub OAuth

GitHub OAuth allows users to sign in with their GitHub account.

### 6.1 Create OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **OAuth Apps** > **New OAuth App**
3. Fill in:
   - **Application name**: `Ideafy`
   - **Homepage URL**: `http://localhost:3030` (update for production)
   - **Authorization callback URL**:
     ```
     https://<your-project-ref>.supabase.co/auth/v1/callback
     ```
4. Click **Register application**
5. Copy the **Client ID**
6. Click **Generate a new client secret** and copy it

### 6.2 Configure in Supabase

1. Go to **Authentication > Providers > GitHub**
2. Toggle **Enable Sign in with GitHub** on
3. Paste the **Client ID** and **Client Secret**
4. Save

---

## 7. Supabase Redirect URLs

Configure where Supabase redirects users after authentication.

1. Go to **Authentication > URL Configuration**
2. Set **Site URL**: `http://localhost:3030` (update for production)
3. Under **Redirect URLs**, add:
   ```
   http://localhost:3030/auth/callback
   ```
4. For production, also add your production callback URL

---

## 8. Environment Variables

Create a `.env.local` file in the project root with all the values collected above:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Resend
RESEND_API_KEY=re_...

# Optional
EMAIL_FROM=Ideafy <noreply@yourdomain.com>
NEXT_PUBLIC_APP_URL=http://localhost:3030
```

> **Important**: `.env.local` is already in `.gitignore`. Never commit this file.

### Variable reference

| Variable | Required | Where to find |
|----------|----------|---------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase > Project Settings > API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase > Project Settings > API > anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase > Project Settings > API > service_role key |
| `RESEND_API_KEY` | Yes | Resend > API Keys |
| `EMAIL_FROM` | No | Defaults to `Ideafy <onboarding@resend.dev>` |
| `NEXT_PUBLIC_APP_URL` | No | Defaults to `http://localhost:3030` |

---

## 9. Verification

After completing all steps:

1. Restart the dev server (`npm run dev`)
2. Open Settings > Team tab
3. Sign up with email - you should receive a confirmation email via Resend
4. Confirm your email and sign in
5. Create a team
6. Try Google and GitHub sign-in

If the Team tab does not appear in Settings, check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set correctly and the dev server was restarted.

---

## Troubleshooting

**Team tab not showing**: Environment variables not loaded. Restart the dev server after creating `.env.local`.

**Sign up fails with "Server not configured"**: `SUPABASE_SERVICE_ROLE_KEY` is missing or incorrect.

**Confirmation email not received**: Check Resend dashboard for delivery status. Verify `RESEND_API_KEY` is correct.

**OAuth redirects to wrong URL**: Ensure the callback URL in Google/GitHub matches exactly what Supabase shows under Providers > Callback URL.

**"Invalid invite code"**: Codes are case-insensitive and 6 characters. Verify the code hasn't been mistyped.
