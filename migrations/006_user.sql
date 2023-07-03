CREATE TABLE `user` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `name` varchar(255) UNIQUE NOT NULL,
  `email` varchar(255) UNIQUE NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

INSERT INTO user (name, email) values ('Ian Feather', 'info@ianfeather.co.uk');

create table `recipe_user` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `recipe_id`int NOT NULL COMMENT 'foreign key into recipe table',
  `recipe_slug` varchar(255) NOT NULL COMMENT 'foreign key slug into recipe table',
  `user_id` int NOT NULL COMMENT 'foreign key into user table',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_recipe_user_recipe_id` FOREIGN KEY (`recipe_id`) REFERENCES `recipe` (`id`),
  CONSTRAINT `fk_recipe_user_recipe_slug` FOREIGN KEY (`recipe_slug`) REFERENCES `recipe` (`slug`),
  CONSTRAINT `fk_recipe_user_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`)
);

-- remove some utf issue from slug
UPDATE recipe SET slug = 'almond-chicken' WHERE id = 28;
UPDATE recipe SET slug = 'chicken-leek-mushroom-pie' WHERE id = 15;
UPDATE recipe SET slug = 'sausage-pea-and-potato-casserole' WHERE id = 12;

INSERT INTO recipe_user (recipe_id, recipe_slug, user_id) values (28, 'almond-chicken', 1), (33, 'apple-crumble', 1), (38, 'baked-nduja-rigatoni', 1), (26, 'butter-chicken', 1), (15, 'chicken-leek-mushroom-pie', 1), (23, 'chicken-and-chorizo-salad', 1), (43, 'chicken-fricassee', 1), (40, 'chicken-katsu-curry', 1), (19, 'chicken-korma', 1), (36, 'chicken-tacos', 1), (4, 'chilli-con-carne', 1), (16, 'duck-with-cabbage', 1), (18, 'fish-cakes', 1), (7, 'fish-pie', 1), (29, 'french-macarons', 1), (44, 'fresh-egg-pasta', 1), (35, 'full-english-breakfast-cups', 1), (5, 'kotlety', 1), (14, 'lamb-bhuna', 1), (25, 'lamb-kofta-and-salad', 1), (42, 'lasagne-(dairy-free)', 1), (39, 'mushroom-ravioli', 1), (41, 'mushroom-soup', 1), (20, 'nicoise-salad', 1), (22, 'pan-fried-salmon', 1), (9, 'pasta-with-beans-and-kale', 1), (45, 'pasta-with-prawns-and-spinach', 1), (17, 'pea-&-pancetta-pasta', 1), (13, 'pea-and-cauliflower-curry', 1), (3, 'pea-and-pancetta-risotto', 1), (8, 'pork-and-chorizo-burgers', 1), (21, 'prawn-&-chorizo-paella', 1), (31, 'prawn-french-toast-', 1), (27, 'rack-of-lamb', 1), (11, 'roast-beef', 1), (34, 'roast-glazed-ham', 1), (12, 'sausage-pea-and-potato-casserole', 1), (6, 'sausage-and-mash', 1), (30, 'seared-pork-chops-with-mushrooms', 1), (1, 'shepherds-pie', 1), (37, 'singapore-laksa', 1), (32, 'smartie-cookies', 1), (10, 'spaghetti-and-meatballs', 1), (2, 'spaghetti-bolognese', 1), (24, 'sticky-garlic-chicken-bites', 1);
