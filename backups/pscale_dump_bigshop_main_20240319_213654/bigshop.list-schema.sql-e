CREATE TABLE `list` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `account_id` int DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `type` varchar(10) NOT NULL,
  `unit_id` int NOT NULL,
  `recipe_id` int DEFAULT NULL,
  `quantity` varchar(20) NOT NULL COMMENT 'mixed number',
  `is_bought` tinyint(1) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `department` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_list_unit_id` (`unit_id`)
) ENGINE=InnoDB AUTO_INCREMENT=9693 DEFAULT CHARSET=latin1;
