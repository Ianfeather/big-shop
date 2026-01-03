-- Shopping List History Tracking for TiDB (No Triggers)
-- Captures shopping list changes to build meal planning intelligence
-- Note: Manual logging required since TiDB doesn't support triggers

CREATE TABLE `shopping_list_event` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `account_id` varchar(255) NOT NULL COMMENT 'account that made the change',
  `event_type` ENUM('add_recipe', 'remove_recipe', 'add_item', 'remove_item', 'clear_list') NOT NULL,
  `recipe_id` int NULL COMMENT 'recipe involved (for recipe events)',
  `list_item_id` int NULL COMMENT 'specific list item (for item events)',
  `session_id` varchar(36) NULL COMMENT 'group related changes together',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_account_date` (`account_id`, `created_at`),
  INDEX `idx_recipe_usage` (`account_id`, `recipe_id`, `created_at`),
  CONSTRAINT `fk_shopping_event_recipe_id` FOREIGN KEY (`recipe_id`) REFERENCES `recipe` (`id`)
);

-- Recipe usage summary view for quick Dave queries
CREATE VIEW `recipe_usage_summary` AS
SELECT
  account_id,
  recipe_id,
  COUNT(*) as times_added,
  MAX(created_at) as last_added,
  MIN(created_at) as first_added,
  DATEDIFF(CURDATE(), MAX(created_at)) as days_since_last_use,
  AVG(DATEDIFF(CURDATE(), created_at)) as avg_days_since_use
FROM shopping_list_event
WHERE event_type = 'add_recipe'
  AND recipe_id IS NOT NULL
GROUP BY account_id, recipe_id;
