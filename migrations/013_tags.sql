CREATE TABLE `tag` (
  `name` varchar(255) NOT NULL COMMENT 'primary key the name of the tag',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`name`)
);

create table `recipe_tag` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `recipe_id` int NOT NULL COMMENT 'foreign key into recipe table',
  `tag_name` varchar(255) NOT NULL COMMENT 'foreign key into tag table',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_recipe_tag_recipe_id` FOREIGN KEY (`recipe_id`) REFERENCES `recipe` (`id`),
  CONSTRAINT `fk_recipe_tag_tag_name` FOREIGN KEY (`tag_name`) REFERENCES `tag` (`name`)
);

INSERT INTO `tag` (name) VALUES ('Vegetarian'), ('Batch Cook');


-- add the table + relationships DONE
-- add an endpoint to associate a tag with a recipe DONE
  -- update recipe/edit and recipe/add DONE
  -- update the struct response to include tags (including on the recipe-list) DONE
  -- update recipes response DONE
-- add a field on the recipe page to add a tag
-- add a filter on the list page to filter by tag
