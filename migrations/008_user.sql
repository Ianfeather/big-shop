CREATE TABLE `user` (
  `id` varchar(255) NOT NULL COMMENT 'auth0 id',
  `name` varchar(255),
  `email` varchar(255),
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_logged_in_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `account` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'primary key',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

CREATE TABLE `account_user` (
  `user_id` varchar(255) NOT NULL COMMENT 'auth0 id',
  `account_id` int NOT NULL COMMENT 'account id',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `account_id`),
  CONSTRAINT `fk_account_user_user_id` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`),
  CONSTRAINT `fk_account_user_account_id` FOREIGN KEY (`account_id`) REFERENCES `account` (`id`)
);

-- some housekeeping
-- let's always use account_id rather than user_id
ALTER TABLE recipe RENAME COLUMN user_id TO account_id;
ALTER TABLE list RENAME COLUMN user_id TO account_id;

-- starter values
INSERT INTO user (id, name) values ('google-oauth2|100337785987015262344', 'Ian Feather');
INSERT INTO account (id) values (1);
INSERT INTO account_user (user_id, account_id) VALUES ('google-oauth2|100337785987015262344', 1);
UPDATE recipe set account_id=1 where account_id = "google-oauth2|100337785987015262344";
