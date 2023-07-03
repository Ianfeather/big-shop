DROP TABLE recipe_user;
DROP TABLE user;
ALTER TABLE recipe ADD user_id varchar(255) NOT NULL;
ALTER TABLE list MODIFY user_id varchar(255) NOT NULL;
update recipe set user_id="google-oauth2|100337785987015262344" where user_id = "";
