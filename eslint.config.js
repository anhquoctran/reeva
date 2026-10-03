import { configApp } from '@adonisjs/eslint-config'

export default [
  ...configApp(),
  {
    ignores: [
      'database/migrations/1758943358073_create_users_table.ts',
      'database/migrations/1774798500727_create_versions_table.ts',
      'database/migrations/1774798501489_create_platforms_table.ts',
      'database/migrations/1774798502255_create_architectures_table.ts',
      'database/migrations/1774798503019_create_storage_providers_table.ts',
      'database/migrations/1774798503800_create_artifacts_table.ts',
      'database/migrations/1774806285988_alter_versions_table.ts',
      'database/migrations/1774861504679_create_settings_table.ts',
      'database/migrations/1774863563302_alter_artifacts_table.ts',
      'database/migrations/1774864796843_alter_storages_table.ts',
      'database/migrations/1774868009285_alter_storages_table.ts',
      'database/migrations/1774868503825_alter_artifacts_table.ts',
      'database/migrations/1774869336622_alter_users_table.ts',
      'database/migrations/1774870362468_create_download_histories_table.ts',
      'database/migrations/1774873558161_alter_artifacts_table.ts',
      'database/migrations/1774887107847_create_password_reset_tokens_table.ts',
      'database/migrations/1774888424472_create_remember_me_tokens_table.ts',
      'database/migrations/1774888858249_alter_users_table.ts',
      'database/migrations/1774900000000_alter_users_soft_delete.ts',
      'database/migrations/1774900000001_alter_all_tables_soft_delete.ts',
      'database/migrations/1774945999474_create_enhance_download_histories_table.ts',
      'database/migrations/1776164555197_alter_users_table.ts',
      'database/migrations/1776244800000_add_appearance_to_users_table.ts',
    ],
  },
]
