module.exports = {
  apps: [
    {
      name: 'reeva',
      script: './bin/server.js',
      cwd: './build',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      node_args: '--enable-source-maps',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 8888,
        HOST: '0.0.0.0',
      },
    },
  ],
}
