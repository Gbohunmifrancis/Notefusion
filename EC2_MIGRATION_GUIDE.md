# NoteFusion EC2 Migration & Backup Guide

I've set up the exact same robust pipeline we used on Cupel. It leverages GitHub Container Registry for immutable image builds and securely deploys to EC2 via SSH.

Backups are the `backup` service in docker-compose.prod.yml: encrypted database dumps every 6 hours, point-in-time recovery to the minute, and the photos and JWT key daily, into a bucket of their own (Cloudflare R2 or any S3-compatible store). Setting them up, restoring and moving to another provider: [docs/BACKUP_AND_MIGRATION.md](docs/BACKUP_AND_MIGRATION.md). (The `AWS_*` / `S3_*` secrets below were for an older sidecar that no longer exists; they are not used.)

## Step 1: Initial EC2 Setup

1. Spin up an **Amazon Linux 2023** instance on AWS EC2.
2. Ensure you have the .pem SSH key file downloaded.
3. Open your terminal locally (in the project root) and run the one-shot setup script:
   `ash
   # Replace YOUR_EC2_IP with your actual EC2 public IP
   scp -i /path/to/your/notefusion.pem deploy/setup-ec2.sh ec2-user@YOUR_EC2_IP:~/setup-ec2.sh
   ssh -i /path/to/your/notefusion.pem ec2-user@YOUR_EC2_IP "bash ~/setup-ec2.sh"
   `

## Step 2: Generate the RSA Key

Locally on your machine, run the key generator to create a secure RSA token signing key. 
If you are on Windows, you can use WSL or Git Bash:
`ash
bash deploy/generate-rsa-key.sh
`
Copy the ENTIRE output (including -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY-----).

## Step 3: Add GitHub Secrets

Go to your NoteFusion GitHub repository -> **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**.

Add the following secrets:

### EC2 Connection
- EC2_HOST: The public IP or DNS of your EC2 instance.
- EC2_USER: ec2-user
- EC2_SSH_KEY: The raw contents of your .pem key file.

### Database & Backups
- POSTGRES_PASSWORD: A strong random password for the database.
- AWS_ACCESS_KEY_ID: Your AWS access key (needs S3 Write access).
- AWS_SECRET_ACCESS_KEY: Your AWS secret key.
- S3_BUCKET: The name of the S3 bucket where backups will be stored (e.g. 
otefusion-db-backups).
- S3_REGION: Your AWS region (e.g. us-east-1).

### App Configuration
- DOMAIN_NAME: Your production domain name for the API (e.g. pi.notefusion.studio). Caddy uses this to auto-provision SSL/HTTPS!
- JWT_ISSUER: E.g. https://api.notefusion.studio
- JWT_AUDIENCE: 
otefusion.app
- JWT_PRIVATE_KEY_PEM: Paste the full key generated in Step 2.
- TRANSCRIPTION_API_KEY: A strong random string for internal communication between the C# API and the Python worker.
- SEED_ADMIN_EMAIL: Your admin email.
- SEED_ADMIN_PASSWORD: Your admin password.

## Step 4: Configure DNS & Deploy!

1. Point your domain's DNS A Record (pi.notefusion.studio) to your EC2 instance's IP address.
2. Go to the **Actions** tab in GitHub.
3. Select **Deploy to EC2** on the left.
4. Click **Run workflow**!

Once the workflow finishes, your stack will be live. Set up the backups next (docs/BACKUP_AND_MIGRATION.md, "Setting it up").
