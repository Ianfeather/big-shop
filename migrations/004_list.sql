create table `list` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `user_id` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `type` varchar(10) NOT NULL,
  `unit_id` int NOT NULL,
  `recipe_id` int,
  `quantity` varchar(20) NOT NULL COMMENT 'mixed number',
  `is_bought` BOOLEAN NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_list_unit_id` FOREIGN KEY (`unit_id`) REFERENCES `unit` (`id`),
  PRIMARY KEY (`id`)
);

