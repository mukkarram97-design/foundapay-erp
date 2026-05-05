// PM2 process manifest for FoundaPay ERP
// Start:   pm2 start ecosystem.config.js --env production
// Logs:    pm2 logs foundapay-api
// Restart: pm2 restart foundapay-api

module.exports = {
  apps: [
    {
      name: 'foundapay-api',
      script: 'server.js',
      cwd: '/var/www/foundapay/backend',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 5001,
      },
      error_file: '/var/log/foundapay/error.log',
      out_file:   '/var/log/foundapay/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
