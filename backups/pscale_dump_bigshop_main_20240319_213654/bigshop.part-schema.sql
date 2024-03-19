CREATE TABLE `part` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `recipe_id` int NOT NULL COMMENT 'foreign key into recipe table',
  `ingredient_id` int NOT NULL COMMENT 'foreign key into ingredient table',
  `unit_id` int NOT NULL COMMENT 'foreign key into unit table',
  `quantity` varchar(20) NOT NULL COMMENT 'mixed number',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_part_recipe_id` (`recipe_id`),
  KEY `fk_part_ingredient_id` (`ingredient_id`),
  KEY `fk_part_unit_id` (`unit_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1227 DEFAULT CHARSET=latin1;
