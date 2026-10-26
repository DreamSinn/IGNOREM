CREATE TABLE IF NOT EXISTS guild_configs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  currency VARCHAR(32) NOT NULL,
  manager_role_ids JSON NOT NULL,
  admin_role_ids JSON NOT NULL,
  channel_ids JSON NOT NULL,
  category_ids JSON NOT NULL,
  texts JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_guild_configs_guild_id (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contracts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  code VARCHAR(24) NOT NULL,
  title VARCHAR(150) NOT NULL,
  client VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  location VARCHAR(150) NOT NULL,
  total_value DECIMAL(14,2) NOT NULL,
  status VARCHAR(24) NOT NULL,
  payment_status VARCHAR(24) NOT NULL DEFAULT 'pending',
  creator_id VARCHAR(32) NOT NULL,
  thread_id VARCHAR(32) NULL,
  announcement_message_id VARCHAR(32) NULL,
  announcement_channel_id VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contracts_guild_code (guild_id, code),
  KEY idx_contracts_guild_status_created (guild_id, status, created_at),
  KEY idx_contracts_guild_created (guild_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contract_participants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_id BIGINT UNSIGNED NOT NULL,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  share_amount DECIMAL(14,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contract_participant (contract_id, user_id),
  CONSTRAINT fk_participant_contract FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_id BIGINT UNSIGNED NOT NULL,
  guild_id VARCHAR(32) NOT NULL,
  total_amount DECIMAL(14,2) NOT NULL,
  participants_count INT UNSIGNED NOT NULL,
  paid_by VARCHAR(32) NOT NULL,
  note VARCHAR(500) NOT NULL,
  paid_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_contract (contract_id),
  CONSTRAINT fk_payment_contract FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_id BIGINT UNSIGNED NOT NULL,
  contract_id BIGINT UNSIGNED NOT NULL,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_payment_items_user (guild_id, user_id),
  KEY idx_payment_items_contract (guild_id, contract_id),
  CONSTRAINT fk_payment_item_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contract_applicants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_id BIGINT UNSIGNED NOT NULL,
  guild_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contract_applicant (guild_id, contract_id, user_id),
  KEY idx_applicants_contract_status (guild_id, contract_id, status),
  CONSTRAINT fk_applicant_contract FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_finance (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  share_percent DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_guild_finance_guild_id (guild_id),
  CONSTRAINT chk_guild_finance_share CHECK (share_percent >= 0 AND share_percent <= 100),
  CONSTRAINT chk_guild_finance_balance CHECK (balance >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guild_id VARCHAR(32) NOT NULL,
  contract_id BIGINT UNSIGNED NULL,
  kind VARCHAR(16) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  description VARCHAR(500) NOT NULL,
  created_by VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_guild_ledger_kind (guild_id, kind, created_at),
  KEY idx_guild_ledger_contract (guild_id, contract_id),
  CONSTRAINT chk_guild_ledger_kind CHECK (kind IN ('income', 'expense')),
  CONSTRAINT chk_guild_ledger_amount CHECK (amount > 0),
  CONSTRAINT fk_guild_ledger_contract FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
