create table `department` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `name` varchar(255) UNIQUE NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

create table `ingredient_department` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `department_id` int NOT NULL COMMENT 'foreign key into department table',
  `ingredient_id` int NOT NULL COMMENT 'foreign key into ingredient table',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_ingredient_department_department_id` FOREIGN KEY (`department_id`) REFERENCES `department` (`id`),
  CONSTRAINT `fk_ingredient_department_ingredient_id` FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient` (`id`)
);

INSERT INTO `department` (name) VALUES ('vegetables'), ('meat and fish'), ('other');

ALTER TABLE list ADD department varchar(255);
