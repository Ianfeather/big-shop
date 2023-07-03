ALTER TABLE `recipe` ADD COLUMN `notes` text;
UPDATE `recipe` set notes = remote_url WHERE remote_url NOT LIKE 'http%';
UPDATE `recipe` set remote_url = NULL WHERE remote_url NOT LIKE 'http%';
