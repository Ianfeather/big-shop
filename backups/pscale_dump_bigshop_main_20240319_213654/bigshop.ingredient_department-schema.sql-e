CREATE TABLE `ingredient_department` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `department_id` int NOT NULL COMMENT 'foreign key into department table',
  `ingredient_id` int NOT NULL COMMENT 'foreign key into ingredient table',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_ingredient_department_department_id` (`department_id`),
  KEY `fk_ingredient_department_ingredient_id` (`ingredient_id`)
) ENGINE=InnoDB AUTO_INCREMENT=66 DEFAULT CHARSET=utf8mb3;
