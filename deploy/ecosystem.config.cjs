// PM2 process file for the API on the VPS (docs/DEPLOY.md). deploy.sh starts it with `fnf-pm2 startOrReload`, so it
// runs under GrantApp's own PM2 daemon as the futurenestfund user, never root's. Settings come from
// /etc/futurenestfund/api.env (Node's --env-file); APP_RELEASE comes from deploy.sh.
module.exports = {
  apps: [
    {
      name: 'futurenestfund-api',
      cwd: '/var/www/futurenestfund/artifacts/api-server',
      script: 'dist/index.mjs',
      interpreter: '/opt/futurenestfund-node/bin/node',
      node_args: ['--enable-source-maps', '--env-file=/etc/futurenestfund/api.env'],
      exec_mode: 'fork',
      instances: 1,
      env: { APP_RELEASE: process.env.APP_RELEASE ?? 'unknown' },
      // The VPS has 1.8 GB shared by four apps; the API idles around 150 MB.
      max_memory_restart: '450M',
      exp_backoff_restart_delay: 1000,
      kill_timeout: 8000,
      time: true,
    },
  ],
};
