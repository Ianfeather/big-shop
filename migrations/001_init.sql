create database `bigshop`;

create table `recipe` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `name` varchar(255) NOT NULL,
  `slug` varchar(60) NOT NULL,
  `remote_url` varchar(255),
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

create table `ingredient` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `name` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

create table `unit` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `name` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

create table `part` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `recipe_id` int NOT NULL COMMENT 'foreign key into recipe table',
  `ingredient_id` int NOT NULL COMMENT 'foreign key into ingredient table',
  `unit_id` int NOT NULL COMMENT 'foreign key into unit table',
  `quantity` varchar(20) NOT NULL COMMENT 'mixed number',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_part_recipe_id` FOREIGN KEY (`recipe_id`) REFERENCES `recipe` (`id`),
  CONSTRAINT `fk_part_ingredient_id` FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient` (`id`)
  CONSTRAINT `fk_part_unit_id` FOREIGN KEY (`unit_id`) REFERENCES `unit` (`id`)
);

CREATE INDEX idx_recipe_slug ON recipe (slug);
