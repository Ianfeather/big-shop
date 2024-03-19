CREATE TABLE `account_user` (
  `user_id` varchar(255) NOT NULL COMMENT 'auth0 id',
  `account_id` int NOT NULL COMMENT 'account id',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `enabled` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`user_id`,`account_id`),
  KEY `fk_account_user_account_id` (`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
