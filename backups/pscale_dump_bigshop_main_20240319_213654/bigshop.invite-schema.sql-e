CREATE TABLE `invite` (
  `email` varchar(255) NOT NULL COMMENT 'the email used to invite',
  `account` int NOT NULL COMMENT 'the account to invite them to',
  `token` varchar(64) NOT NULL COMMENT 'short-term invite token',
  `admin_id` varchar(255) NOT NULL COMMENT 'the user who invited them',
  `expires` datetime NOT NULL COMMENT 'datetime that the token should expire',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`account`,`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
