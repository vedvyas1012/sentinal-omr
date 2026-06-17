// pm2 process definition for Sentinal OMR.
// Secrets (DATABASE_URL, JWT_SECRET, HUB_API_KEY, signing keys) live in the
// project's .env and are loaded by the app via dotenv — never put them here.
//
//   pm2 start deploy/ecosystem.config.js
//   pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'sentinal-omr',
      script: 'server/index.js',
      cwd: '/var/www/sentinal-omr', // <-- change to your actual deploy path
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: 3002, // internal only; nginx fronts it on the public domain
      },
    },
  ],
};
