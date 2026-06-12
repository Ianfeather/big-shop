CREATE TABLE `step` (
  `id`               int NOT NULL AUTO_INCREMENT,
  `recipe_id`        int NOT NULL,
  `step_number`      int NOT NULL,
  `instruction`      text NOT NULL,
  `duration_minutes` int,
  `step_type`        enum('prep','cook','passive','other') NOT NULL DEFAULT 'other',
  `created_at`       datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_step_recipe_id` FOREIGN KEY (`recipe_id`) REFERENCES `recipe` (`id`)
);

CREATE INDEX idx_step_recipe_id ON step (recipe_id);
