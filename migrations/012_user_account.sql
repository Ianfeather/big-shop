-- Swapping buzzfeed and personal account
UPDATE `account_user` set account_id = 1 WHERE user_id = "google-oauth2|100071246725222895078";
UPDATE `account_user` set account_id = 2 WHERE user_id = "google-oauth2|100337785987015262344";
